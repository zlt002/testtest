import type { AgentBackendV2Env } from '../../config/env.ts';
import { normalizePermissionMode } from './permissions.ts';

const BROWSER_EXTENSION_ALLOWED_TOOLS = [
  'mcp__browser_extension__read_current_page_content',
  'mcp__browser_extension__snapshot_locate_dom',
  'mcp__browser_extension__snapshot_find_css',
  'mcp__browser_extension__snapshot_patch_html',
  'mcp__browser_extension__snapshot_patch_css',
  'mcp__browser_extension__snapshot_patch_css_batch',
  'mcp__browser_extension__list_website_tools',
  'mcp__browser_extension__list_extension_tools',
  'mcp__browser_extension__call_website_tool',
  'mcp__browser_extension__call_extension_tool',
];

const EFFORT_LEVELS = new Set(['low', 'medium', 'high', 'xhigh', 'max']);

function supportsReasoningEffort(sdkEnv: Record<string, string | undefined> | undefined): boolean {
  const anthropicBaseUrl = sdkEnv?.ANTHROPIC_BASE_URL?.trim();
  if (!anthropicBaseUrl) {
    return true;
  }

  try {
    const url = new URL(anthropicBaseUrl);
    return url.hostname === 'api.anthropic.com';
  } catch {
    return false;
  }
}

function allowedToolsForMcpServers(mcpServers: Record<string, unknown> | undefined): string[] {
  if (!mcpServers || !Object.hasOwn(mcpServers, 'browser_extension')) {
    return [];
  }

  return BROWSER_EXTENSION_ALLOWED_TOOLS;
}

function mergeSystemPrompt(input: {
  appendSystemPrompt?: string;
  systemPrompt?:
    | string
    | string[]
    | {
        type: 'preset';
        preset: 'claude_code';
        append?: string;
        excludeDynamicSections?: boolean;
      };
}) {
  const appendSystemPrompt = input.appendSystemPrompt?.trim();
  if (!appendSystemPrompt) {
    return input.systemPrompt;
  }

  if (!input.systemPrompt) {
    return {
      type: 'preset' as const,
      preset: 'claude_code' as const,
      append: appendSystemPrompt,
    };
  }

  if (typeof input.systemPrompt === 'string') {
    return `${appendSystemPrompt}\n\n${input.systemPrompt}`;
  }

  if (Array.isArray(input.systemPrompt)) {
    return [appendSystemPrompt, ...input.systemPrompt];
  }

  const existingAppend = input.systemPrompt.append?.trim();
  return {
    ...input.systemPrompt,
    append: existingAppend ? `${appendSystemPrompt}\n\n${existingAppend}` : appendSystemPrompt,
  };
}

export function buildClaudeRequestOptions(input: {
  env: AgentBackendV2Env;
  projectPath?: string;
  model?: string | null;
  mcpServers?: Record<string, unknown>;
  allowedTools?: string[];
  useDefaultAllowedTools?: boolean;
  disallowedTools?: string[];
  permissionMode?: string;
  effort?: string;
  resume?: string;
  settingSources?: Array<'user' | 'project' | 'local'>;
  skills?: string[] | 'all';
  plugins?: Array<{ type: 'local'; path: string }>;
  sdkEnv?: Record<string, string | undefined>;
  systemPrompt?:
    | string
    | string[]
    | {
        type: 'preset';
        preset: 'claude_code';
        append?: string;
        excludeDynamicSections?: boolean;
      };
  appendSystemPrompt?: string;
}) {
  const allowedTools =
    input.allowedTools !== undefined
      ? input.allowedTools
      : input.useDefaultAllowedTools === false
        ? undefined
        : allowedToolsForMcpServers(input.mcpServers);
  return {
    cwd: input.projectPath || input.env.workdir,
    model: input.model || input.env.model || undefined,
    resume: input.resume,
    mcpServers: input.mcpServers,
    pathToClaudeCodeExecutable: input.env.claudeCodeExecutablePath || undefined,
    allowedTools,
    disallowedTools: input.disallowedTools,
    includePartialMessages: true,
    permissionMode: normalizePermissionMode(input.permissionMode),
    effort:
      input.effort && EFFORT_LEVELS.has(input.effort) && supportsReasoningEffort(input.sdkEnv)
        ? input.effort
        : undefined,
    settingSources: input.settingSources || ['user', 'project', 'local'],
    skills: input.skills,
    plugins: input.plugins,
    systemPrompt: mergeSystemPrompt(input),
    allowDangerouslySkipPermissions: input.permissionMode === 'bypassPermissions',
    env: {
      ...process.env,
      ...(input.sdkEnv || {}),
    },
  };
}
