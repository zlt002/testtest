import type { AgentBackendV2Env } from '../../config/env.ts';
import type { ManagedPlugin } from '../../management/lite-plugin-registry.ts';
import type { ModelConfig } from '../../model-config/model-config-service.ts';
import {
  DEFAULT_MODEL_CONFIG,
  resolveModelConfigAuthGuidance,
  resolveModelConfigRuntimeInfo,
} from '../../model-config/model-config-service.ts';
import type { RuntimeCapabilities } from '../../runtime-capabilities/runtime-capabilities-service.ts';
import { createId } from '../../shared/ids.ts';
import type { DisplayMessage } from '../domain/display-message.ts';
import { type AgentEvent, createAgentEvent } from '../domain/events.ts';
import { createClaudeEventTranslator } from '../runtime/claude-event-translator.ts';
import { buildClaudeRequestOptions } from '../runtime/claude-request-builder.ts';
import {
  classifyInteractionIntent,
  classifyInteractionResource,
} from '../runtime/interaction-policy-classifier.ts';
import {
  createInteractionPolicySession,
  type PolicyDecision,
} from '../runtime/interaction-policy-router.ts';
import { createPolicyAuditLog } from '../runtime/policy-audit.ts';
import { selectSessionSkillPlan } from '../runtime/skill-selection.ts';
import { type AbortRunResult, abortRun } from './abort-run.ts';
import { getSessionHistory } from './get-session-history.ts';
import {
  createSessionRunStateStore,
  type SessionRunState,
  type SessionRunStateStatus,
  type SessionRunStateStore,
} from './session-run-state.ts';
import type { RunStream } from './start-session-run.ts';

type QueryRun = AsyncIterable<Record<string, unknown>> & {
  interrupt(): Promise<void>;
};

type Runtime = {
  query?(input: {
    prompt: string | AsyncIterable<Record<string, unknown>>;
    options?: Record<string, unknown>;
  }): QueryRun;
  registerActiveRun?(runId: string, run: { interrupt(): Promise<void> }): void;
  completeRun?(runId: string): void;
  abortRun(runId: string): Promise<AbortRunResult>;
};

const DEFAULT_FIRST_EVENT_TIMEOUT_MS = 10000;

type InteractionDecision = {
  allow?: boolean;
  message?: string;
  updatedInput?: unknown;
  answers?: Record<string, unknown>;
};

type PendingInteraction = {
  runId: string;
  resolve: (decision: InteractionDecision) => void;
  emitResolved: (decision: InteractionDecision) => void;
};

type RuntimePluginRef = {
  type: 'local';
  path: string;
};

type SessionAttachmentKind = 'image' | 'document' | 'text' | 'other';

type SessionAttachment = {
  id: string;
  sessionFileId: string;
  name: string;
  mimeType: string;
  size: number;
  kind: SessionAttachmentKind;
  storage: string;
  absolutePath?: string;
  data?: string;
  previewUrl?: string;
};

const CHINESE_LANGUAGE_INSTRUCTION = [
  '<language_instruction>',
  '请始终使用中文进行对话、计划、待办、过程说明和最终回答。',
  '代码、API 名称、工具名、文件路径、命令和必要的技术标识可以保留英文。',
  '</language_instruction>',
].join('\n');

function buildProjectWorkspaceInstruction(projectPath?: string): string | null {
  if (!projectPath?.trim()) {
    return null;
  }

  return [
    '<project_workspace>',
    `当前项目根目录：${projectPath}`,
    '默认所有新建或导出的文档、Markdown、代码和配置文件都必须写入当前项目根目录内。',
    '如果用户没有明确指定文件路径，优先写入当前项目内的合适子目录，例如 docs/、spec/、notes/ 或与任务相关的现有目录。',
    '创建或修改 .md、.mdx、.markdown、.txt、.json、.yaml、.yml、.ts、.tsx、.js、.jsx、.css、.html 等文本文件时，优先使用结构化写文件/改文件工具。',
    '不要优先使用 Bash 的 cat、echo、printf、tee、heredoc 或重定向来直接写入文件内容；只有结构化写文件工具确实不可用时，才退回 Bash。',
    '如果需要先创建目录，可以使用 Bash 执行 mkdir，但文件内容本身仍应优先通过结构化写文件/改文件工具写入。',
    '不要默认写到桌面、下载目录、用户主目录或任何项目外的绝对路径。',
    '只有当用户明确要求保存到项目外路径时，才允许写到项目外。',
    '如果本次任务创建或修改了 .html 文件，不要为了“帮用户预览”而再主动调用浏览器自动化工具、外部 Chrome、Playwright 或 mcp__chrome / mcp__browser 一类工具打开 file:// 页面。',
    'HTML 预览默认由扩展侧自动在当前浏览器的新标签页中打开；除非用户明确要求你手动检查页面交互，否则不要额外再开一个浏览器窗口或标签页。',
    '</project_workspace>',
  ].join('\n');
}

function buildInteractionPolicyInstruction(input: {
  prompt: string;
  browserContext?: Record<string, unknown>;
}): string | null {
  const resource = classifyInteractionResource({
    prompt: input.prompt,
    browserContext: input.browserContext,
  });
  const intent = classifyInteractionIntent(input.prompt);

  if (resource.kind === 'local_file_url') {
    return [
      '<interaction_policy>',
      '当前目标属于 file:// 本地页面，默认执行文件优先策略。',
      '第一跳优先直接读取对应本地文件或工作区文件内容，不要先读取渲染页面、不要先截图、不要先启动外部浏览器。',
      '当用户提供本地 HTML 路径、行列号、DOM 局部定位、CSS 定位或快照外观修改需求时，优先使用 browser_extension 的 snapshot_locate_dom / snapshot_find_css / snapshot_patch_html / snapshot_patch_css / snapshot_patch_css_batch 工具完成定位和补丁；多条 CSS 一次性使用 snapshot_patch_css_batch，避免对大文件反复 Read/Grep/Edit。',
      '只有文件读取失败、文件路径缺失，或确认必须看渲染结果时，才允许降级到页面读取或视觉检查。',
      '</interaction_policy>',
    ].join('\n');
  }

  if (resource.kind === 'active_web_page') {
    const firstHop =
      intent === 'visual_inspect'
        ? '第一跳先使用当前浏览器扩展的当前页读取能力，再决定是否需要视觉检查。'
        : '第一跳先使用当前浏览器扩展的当前页读取能力，不要直接新开外部浏览器。';

    return [
      '<interaction_policy>',
      '当前目标属于当前浏览器里的真实网页，默认执行扩展优先策略。',
      firstHop,
      '必须绑定当前 browser_context 的 tabId/windowId；不要脱离当前标签页重新打开同一个远程 URL。',
      '只有当前页扩展读取失败后，才允许降级到更重的浏览器自动化或其他外部能力。',
      '</interaction_policy>',
    ].join('\n');
  }

  return null;
}

function recordPolicyDecisionAudit(input: {
  audit: ReturnType<typeof createPolicyAuditLog>;
  decision: PolicyDecision;
  resourceKind: string;
  toolName: string;
}) {
  switch (input.decision.reasonCode) {
    case 'browser_context_mismatch':
      input.audit.record({
        type: 'browser_context_mismatch',
        resourceKind: input.resourceKind,
        toolName: input.toolName,
        detail: input.decision.message,
      });
      return;
    case 'wrong_primary_tool_attempted':
    case 'file_requires_file_first':
      input.audit.record({
        type: 'wrong_primary_tool_attempted',
        resourceKind: input.resourceKind,
        toolName: input.toolName,
        detail: input.decision.message,
      });
      return;
    case 'unsafe_fallback_attempted':
      input.audit.record({
        type: 'unsafe_fallback_attempted',
        resourceKind: input.resourceKind,
        toolName: input.toolName,
        detail: input.decision.message,
      });
      return;
    default:
      return;
  }
}

class AsyncEventQueue<T> {
  private items: T[] = [];
  private waiters: Array<(value: T | null) => void> = [];
  private closed = false;

  push(item: T) {
    if (this.closed) {
      return;
    }
    const waiter = this.waiters.shift();
    if (waiter) {
      waiter(item);
      return;
    }
    this.items.push(item);
  }

  close() {
    this.closed = true;
    for (const waiter of this.waiters.splice(0)) {
      waiter(null);
    }
  }

  shift(): Promise<T | null> {
    const item = this.items.shift();
    if (item) {
      return Promise.resolve(item);
    }
    if (this.closed) {
      return Promise.resolve(null);
    }
    return new Promise((resolve) => {
      this.waiters.push(resolve);
    });
  }
}

export type AgentServiceDeps = {
  historyReader: {
    listProjects?(input?: { forceRefresh?: boolean }): Promise<unknown>;
    listSessions?(input?: { projectPath?: string }): Promise<unknown>;
    readSessionHistory(
      sessionId: string,
      input?: { projectPath?: string }
    ): Promise<DisplayMessage[]>;
  };
  runtime: Runtime;
  env?: AgentBackendV2Env;
  mcpServersProvider?: {
    listServers(input?: { projectPath?: string }): Promise<Record<string, unknown>>;
  };
  runtimeCapabilitiesProvider?: {
    getCapabilities(): Promise<RuntimeCapabilities>;
  };
  toolPermissionsProvider?: {
    getToolPermissions(input?: {
      projectPath?: string;
    }): Promise<{ allowedTools?: string[]; disallowedTools?: string[] }>;
  };
  managedPluginProvider?: {
    listManagedPlugins(): Promise<ManagedPlugin[]>;
  };
  modelConfigProvider?: {
    getConfig(): Promise<ModelConfig>;
  };
  runStateStore?: SessionRunStateStore;
  firstEventTimeoutMs?: number;
};

function withTimeout<T>(
  factory: () => Promise<T>,
  timeoutMs: number,
  message: string
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | null = null;
  return Promise.race([
    factory(),
    new Promise<T>((_, reject) => {
      timer = setTimeout(() => reject(new Error(message)), timeoutMs);
    }),
  ]).finally(() => {
    if (timer) {
      clearTimeout(timer);
    }
  });
}

function extractPreviewText(event: AgentEvent): string | undefined {
  if (event.type !== 'assistant.message.delta') {
    return undefined;
  }
  return typeof event.payload.text === 'string' && event.payload.text.length > 0
    ? event.payload.text
    : undefined;
}

function mapActiveRunStatus(event: AgentEvent): SessionRunStateStatus {
  return event.type === 'run.started' || event.type === 'session.bound'
    ? 'connecting'
    : 'streaming';
}

function normalizeStringList(value: string[] | undefined): string[] {
  return [...new Set((value || []).map((item) => item.trim()).filter(Boolean))];
}

function resolveRuntimePlugins(input: {
  skillPlanPlugins?: RuntimePluginRef[];
  managedPlugins?: ManagedPlugin[];
}): RuntimePluginRef[] | undefined {
  const resolved = new Map<string, RuntimePluginRef>();

  for (const plugin of input.skillPlanPlugins || []) {
    if (plugin?.path) {
      resolved.set(plugin.path, plugin);
    }
  }

  for (const plugin of input.managedPlugins || []) {
    if (!plugin.enabled || !plugin.path?.trim()) {
      continue;
    }
    resolved.set(plugin.path, { type: 'local', path: plugin.path });
  }

  return resolved.size > 0 ? [...resolved.values()] : undefined;
}

function shouldUseDefaultAllowedTools(input: {
  runtimeCapabilities?: RuntimeCapabilities;
  explicitAllowedTools?: string[];
  runtimePlugins?: RuntimePluginRef[];
}): boolean {
  if (input.explicitAllowedTools !== undefined) {
    return false;
  }

  if ((input.runtimePlugins || []).length > 0) {
    return false;
  }

  const runtimeCapabilities = input.runtimeCapabilities;
  if (!runtimeCapabilities) {
    return true;
  }

  if (runtimeCapabilities.selectedAuthSource === 'user_claude_settings') {
    return false;
  }

  return true;
}

const TOOL_MUTATION_NAMES = new Set([
  'Write',
  'Edit',
  'MultiEdit',
]);
const MCP_MUTATING_OPERATIONS = [
  'write',
  'edit',
  'multiedit',
  'patch',
  'create',
  'update',
  'delete',
  'remove',
  'call',
  'run',
  'execute',
  'navigate',
  'click',
  'type',
  'submit',
];

const BASH_MUTATING_COMMANDS = new Set([
  'mkdir',
  'touch',
  'rm',
  'rmdir',
  'mv',
  'cp',
  'install',
  'chmod',
  'chown',
  'tee',
  'dd',
  'truncate',
  'ln',
]);
const GIT_MUTATING_SUBCOMMANDS = new Set([
  'add',
  'apply',
  'am',
  'checkout',
  'switch',
  'restore',
  'reset',
  'clean',
  'commit',
  'merge',
  'rebase',
  'cherry-pick',
  'revert',
  'tag',
  'branch',
  'push',
  'pull',
  'fetch',
  'clone',
]);
const SHELL_MUTATING_OPERATORS = ['>', '>>', ';', '&&', '||', '$(', '`'];

function isMutatingBashCommand(command: string): boolean {
  const normalized = command.trim();
  if (!normalized) {
    return true;
  }

  if (SHELL_MUTATING_OPERATORS.some((operator) => normalized.includes(operator))) {
    return true;
  }

  const [binary, ...args] = normalized.split(/\s+/);
  const lowerBinary = binary.toLowerCase();

  if (lowerBinary === 'sed') {
    const normalizedArgs = args.map((arg) => arg.toLowerCase());
    const hasInPlace = normalizedArgs.includes('-i') || normalizedArgs.includes('--in-place');
    return hasInPlace;
  }

  if (BASH_MUTATING_COMMANDS.has(lowerBinary)) {
    return true;
  }

  if (lowerBinary !== 'git') {
    return false;
  }

  const subcommand = args[0]?.toLowerCase();
  return Boolean(subcommand && GIT_MUTATING_SUBCOMMANDS.has(subcommand));
}

function requiresApprovalForSideEffects(
  toolName: string,
  toolInput: Record<string, unknown>
): boolean {
  if (toolName === 'Bash') {
    return (
      typeof toolInput.command !== 'string' || isMutatingBashCommand(toolInput.command)
    );
  }

  if (toolName === 'Skill') {
    return false;
  }

  if (TOOL_MUTATION_NAMES.has(toolName)) {
    return true;
  }

  if (toolName.startsWith('mcp__')) {
    const parts = toolName.split('__');
    const operation = parts.at(-1)?.toLowerCase();
    if (!operation) {
      return false;
    }

    return MCP_MUTATING_OPERATIONS.some(
      (keyword) => operation === keyword || operation.startsWith(`${keyword}_`)
    );
  }

  if (toolName === 'AskUserQuestion') {
    return true;
  }

  return false;
}

function isExternalBrowserAutomationToolName(toolName: string): boolean {
  const normalizedToolName = toolName.trim().toLowerCase();
  return (
    normalizedToolName.startsWith('mcp__playwright__') ||
    normalizedToolName.startsWith('mcp__plugin_playwright_playwright__') ||
    normalizedToolName.startsWith('mcp__browser__') ||
    normalizedToolName.startsWith('mcp__chrome__') ||
    normalizedToolName.startsWith('mcp_chrome') ||
    normalizedToolName.startsWith('mcp_browser') ||
    normalizedToolName.startsWith('chrome_') ||
    normalizedToolName.startsWith('browser_') ||
    normalizedToolName.includes('playwright') ||
    normalizedToolName.includes('devtools')
  );
}

function evaluateRuntimeCapabilityToolGate(input: {
  toolName: string;
  runtimeCapabilities?: RuntimeCapabilities;
}): { behavior: 'allow' | 'block'; message?: string } {
  const toolName = input.toolName;
  const isExternalBrowserTool = isExternalBrowserAutomationToolName(toolName);

  if (isExternalBrowserTool) {
    return {
      behavior: 'block',
      message:
        '当前项目始终禁止外部浏览器自动化工具调用，请只使用浏览器扩展自身提供的标签页读取和操作能力。',
    };
  }

  return { behavior: 'allow' };
}

function resolveModelName(modelConfig: ModelConfig | undefined): string | null {
  if (!modelConfig) {
    return null;
  }
  return modelConfig.modelProvider === 'openai'
    ? modelConfig.openaiModelName || null
    : modelConfig.anthropicModelName || null;
}

function resolveProjectSdkEnv(input: {
  modelConfig: ModelConfig | undefined;
}): Record<string, string | undefined> {
  const modelConfig = input.modelConfig;
  if (!modelConfig) {
    return {};
  }

  if (modelConfig.modelProvider === 'openai') {
    return {
      OPENAI_API_KEY: modelConfig.openaiApiKey,
      OPENAI_BASE_URL: modelConfig.openaiBaseUrl,
    };
  }

  return {
    ANTHROPIC_API_KEY: modelConfig.anthropicApiKey,
    ANTHROPIC_AUTH_TOKEN: modelConfig.anthropicApiKey,
    ANTHROPIC_BASE_URL: modelConfig.anthropicBaseUrl,
  };
}

function maskBaseUrl(value: string | undefined): string | undefined {
  if (!value?.trim()) {
    return undefined;
  }

  try {
    const url = new URL(value);
    return `${url.origin}${url.pathname}`;
  } catch {
    return value;
  }
}

function formatRuntimeAuthSummary(input: {
  authSource?: string | null;
  settingSources: Array<'user' | 'project' | 'local'>;
  provider?: 'openai' | 'anthropic';
  model?: string | null;
  sdkEnv?: Record<string, string | undefined>;
  claudeCliAvailable?: boolean;
  pathToClaudeCodeExecutable?: string | null;
}) {
  const provider = input.provider || 'unknown';
  const baseUrl =
    provider === 'openai'
      ? maskBaseUrl(input.sdkEnv?.OPENAI_BASE_URL)
      : maskBaseUrl(input.sdkEnv?.ANTHROPIC_BASE_URL);
  const hasApiKey =
    provider === 'openai'
      ? Boolean(input.sdkEnv?.OPENAI_API_KEY?.trim())
      : Boolean(
          input.sdkEnv?.ANTHROPIC_AUTH_TOKEN?.trim() || input.sdkEnv?.ANTHROPIC_API_KEY?.trim()
        );

  return [
    '认证摘要',
    `source=${input.authSource || 'unknown'}`,
    `provider=${provider}`,
    `model=${input.model || 'unset'}`,
    `baseUrl=${baseUrl || 'unset'}`,
    `apiKey=${hasApiKey ? 'present' : 'missing'}`,
    `settingSources=${input.settingSources.join(',')}`,
    `claudeCli=${input.claudeCliAvailable ? 'available' : 'missing'}`,
    `cliPath=${input.pathToClaudeCodeExecutable || 'unset'}`,
  ].join(' | ');
}

export function createAgentService(deps: AgentServiceDeps) {
  const pendingInteractions = new Map<string, PendingInteraction>();
  const runStateStore = deps.runStateStore ?? createSessionRunStateStore();
  const firstEventTimeoutMs = deps.firstEventTimeoutMs ?? DEFAULT_FIRST_EVENT_TIMEOUT_MS;

  function normalizeRunAttachments(input: {
    attachments?: SessionAttachment[];
    images?: Array<{ name?: string; mimeType: string; data: string }>;
  }): SessionAttachment[] {
    if (input.attachments?.length) {
      return input.attachments;
    }

    return (input.images || []).map((image, index) => {
      const id = `legacy-image-${index + 1}`;
      return {
        id,
        sessionFileId: id,
        name: image.name || `image-${index + 1}`,
        mimeType: image.mimeType,
        size: image.data.length,
        kind: 'image' as const,
        storage: 'inline',
        data: image.data,
      };
    });
  }

  function toImageBlocks(attachments: SessionAttachment[] = []) {
    return attachments
      .filter(
        (attachment) =>
          attachment.kind === 'image' &&
          attachment.mimeType.startsWith('image/') &&
          typeof attachment.data === 'string' &&
          attachment.data.length > 0
      )
      .map((attachment) => ({
        type: 'image',
        source: {
          type: 'base64',
          media_type: attachment.mimeType,
          data: attachment.data,
        },
      }));
  }

  function sanitizeAttachmentContextValue(value: string): string {
    return value
      .replaceAll('</attachments>', '<\\/attachments>')
      .replaceAll('\r\n', '\\n')
      .replaceAll('\r', '\\n')
      .replaceAll('\n', '\\n')
      .replaceAll('|', '｜');
  }

  function attachmentContextBlock(attachments: SessionAttachment[] = []): string {
    if (attachments.length === 0) {
      return '';
    }

    const lines = attachments.map((attachment) => {
      const preview = attachment.previewUrl
        ? ` | previewUrl=${sanitizeAttachmentContextValue(attachment.previewUrl)}`
        : '';
      const absolutePath = attachment.absolutePath
        ? ` | absolutePath=${sanitizeAttachmentContextValue(attachment.absolutePath)}`
        : '';
      const inlineData = attachment.kind === 'image' && attachment.data ? ' | inlineData=true' : '';
      return [
        `- name=${sanitizeAttachmentContextValue(attachment.name)}`,
        `sessionFileId=${sanitizeAttachmentContextValue(attachment.sessionFileId)}`,
        `mimeType=${sanitizeAttachmentContextValue(attachment.mimeType)}`,
        `kind=${attachment.kind}`,
        `size=${attachment.size}`,
        `storage=${sanitizeAttachmentContextValue(attachment.storage)}${absolutePath}${preview}${inlineData}`,
      ].join(' | ');
    });

    return [
      '<attachments>',
      '以下为本次请求携带的附件元数据。图片附件若带 inlineData=true，说明其图像内容已作为图片输入一并提供；非图片附件当前仅提供元数据，请按需继续调用工具读取原文件。',
      ...lines,
      '</attachments>',
    ].join('\n');
  }

  async function* userMessagePrompt(content: string, attachments: SessionAttachment[] = []) {
    const blocks: unknown[] = [{ type: 'text', text: content }, ...toImageBlocks(attachments)];
    yield {
      type: 'user',
      message: {
        role: 'user',
        content: blocks,
      },
      parent_tool_use_id: null,
    };
  }

  function buildPrompt(content: string, browserContext?: Record<string, unknown>): string {
    const localizedContent = `${CHINESE_LANGUAGE_INSTRUCTION}\n\n<用户原始请求>\n${content}\n</用户原始请求>`;
    if (!browserContext) {
      return localizedContent;
    }

    const allowedTabIds = Array.isArray(browserContext.allowedTabIds)
      ? browserContext.allowedTabIds.filter((tabId): tabId is number => typeof tabId === 'number')
      : [];
    const selectedTabs = Array.isArray(browserContext.selectedTabs)
      ? browserContext.selectedTabs.filter(
          (tab): tab is Record<string, unknown> => Boolean(tab) && typeof tab === 'object'
        )
      : [];
    const contextLines = [
      '<browser_context>',
      `windowId: ${String(browserContext.windowId ?? 'unknown')}`,
      `tabId: ${String(browserContext.tabId ?? 'unknown')}`,
      `title: ${String(browserContext.title ?? 'unknown')}`,
      `url: ${String(browserContext.url ?? 'unknown')}`,
      ...(allowedTabIds.length > 0 ? [`allowedTabIds: [${allowedTabIds.join(', ')}]`] : []),
      ...(browserContext.primaryTabId !== undefined
        ? [`primaryTabId: ${String(browserContext.primaryTabId)}`]
        : []),
      ...(selectedTabs.length > 0
        ? [
            'selectedTabs:',
            ...selectedTabs.flatMap((tab, index) => [
              `  - [${index}]`,
              `    tabId: ${String(tab.tabId ?? 'unknown')}`,
              `    title: ${String(tab.title ?? 'unknown')}`,
              `    url: ${String(tab.url ?? 'unknown')}`,
              `    content: ${String(tab.content ?? '')}`,
              `    captureError: ${String(tab.captureError ?? '')}`,
            ]),
          ]
        : []),
      '</browser_context>',
    ];

    return `${contextLines.join('\n')}\n\n${localizedContent}`;
  }

  function buildRunPrompt(input: {
    prompt: string;
    projectPath?: string;
    browserContext?: Record<string, unknown>;
    attachments?: SessionAttachment[];
  }): string {
    const policyInstruction = buildInteractionPolicyInstruction(input);
    const projectWorkspaceInstruction = buildProjectWorkspaceInstruction(input.projectPath);
    const attachmentContext = attachmentContextBlock(input.attachments);
    const instructions = [projectWorkspaceInstruction, policyInstruction].filter(Boolean);
    const basePrompt =
      instructions.length > 0 ? `${instructions.join('\n\n')}\n\n${input.prompt}` : input.prompt;
    const promptWithPolicy = attachmentContext
      ? `${attachmentContext}\n\n${basePrompt}`
      : basePrompt;
    return buildPrompt(promptWithPolicy, input.browserContext);
  }

  async function createRunStream(input: {
    runId: string;
    sessionId: string | null;
    prompt: string;
    projectPath?: string;
    browserContext?: Record<string, unknown>;
    permissionMode?: string;
    effort?: string;
    attachments?: SessionAttachment[];
  }): Promise<RunStream> {
    const mcpServers = await deps.mcpServersProvider?.listServers({
      projectPath: input.projectPath,
    });
    const runtimeCapabilities = await deps.runtimeCapabilitiesProvider?.getCapabilities();
    const toolPermissions = await deps.toolPermissionsProvider?.getToolPermissions({
      projectPath: input.projectPath,
    });
    const managedPlugins = await deps.managedPluginProvider?.listManagedPlugins();
    const modelConfig = await deps.modelConfigProvider?.getConfig();
    const skillPlan = selectSessionSkillPlan({
      prompt: input.prompt,
      browserContext: input.browserContext,
    });
    const resource = classifyInteractionResource({
      prompt: input.prompt,
      browserContext: input.browserContext,
    });
    const intent = classifyInteractionIntent(input.prompt);
    const policySession = createInteractionPolicySession({
      resourceKind: resource.kind,
      intentKind: intent,
      browserContext: input.browserContext,
    });
    const policyAudit = createPolicyAuditLog(input.runId);
    const allowedToolUses = new Map<string, string>();
    const settingSources: Array<'user' | 'project' | 'local'> =
      runtimeCapabilities?.selectedAuthSource === 'user_claude_settings'
        ? ['user', 'local']
        : ['project', 'local'];
    const runtimePlugins = resolveRuntimePlugins({
      skillPlanPlugins: skillPlan?.plugins,
      managedPlugins,
    });
    const useDefaultAllowedTools = shouldUseDefaultAllowedTools({
      runtimeCapabilities,
      explicitAllowedTools: toolPermissions?.allowedTools,
      runtimePlugins,
    });
    const modelConfigRuntime =
      deps.env && modelConfig
        ? resolveModelConfigRuntimeInfo({
            env: deps.env,
            runtimeCapabilities,
            modelConfig,
            preferAvailableSource: runtimeCapabilities?.selectedAuthSource ? false : undefined,
          })
        : null;
    const requestModel =
      modelConfigRuntime?.authSource === 'project_model_config'
        ? resolveModelName(modelConfig)
        : deps.env?.model || resolveModelName(modelConfig || DEFAULT_MODEL_CONFIG);
    const sdkEnv =
      modelConfigRuntime?.authSource === 'project_model_config'
        ? resolveProjectSdkEnv({ modelConfig })
        : undefined;
    const runtimeAuthSummary = formatRuntimeAuthSummary({
      authSource: modelConfigRuntime?.authSource,
      settingSources,
      provider: modelConfig?.modelProvider,
      model: requestModel,
      sdkEnv,
      claudeCliAvailable: modelConfigRuntime?.claudeCliAvailable,
      pathToClaudeCodeExecutable: deps.env?.claudeCodeExecutablePath,
    });
    const authGuidance =
      modelConfigRuntime && modelConfig
        ? resolveModelConfigAuthGuidance({
            runtime: modelConfigRuntime,
            modelConfig,
          })
        : undefined;
    const manualEvents = new AsyncEventQueue<AgentEvent>();
    let manualSequence = 10000;
    let currentSessionId = input.sessionId;
    const nextManualEvent = (type: AgentEvent['type'], payload: Record<string, unknown>) =>
      createAgentEvent({
        runId: input.runId,
        sessionId: currentSessionId,
        sequence: manualSequence++,
        type,
        payload,
      });
    const options = deps.env
      ? buildClaudeRequestOptions({
          env: deps.env,
          projectPath: input.projectPath,
          resume: input.sessionId ?? undefined,
          model: requestModel,
          mcpServers,
          allowedTools: toolPermissions?.allowedTools,
          useDefaultAllowedTools,
          disallowedTools: toolPermissions?.disallowedTools,
          permissionMode: input.permissionMode,
          effort: input.effort,
          settingSources,
          skills: skillPlan?.skills,
          plugins: runtimePlugins,
          sdkEnv,
          systemPrompt: skillPlan?.systemPrompt,
        })
      : {
          cwd: input.projectPath,
          resume: input.sessionId ?? undefined,
          model: requestModel,
          mcpServers,
          allowedTools: toolPermissions?.allowedTools,
          disallowedTools: toolPermissions?.disallowedTools,
          settingSources,
          skills: skillPlan?.skills,
          plugins: runtimePlugins,
          systemPrompt: skillPlan?.systemPrompt,
        };
    (options as Record<string, unknown>).attachments = (input.attachments || []).map(
      ({ data, ...attachment }) => attachment
    );
    (options as Record<string, unknown>).canUseTool = async (
      toolName: string,
      toolInput: Record<string, unknown>,
      context: Record<string, unknown> = {}
    ) => {
      const isInteractivePrompt = toolName === 'AskUserQuestion';
      const requestId =
        typeof context.toolUseID === 'string' && context.toolUseID
          ? context.toolUseID
          : createId('interaction');
      const runtimeGateDecision = evaluateRuntimeCapabilityToolGate({
        toolName,
        runtimeCapabilities,
      });
      if (runtimeGateDecision.behavior !== 'allow') {
        return {
          behavior: runtimeGateDecision.behavior,
          message: runtimeGateDecision.message || 'Runtime capabilities denied tool use',
          toolUseID: requestId,
        };
      }
      const policyDecision = policySession.beforeToolUse(toolName, toolInput);

      if (policyDecision.behavior !== 'allow') {
        recordPolicyDecisionAudit({
          audit: policyAudit,
          decision: policyDecision,
          resourceKind: resource.kind,
          toolName,
        });
        return {
          behavior: policyDecision.behavior,
          message: policyDecision.message || 'Interaction policy denied tool use',
          toolUseID: requestId,
        };
      }

      if (input.permissionMode === 'bypassPermissions' && !isInteractivePrompt) {
        allowedToolUses.set(requestId, toolName);
        return {
          behavior: 'allow',
          updatedInput: toolInput,
          toolUseID: requestId,
        };
      }

      if (!isInteractivePrompt && !requiresApprovalForSideEffects(toolName, toolInput)) {
        allowedToolUses.set(requestId, toolName);
        return {
          behavior: 'allow',
          updatedInput: toolInput,
          toolUseID: requestId,
        };
      }

      manualEvents.push(
        nextManualEvent('interaction.required', {
          requestId,
          kind: isInteractivePrompt ? 'interactive_prompt' : 'permission_request',
          toolName,
          message:
            typeof context.title === 'string'
              ? context.title
              : isInteractivePrompt
                ? 'Claude 需要向你确认一个问题。'
                : `Claude 请求使用 ${toolName}`,
          input: toolInput,
          context,
        })
      );

      const decision = await new Promise<InteractionDecision>((resolve) => {
        pendingInteractions.set(requestId, {
          runId: input.runId,
          resolve,
          emitResolved(resolvedDecision) {
            manualEvents.push(
              nextManualEvent('interaction.resolved', {
                requestId,
                outcome: resolvedDecision.allow === false ? 'denied' : 'allowed',
                message: resolvedDecision.message,
              })
            );
          },
        });

        const signal = context.signal as AbortSignal | undefined;
        if (signal?.aborted) {
          resolve({ allow: false, message: 'Request aborted' });
          return;
        }
        signal?.addEventListener(
          'abort',
          () => resolve({ allow: false, message: 'Request aborted' }),
          { once: true }
        );
      });
      pendingInteractions.delete(requestId);

      if (!decision.allow) {
        return {
          behavior: 'deny',
          message: decision.message || 'User denied tool use',
          toolUseID: requestId,
        };
      }

      const updatedInput =
        decision.updatedInput && typeof decision.updatedInput === 'object'
          ? (decision.updatedInput as Record<string, unknown>)
          : decision.answers
            ? { ...toolInput, answers: decision.answers }
            : toolInput;
      allowedToolUses.set(requestId, toolName);
      return {
        behavior: 'allow',
        updatedInput,
        toolUseID: requestId,
      };
    };
    (options as Record<string, unknown>).allowDangerouslySkipPermissions = false;
    if (!deps.runtime.query) {
      throw new Error('Claude runtime query is not configured');
    }
    if (modelConfigRuntime && !modelConfigRuntime.available) {
      return Object.assign(
        (async function* unavailableStream(): AsyncIterable<AgentEvent> {
          const startedEvent = createAgentEvent({
            runId: input.runId,
            sessionId: input.sessionId,
            sequence: 1,
            type: 'run.started',
            payload: {
              projectPath: input.projectPath,
            },
          });
          upsertRunState(startedEvent);
          yield startedEvent;

          const failedEvent = createAgentEvent({
            runId: input.runId,
            sessionId: input.sessionId,
            sequence: 2,
            type: 'run.failed',
            payload: {
              error: `${modelConfigRuntime.reason}\n${runtimeAuthSummary}`,
              runtimeAuthSummary,
              authGuidance,
            },
          });
          markRunFinished(failedEvent, 'failed');
          yield failedEvent;
        })(),
        {
          runId: input.runId,
          sessionId: input.sessionId,
        }
      );
    }
    const prompt = buildRunPrompt({
      prompt: input.prompt,
      projectPath: input.projectPath,
      browserContext: input.browserContext,
      attachments: input.attachments,
    });
    const hasImageBlocks = toImageBlocks(input.attachments).length > 0;
    const queryRun = deps.runtime.query({
      prompt: hasImageBlocks ? userMessagePrompt(prompt, input.attachments) : prompt,
      options,
    });
    let aborted = false;
    deps.runtime.registerActiveRun?.(input.runId, {
      async interrupt() {
        aborted = true;
        await queryRun.interrupt();
      },
    });
    const translate = createClaudeEventTranslator({
      runId: input.runId,
      sessionId: input.sessionId,
      initialSequence: 1,
      onDiagnostic: deps.env?.enableLiveWritePreviewDiagnostics
        ? (payload) => {
            const toolName =
              typeof payload.toolName === 'string' ? payload.toolName.toLowerCase() : '';
            if (toolName !== 'write' && toolName !== 'edit') {
              return;
            }
            console.info('[live-write-preview]', JSON.stringify(payload));
          }
        : undefined,
    });

    function upsertRunState(event: AgentEvent) {
      if (!event.sessionId) {
        return;
      }
      runStateStore.upsert({
        sessionId: event.sessionId,
        projectPath: input.projectPath || '',
        runId: input.runId,
        status: mapActiveRunStatus(event),
        latestSequence: event.sequence,
        lastEventAt: event.timestamp,
        latestPreviewText: extractPreviewText(event),
      });
    }

    function markRunFinished(
      event: AgentEvent,
      status: Extract<SessionRunStateStatus, 'completed' | 'failed' | 'aborted'>
    ) {
      if (!event.sessionId) {
        return;
      }
      runStateStore.markFinished(event.sessionId, status, {
        runId: input.runId,
        latestSequence: event.sequence,
        lastEventAt: event.timestamp,
        latestPreviewText: extractPreviewText(event),
        lastError:
          event.type === 'run.failed' && typeof event.payload.error === 'string'
            ? event.payload.error
            : undefined,
      });
    }

    async function* stream(): AsyncIterable<AgentEvent> {
      const startedEvent = createAgentEvent({
        runId: input.runId,
        sessionId: input.sessionId,
        sequence: 1,
        type: 'run.started',
        payload: {
          projectPath: input.projectPath,
        },
      });
      upsertRunState(startedEvent);
      yield startedEvent;

      let failureSequence = 2;
      let latestSessionId = input.sessionId;
      let hasReceivedSdkEvent = false;
      try {
        const iterator = queryRun[Symbol.asyncIterator]();
        const loadNextSdkEvent = () =>
          hasReceivedSdkEvent
            ? iterator.next()
            : withTimeout(
                () => iterator.next(),
                firstEventTimeoutMs,
                `Claude 运行首个响应超时（${firstEventTimeoutMs}ms），请检查模型网关、代理配置或当前模型是否可用。`
              );
        let sdkNext = loadNextSdkEvent();
        let manualNext = manualEvents.shift();

        while (true) {
          const nextItem = await Promise.race([
            sdkNext.then((result) => ({ source: 'sdk' as const, result })),
            manualNext.then((event) => ({ source: 'manual' as const, event })),
          ]);

          if (nextItem.source === 'manual') {
            manualNext = manualEvents.shift();
            if (nextItem.event) {
              currentSessionId = nextItem.event.sessionId;
              latestSessionId = nextItem.event.sessionId;
              failureSequence = nextItem.event.sequence + 1;
              if (nextItem.event.type === 'run.completed') {
                markRunFinished(nextItem.event, 'completed');
              } else if (nextItem.event.type === 'run.failed') {
                markRunFinished(nextItem.event, 'failed');
              } else if (nextItem.event.type === 'run.aborted') {
                markRunFinished(nextItem.event, 'aborted');
              } else {
                upsertRunState(nextItem.event);
              }
              yield nextItem.event;
            }
            continue;
          }

          if (nextItem.result.done) {
            break;
          }

          hasReceivedSdkEvent = true;

          for (const event of translate(nextItem.result.value)) {
            let nextEvent = event;

            if (event.type === 'tool.call.started') {
              const toolId =
                typeof event.payload.toolId === 'string' ? event.payload.toolId : undefined;
              const toolName =
                typeof event.payload.toolName === 'string' ? event.payload.toolName : undefined;

              if (toolId && toolName) {
                allowedToolUses.set(toolId, toolName);
              }
            }

            if (event.type === 'tool.call.completed') {
              const toolId =
                typeof event.payload.toolId === 'string' ? event.payload.toolId : undefined;
              const toolName = toolId ? allowedToolUses.get(toolId) : undefined;
              const isResultEvent = 'isError' in event.payload || 'result' in event.payload;

              if (toolId && toolName && isResultEvent) {
                policySession.recordToolOutcome({
                  toolName,
                  isError: event.payload.isError === true,
                  result: event.payload.result,
                });
                allowedToolUses.delete(toolId);
              }
            }

            if (event.type === 'run.completed' || event.type === 'run.failed') {
              const auditEvents = policyAudit.events();
              if (auditEvents.length > 0 || event.type === 'run.failed') {
                nextEvent = {
                  ...event,
                  payload: {
                    ...event.payload,
                    ...(event.type === 'run.failed'
                      ? {
                          runtimeAuthSummary,
                          ...(authGuidance ? { authGuidance } : {}),
                          error:
                            typeof event.payload.error === 'string'
                              ? `${event.payload.error}\n${runtimeAuthSummary}`
                              : runtimeAuthSummary,
                        }
                      : {}),
                    policyAudit: auditEvents,
                  },
                };
              }
            }

            currentSessionId = nextEvent.sessionId;
            latestSessionId = nextEvent.sessionId;
            failureSequence = nextEvent.sequence + 1;
            if (nextEvent.type === 'run.completed') {
              markRunFinished(nextEvent, 'completed');
            } else if (nextEvent.type === 'run.failed') {
              markRunFinished(nextEvent, 'failed');
            } else if (nextEvent.type === 'run.aborted') {
              markRunFinished(nextEvent, 'aborted');
            } else {
              upsertRunState(nextEvent);
            }
            yield nextEvent;
          }
          sdkNext = loadNextSdkEvent();
        }
        if (aborted) {
          const auditEvents = policyAudit.events();
          const abortedEvent = createAgentEvent({
            runId: input.runId,
            sessionId: latestSessionId,
            sequence: failureSequence,
            type: 'run.aborted',
            payload: auditEvents.length > 0 ? { policyAudit: auditEvents } : {},
          });
          markRunFinished(abortedEvent, 'aborted');
          yield abortedEvent;
        }
      } catch (error) {
        if (!aborted) {
          await queryRun.interrupt().catch(() => {});
        }
        const auditEvents = policyAudit.events();
        const terminalEvent = createAgentEvent({
          runId: input.runId,
          sessionId: latestSessionId,
          sequence: failureSequence,
          type: aborted ? 'run.aborted' : 'run.failed',
          payload: {
            ...(aborted
              ? {}
              : {
                  error: `${error instanceof Error ? error.message : 'Runtime stream failed'}\n${runtimeAuthSummary}`,
                  runtimeAuthSummary,
                  ...(authGuidance ? { authGuidance } : {}),
                }),
            ...(auditEvents.length > 0 ? { policyAudit: auditEvents } : {}),
          },
        });
        markRunFinished(terminalEvent, aborted ? 'aborted' : 'failed');
        yield terminalEvent;
      } finally {
        manualEvents.close();
        for (const [requestId, interaction] of pendingInteractions) {
          if (interaction.runId === input.runId) {
            pendingInteractions.delete(requestId);
          }
        }
        deps.runtime.completeRun?.(input.runId);
      }
    }

    return Object.assign(stream(), {
      runId: input.runId,
      sessionId: input.sessionId,
    });
  }

  return {
    async listSessions() {
      if (!deps.historyReader.listSessions) {
        return [];
      }
      return deps.historyReader.listSessions();
    },

    async listProjects(input?: { forceRefresh?: boolean }) {
      if (!deps.historyReader.listProjects) {
        return [];
      }
      return deps.historyReader.listProjects(input);
    },

    async listProjectSessions(input: { projectPath?: string }) {
      if (!deps.historyReader.listSessions) {
        return [];
      }
      return deps.historyReader.listSessions(input);
    },

    async listProjectSessionRuns(input: { projectPath: string }): Promise<{
      projectPath: string;
      sessions: SessionRunState[];
    }> {
      runStateStore.pruneExpired();
      return {
        projectPath: input.projectPath,
        sessions: runStateStore.listByProject(input.projectPath),
      };
    },

    async getSessionRunState(input: { sessionId: string }) {
      runStateStore.pruneExpired();
      return runStateStore.get(input.sessionId);
    },

    getSessionHistory(input: { sessionId: string; projectPath?: string }) {
      return getSessionHistory({ ...input, historyReader: deps.historyReader });
    },

    abortRun(input: { runId: string }) {
      return abortRun({ ...input, runtime: deps.runtime });
    },

    resolveInteraction(input: { runId: string; requestId: string; decision: InteractionDecision }) {
      const pending = pendingInteractions.get(input.requestId);
      if (!pending || pending.runId !== input.runId) {
        return { resolved: false, reason: 'not_found' as const };
      }
      pending.emitResolved(input.decision);
      pending.resolve(input.decision);
      return { resolved: true as const };
    },

    startSessionRun(input: {
      prompt: string;
      projectPath?: string;
      browserContext?: Record<string, unknown>;
      permissionMode?: string;
      effort?: string;
      attachments?: SessionAttachment[];
      images?: Array<{ name?: string; mimeType: string; data: string }>;
    }) {
      return createRunStream({
        runId: createId('run'),
        sessionId: null,
        prompt: input.prompt,
        projectPath: input.projectPath,
        browserContext: input.browserContext,
        permissionMode: input.permissionMode,
        effort: input.effort,
        attachments: normalizeRunAttachments(input),
      });
    },

    continueSessionRun(input: {
      sessionId: string;
      prompt: string;
      projectPath?: string;
      browserContext?: Record<string, unknown>;
      permissionMode?: string;
      effort?: string;
      attachments?: SessionAttachment[];
      images?: Array<{ name?: string; mimeType: string; data: string }>;
    }) {
      return createRunStream({
        runId: createId('run'),
        sessionId: input.sessionId,
        prompt: input.prompt,
        projectPath: input.projectPath,
        browserContext: input.browserContext,
        permissionMode: input.permissionMode,
        effort: input.effort,
        attachments: normalizeRunAttachments(input),
      });
    },
  };
}
