import type { DisplayMessage, SessionSubagentSnapshot } from './types';
import { deriveContinuationTodos } from './continuation';
import { getInteractionDisplayMeta } from './plan-mode';

export const PROCESS_PREVIEW_ITEM_LIMIT = 2;
const THINKING_BODY_LIMIT = 640;
const INTERNAL_PROTOCOL_PLACEHOLDER = '内部工具调用过程已隐藏';
export const SUBAGENT_WAITING_THRESHOLD_MS = 15_000;
export const SUBAGENT_STALLED_THRESHOLD_MS = 60_000;
export const SUBAGENT_AUTO_STOP_THRESHOLD_MS = 120_000;
const BACKGROUND_SUBAGENT_PLACEHOLDER = '已启动并行子代理，父代理正在等待它们返回结果。';
const BACKGROUND_TASK_PLACEHOLDER = '子代理任务已转入后台执行，父代理正在等待结果返回。';
const WEB_READER_RESULT_PLACEHOLDER = '网页读取已返回结果，正在整理摘要。';
const WEB_READER_ERROR_PLACEHOLDER = '网页读取返回未命中或内容异常，正在继续整理可用信息。';

export type RunCardStatus = 'running' | 'waiting_for_input' | 'completed' | 'failed' | 'aborted';

export type TodoItem = {
  content: string;
  status: string;
  priority?: string;
  activeForm?: string;
};

export type RunProcessItem = {
  id: string;
  timestamp: string;
  kind:
    | 'thinking'
    | 'tool_use'
    | 'tool_result'
    | 'interactive_prompt'
    | 'permission_request'
    | 'plan_approval'
    | 'session_status'
    | 'notice';
  title: string;
  body: string;
  tone?: 'neutral' | 'warning' | 'danger' | 'success';
  payload?: unknown;
};

export type RunFileReference = {
  filePath: string;
  label: string;
  projectPath?: string | null;
  source?: 'tool' | 'assistant' | 'result';
};

export type RunCard = {
  id: string;
  sessionId: string;
  runId?: string | null;
  anchorMessageId: string | null;
  cardStatus: RunCardStatus;
  headline: string;
  finalResponse: string;
  responseMessages: Array<{ id: string; timestamp: string; body: string }>;
  processItems: RunProcessItem[];
  processItemCount: number;
  previewItems: RunProcessItem[];
  todos: TodoItem[];
  files: RunFileReference[];
  activeInteraction: {
    requestId: string;
    kind: 'interactive_prompt' | 'permission_request' | 'plan_approval';
    title: string;
    toolName?: string | null;
    message?: string | null;
    input?: unknown;
  } | null;
  startedAt: string | null;
  updatedAt: string | null;
  source: 'sdk-live' | 'official-history';
  subagents: SessionSubagentSnapshot[];
};

export type SubagentRuntimeState = {
  phase: 'running' | 'waiting' | 'stalled' | 'completed' | 'failed';
  label: string;
  idleMs: number;
  detail: string | null;
};

export type SubagentWaitingSummary = {
  activeWaitingCount: number;
  waitingCount: number;
  orphanedCount: number;
  minOrphanedIdleMs: number;
  parentAdvancedBeyondOrphans: boolean;
  shouldAutoStop: boolean;
  message: string | null;
};

type SubagentWaitingSummaryOptions = {
  parentLastActivityAt?: string | number | null;
};

export type ConversationRunItem =
  | { type: 'user'; message: DisplayMessage }
  | { type: 'run'; card: RunCard };

function isCaptureFeedbackProcessItem(item: RunProcessItem) {
  const body = item.body.trim();
  return (
    /^网页已保存到\s+\S+/u.test(body) ||
    /^采集(?:选中内容|当前页面)?失败[:：]/u.test(body)
  );
}

export function getProcessPreviewItems(items: RunProcessItem[]): RunProcessItem[] {
  return items
    .filter(
      (item) =>
        item.kind !== 'notice' &&
        item.kind !== 'session_status' &&
        !isCaptureFeedbackProcessItem(item)
    )
    .slice(-PROCESS_PREVIEW_ITEM_LIMIT);
}

export function sliceConversationRunItems(
  items: ConversationRunItem[],
  limit: number
): { visibleItems: ConversationRunItem[]; hiddenCount: number } {
  const normalizedLimit = Math.max(1, Math.floor(limit));
  if (items.length <= normalizedLimit) {
    return { visibleItems: items, hiddenCount: 0 };
  }

  return {
    visibleItems: items.slice(-normalizedLimit),
    hiddenCount: items.length - normalizedLimit,
  };
}

function timeOf(value: string | null | undefined): number {
  if (!value) {
    return 0;
  }
  const time = new Date(value).getTime();
  return Number.isFinite(time) ? time : 0;
}

function formatRelativeDuration(ms: number): string {
  const totalSeconds = Math.max(0, Math.round(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (minutes <= 0) {
    return `${seconds} 秒`;
  }
  return `${minutes} 分 ${seconds} 秒`;
}

export function deriveSubagentRuntimeState(
  subagent: SessionSubagentSnapshot,
  now = Date.now()
): SubagentRuntimeState {
  if (subagent.status === 'completed') {
    return {
      phase: 'completed',
      label: '已完成',
      idleMs: 0,
      detail: null,
    };
  }
  if (subagent.status === 'failed') {
    return {
      phase: 'failed',
      label: '失败',
      idleMs: 0,
      detail: null,
    };
  }

  const lastActivityAt = timeOf(subagent.updatedAt || subagent.startedAt);
  const idleMs = lastActivityAt > 0 ? Math.max(0, now - lastActivityAt) : 0;

  if (idleMs >= SUBAGENT_STALLED_THRESHOLD_MS) {
    return {
      phase: 'stalled',
      label: '已失联',
      idleMs,
      detail: `已超过 ${formatRelativeDuration(idleMs)} 没有新活动，该子代理可能已经失联，可考虑中断或重试。`,
    };
  }
  if (idleMs >= SUBAGENT_WAITING_THRESHOLD_MS) {
    return {
      phase: 'waiting',
      label: '疑似等待工具响应',
      idleMs,
      detail: `已超过 ${formatRelativeDuration(idleMs)} 没有新活动，可能正在等待外部工具或网络响应。`,
    };
  }

  return {
    phase: 'running',
    label: '运行中',
    idleMs,
    detail: idleMs > 0 ? `最近 ${formatRelativeDuration(idleMs)} 内有新活动。` : null,
  };
}

export function summarizeSubagentWaitingState(
  subagents: SessionSubagentSnapshot[],
  now = Date.now(),
  options?: SubagentWaitingSummaryOptions
): SubagentWaitingSummary {
  const running = subagents.filter((subagent) => subagent.status === 'running');
  if (running.length === 0) {
    return {
      activeWaitingCount: 0,
      waitingCount: 0,
      orphanedCount: 0,
      minOrphanedIdleMs: 0,
      parentAdvancedBeyondOrphans: false,
      shouldAutoStop: false,
      message: null,
    };
  }

  const states = running.map((subagent) => deriveSubagentRuntimeState(subagent, now));
  const activeWaitingCount = states.filter(
    (state) => state.phase === 'running' || state.phase === 'waiting'
  ).length;
  const waitingCount = states.filter((state) => state.phase === 'waiting').length;
  const orphanedStates = states.filter((state) => state.phase === 'stalled');
  const orphanedCount = orphanedStates.length;
  const minOrphanedIdleMs =
    orphanedStates.length > 0
      ? orphanedStates.reduce((min, state) => Math.min(min, state.idleMs), Number.POSITIVE_INFINITY)
      : 0;
  const latestRunningSubagentActivityAt = running.reduce((max, subagent) => {
    return Math.max(max, timeOf(subagent.updatedAt || subagent.startedAt));
  }, 0);
  const parentLastActivityAt =
    typeof options?.parentLastActivityAt === 'number'
      ? options.parentLastActivityAt
      : timeOf(options?.parentLastActivityAt);
  const parentAdvancedBeyondOrphans =
    parentLastActivityAt > 0 &&
    latestRunningSubagentActivityAt > 0 &&
    parentLastActivityAt > latestRunningSubagentActivityAt;
  const shouldAutoStop =
    orphanedCount > 0 &&
    activeWaitingCount === 0 &&
    !parentAdvancedBeyondOrphans &&
    minOrphanedIdleMs >= SUBAGENT_AUTO_STOP_THRESHOLD_MS;

  if (activeWaitingCount > 0 && orphanedCount > 0) {
    return {
      activeWaitingCount,
      waitingCount,
      orphanedCount,
      minOrphanedIdleMs,
      parentAdvancedBeyondOrphans,
      shouldAutoStop,
      message: `父代理正在等待 ${activeWaitingCount} 个活跃子代理返回，另有 ${orphanedCount} 个失联子代理可能不会再返回。`,
    };
  }
  if (orphanedCount > 0 && activeWaitingCount === 0 && parentAdvancedBeyondOrphans) {
    return {
      activeWaitingCount,
      waitingCount,
      orphanedCount,
      minOrphanedIdleMs,
      parentAdvancedBeyondOrphans,
      shouldAutoStop,
      message: `检测到 ${orphanedCount} 个失联子代理，但父代理已经继续执行，当前不会因这些尾部子代理自动中断。`,
    };
  }
  if (orphanedCount > 0 && activeWaitingCount === 0) {
    return {
      activeWaitingCount,
      waitingCount,
      orphanedCount,
      minOrphanedIdleMs,
      parentAdvancedBeyondOrphans,
      shouldAutoStop,
      message: `检测到 ${orphanedCount} 个失联子代理，父代理可能不会再收到它的返回。`,
    };
  }
  if (waitingCount > 0) {
    return {
      activeWaitingCount,
      waitingCount,
      orphanedCount,
      minOrphanedIdleMs,
      parentAdvancedBeyondOrphans,
      shouldAutoStop,
      message: `父代理正在等待 ${activeWaitingCount} 个活跃子代理返回，其中 ${waitingCount} 个疑似等待工具响应。`,
    };
  }
  return {
    activeWaitingCount,
    waitingCount,
    orphanedCount,
    minOrphanedIdleMs,
    parentAdvancedBeyondOrphans,
    shouldAutoStop,
    message: `父代理正在等待 ${activeWaitingCount} 个活跃子代理返回。`,
  };
}

export function buildSubagentWaitingSummary(
  subagents: SessionSubagentSnapshot[],
  now = Date.now(),
  options?: SubagentWaitingSummaryOptions
): string | null {
  return summarizeSubagentWaitingState(subagents, now, options).message;
}

function compactPreview(value: unknown): string {
  if (value === null || value === undefined) {
    return '';
  }
  if (typeof value === 'string') {
    return sanitizeUserVisibleProcessText(value).replace(/\s+/g, ' ').slice(0, 220);
  }
  if (Array.isArray(value)) {
    const localized = value
      .map((item) => compactPreview(item))
      .filter(Boolean)
      .join(' ');
    return localized.slice(0, 220);
  }
  if (isBackgroundTaskPayload(value)) {
    return BACKGROUND_TASK_PLACEHOLDER;
  }
  try {
    return JSON.stringify(value).replace(/\s+/g, ' ').slice(0, 220);
  } catch {
    return String(value).slice(0, 220);
  }
}

function isBackgroundTaskPayload(value: unknown): value is {
  task_id: string;
  block?: boolean;
  timeout?: number;
} {
  return Boolean(
    value &&
      typeof value === 'object' &&
      typeof (value as Record<string, unknown>).task_id === 'string'
  );
}

export function sanitizeUserVisibleProcessText(value: string): string {
  const normalized = value.trim().replace(/\s+/g, ' ');
  if (!normalized) {
    return value;
  }

  if (/^i['’]ve launched .*agents? in the background/i.test(normalized)) {
    return BACKGROUND_SUBAGENT_PLACEHOLDER;
  }

  if (
    normalized.includes('"task_id"') &&
    normalized.includes('"block"') &&
    normalized.includes('"timeout"')
  ) {
    return BACKGROUND_TASK_PLACEHOLDER;
  }

  if (/webreader_result_summary/i.test(normalized)) {
    return /not found|404|error|failed/i.test(normalized)
      ? WEB_READER_ERROR_PLACEHOLDER
      : WEB_READER_RESULT_PLACEHOLDER;
  }

  if (/z\.ai built-in tool:\s*webreader/i.test(normalized)) {
    return /not found|404|error|failed/i.test(normalized)
      ? WEB_READER_ERROR_PLACEHOLDER
      : '正在调用网页读取工具获取资料。';
  }

  return normalized;
}

function labelForFilePath(filePath: string): string {
  const normalized = filePath
    .replace(/^file:\/\//, '')
    .replace(/[?#].*$/, '')
    .replace(/\/+$/, '');
  return decodeURIComponent(normalized.split('/').filter(Boolean).at(-1) || normalized || '文件');
}

function normalizeFilePath(value: string): string | null {
  const trimmed = value
    .trim()
    .replace(/^['"`([{<]+/, '')
    .replace(/[,'"`)\]}>\u3002\uff0c;；:：]+$/, '');
  if (!trimmed) {
    return null;
  }

  if (trimmed.startsWith('file://')) {
    try {
      return decodeURIComponent(new URL(trimmed).pathname);
    } catch {
      return decodeURIComponent(trimmed.slice('file://'.length));
    }
  }

  return trimmed;
}

function isLikelyFilePath(value: string): boolean {
  const normalized = normalizeFilePath(value);
  if (!normalized) {
    return false;
  }
  if (normalized.startsWith('/')) {
    return /\/[^/]+\.[A-Za-z0-9]{1,12}$/.test(normalized);
  }
  return (
    normalized.includes('/') &&
    !normalized.includes('://') &&
    !/\s/.test(normalized) &&
    /\/[^/]+\.[A-Za-z0-9]{1,12}$/.test(normalized)
  );
}

function addFileReference(
  files: RunFileReference[],
  seen: Set<string>,
  filePath: string,
  source: RunFileReference['source']
) {
  const normalized = normalizeFilePath(filePath);
  if (!normalized || !isLikelyFilePath(normalized)) {
    return;
  }

  const key = normalized;
  if (seen.has(key)) {
    return;
  }
  seen.add(key);
  files.push({
    filePath: normalized,
    label: labelForFilePath(normalized),
    source,
  });
}

function collectFileReferencesFromText(
  files: RunFileReference[],
  seen: Set<string>,
  text: string,
  source: RunFileReference['source']
) {
  const candidates: Array<{ index: number; value: string }> = [];

  for (const match of text.matchAll(/file:\/\/\/[^\s"'`)\]}>\u3002\uff0c，;；]+/g)) {
    candidates.push({ index: match.index ?? 0, value: match[0] });
  }

  for (const match of text.matchAll(
    /\/(?:Users|Volumes|private|tmp|var|home|opt)\/[^\s"'`)\]}>\u3002\uff0c，;；]+/g
  )) {
    candidates.push({ index: match.index ?? 0, value: match[0] });
  }

  const relativePattern =
    /(?:^|[\s("'`])((?:\.{1,2}\/)?(?:[A-Za-z0-9_.@-]+\/)+[A-Za-z0-9_.@+-]+\.[A-Za-z0-9]{1,12})(?=$|[\s)"'`,\]}\u3002\uff0c，;；])/g;
  for (const match of text.matchAll(relativePattern)) {
    candidates.push({ index: match.index ?? 0, value: match[1] });
  }

  for (const candidate of candidates.sort((left, right) => left.index - right.index)) {
    addFileReference(files, seen, candidate.value, source);
  }
}

function collectFileReferencesFromStructuredValue(
  files: RunFileReference[],
  seen: Set<string>,
  value: unknown,
  source: RunFileReference['source'],
  depth = 0
) {
  if (depth > 4 || value === null || value === undefined) {
    return;
  }

  if (typeof value === 'string') {
    collectFileReferencesFromText(files, seen, value, source);
    return;
  }

  if (Array.isArray(value)) {
    for (const item of value) {
      collectFileReferencesFromStructuredValue(files, seen, item, source, depth + 1);
    }
    return;
  }

  if (typeof value !== 'object') {
    return;
  }

  const record = value as Record<string, unknown>;
  for (const key of ['file_path', 'filePath', 'path']) {
    const filePath = record[key];
    if (typeof filePath === 'string') {
      addFileReference(files, seen, filePath, source);
    }
  }

  for (const key of ['files', 'filePaths', 'paths', 'result', 'output', 'payload']) {
    if (key in record) {
      collectFileReferencesFromStructuredValue(files, seen, record[key], source, depth + 1);
    }
  }
}

function filesFromMessages(messages: DisplayMessage[]): RunFileReference[] {
  const files: RunFileReference[] = [];
  const seen = new Set<string>();

  for (const message of messages) {
    if (message.kind === 'tool_call') {
      collectFileReferencesFromStructuredValue(files, seen, message.toolInput, 'tool');
      continue;
    }
    if (message.kind === 'tool_result') {
      collectFileReferencesFromStructuredValue(files, seen, message.toolResult, 'result');
      continue;
    }
    if (message.role === 'assistant' && typeof message.text === 'string') {
      collectFileReferencesFromText(files, seen, message.text, 'assistant');
    }
  }

  return files;
}

function partialJsonPreview(value: unknown): string {
  if (!value || typeof value !== 'object') {
    return '';
  }
  const partialJson = (value as Record<string, unknown>).partialJson;
  return typeof partialJson === 'string' && partialJson
    ? `正在接收工具参数 ${partialJson.length} 字符`
    : '';
}

function isTodoToolName(toolName: unknown): boolean {
  const normalized = typeof toolName === 'string' ? toolName.trim().toLowerCase() : '';
  return normalized === 'todowrite' || normalized === 'todoread';
}

function isTodoItem(value: unknown): value is TodoItem {
  return Boolean(
    value &&
      typeof value === 'object' &&
      typeof (value as Record<string, unknown>).content === 'string' &&
      typeof (value as Record<string, unknown>).status === 'string'
  );
}

const TODO_CONTENT_LOCALIZATION_RULES: Array<[pattern: RegExp, replacement: string]> = [
  [/^explore project context and understand codebase$/i, '了解项目上下文并理解代码库'],
  [/^explore project context$/i, '了解项目上下文'],
  [/^offer visual companion(?: \(if visual questions ahead\))?$/i, '提供可视化辅助'],
  [/^clarify user['’]s specific needs and constraints$/i, '明确用户的具体需求和约束'],
  [/^ask clarifying questions$/i, '确认需求问题'],
  [/^propose 2-3 approaches(?: with trade-offs)?$/i, '提出 2-3 个方案并说明权衡'],
  [/^present design(?: sections incrementally)?$/i, '分阶段呈现设计方案'],
  [/^write design doc(?: to .+)?$/i, '编写设计文档'],
  [/^spec self-review$/i, '自检设计文档'],
  [/^user reviews written spec$/i, '等待用户评审文档'],
  [/^transition to implementation$/i, '进入实现阶段'],
];

export function localizeTodoContent(content: string) {
  const trimmed = content.trim();
  if (!trimmed) {
    return content;
  }

  for (const [pattern, replacement] of TODO_CONTENT_LOCALIZATION_RULES) {
    if (pattern.test(trimmed)) {
      return replacement;
    }
  }

  return content;
}

function extractTodos(value: unknown): TodoItem[] {
  if (Array.isArray(value)) {
    return value
      .filter(isTodoItem)
      .map((todo) => ({ ...todo, content: localizeTodoContent(todo.content) }));
  }
  if (typeof value === 'string') {
    try {
      return extractTodos(JSON.parse(value));
    } catch {
      return [];
    }
  }
  if (!value || typeof value !== 'object') {
    return [];
  }
  const record = value as Record<string, unknown>;
  for (const key of [
    'todos',
    'newTodos',
    'oldTodos',
    'input',
    'output',
    'result',
    'toolInput',
    'payload',
  ]) {
    const todos = extractTodos(record[key]);
    if (todos.length > 0) {
      return todos;
    }
  }
  return [];
}

function todosFromMessage(message: DisplayMessage): TodoItem[] {
  if (!isTodoToolName(message.toolName)) {
    return [];
  }
  return [...extractTodos(message.toolInput), ...extractTodos(message.toolResult)];
}

function continuationTodosFromMessage(message: DisplayMessage): TodoItem[] {
  if (message.role !== 'user' || message.kind !== 'text' || typeof message.text !== 'string') {
    return [];
  }
  return deriveContinuationTodos(message.text).map((todo) => ({
    ...todo,
    content: localizeTodoContent(todo.content),
  }));
}

function processItemFromMessage(message: DisplayMessage): RunProcessItem | null {
  if (message.kind === 'tool_call') {
    const title = message.toolName ? `工具调用 · ${message.toolName}` : '工具调用';
    return {
      id: message.id,
      timestamp: message.timestamp,
      kind: 'tool_use',
      title,
      body:
        compactPreview(message.toolInput) || partialJsonPreview(message.raw) || '工具调用已开始',
      payload:
        message.toolInput ??
        (message.raw &&
        typeof message.raw === 'object' &&
        'partialJson' in (message.raw as Record<string, unknown>)
          ? (message.raw as Record<string, unknown>).partialJson
          : undefined),
    };
  }

  if (message.kind === 'tool_result') {
    const title = message.toolName ? `工具结果 · ${message.toolName}` : '工具结果';
    return {
      id: message.id,
      timestamp: message.timestamp,
      kind: 'tool_result',
      title,
      body:
        compactPreview(message.toolResult) || (message.isError ? '工具调用失败' : '工具调用完成'),
      tone: message.isError ? 'danger' : 'success',
      payload: message.toolResult,
    };
  }

  if (message.kind === 'thinking') {
    const sanitizedThinking = sanitizeThinkingContent(message.text || '正在思考');
    return {
      id: message.id,
      timestamp: message.timestamp,
      kind: 'thinking',
      title: '思考',
      body: truncateThinkingBody(sanitizedThinking),
      payload: sanitizedThinking,
    };
  }

  if (message.kind === 'run_status') {
    if (message.status === 'session_bound') {
      return null;
    }
    return {
      id: message.id,
      timestamp: message.timestamp,
      kind: 'session_status',
      title: '会话状态',
      body: message.status || '状态更新',
      payload: message.raw,
    };
  }

  if (message.kind === 'interaction') {
    const kind =
      message.interactionKind === 'interactive_prompt'
        ? 'interactive_prompt'
        : message.interactionKind === 'plan_approval'
          ? 'plan_approval'
          : 'permission_request';
    const display = getInteractionDisplayMeta(kind);
    return {
      id: message.id,
      timestamp: message.timestamp,
      kind,
      title: display.title,
      body: message.text || compactPreview(message.toolInput) || '等待你处理',
      tone: display.tone,
      payload: message.toolInput ?? message.raw,
    };
  }

  if (message.kind === 'error') {
    return {
      id: message.id,
      timestamp: message.timestamp,
      kind: 'session_status',
      title: '执行失败',
      body: message.text || '运行失败',
      tone: 'danger',
      payload: message.raw,
    };
  }

  return null;
}

function truncateThinkingBody(value: string): string {
  if (value.length <= THINKING_BODY_LIMIT) {
    return value;
  }
  return `${value.slice(0, THINKING_BODY_LIMIT)}...（已截断）`;
}

function sanitizeThinkingContent(value: string): string {
  const normalized = typeof value === 'string' ? value : '';
  if (!normalized.trim()) {
    return '正在思考';
  }

  let sanitized = normalized;
  const cutMarkers = ['<|DSML|', '<｜DSML｜', '<webmcp_browser_tool_instruction>'];
  let cutIndex = -1;
  for (const marker of cutMarkers) {
    const index = sanitized.indexOf(marker);
    if (index !== -1 && (cutIndex === -1 || index < cutIndex)) {
      cutIndex = index;
    }
  }
  if (cutIndex !== -1) {
    sanitized = sanitized.slice(0, cutIndex);
  }

  sanitized = sanitized
    .replace(/mcp__[\w.:/-]+\([^)]*\)/g, INTERNAL_PROTOCOL_PLACEHOLDER)
    .replace(/tool[_-]?calls?/gi, INTERNAL_PROTOCOL_PLACEHOLDER)
    .replace(/<\|[^>]*\|>/g, ' ')
    .replace(/<｜[^>]*｜>/g, ' ')
    .replace(/\{\s*"html"\s*:\s*"[\s\S]*?\}\s*$/g, INTERNAL_PROTOCOL_PLACEHOLDER)
    .replace(/\s+/g, ' ')
    .trim();

  if (!sanitized) {
    return INTERNAL_PROTOCOL_PLACEHOLDER;
  }

  if (sanitized === INTERNAL_PROTOCOL_PLACEHOLDER) {
    return sanitized;
  }

  return sanitizeUserVisibleProcessText(sanitized);
}

function mergeAdjacentThinkingItems(items: RunProcessItem[]): RunProcessItem[] {
  const merged: RunProcessItem[] = [];

  for (const item of items) {
    const previous = merged.at(-1);
    if (item.kind === 'thinking' && previous?.kind === 'thinking') {
      previous.id = `${previous.id}-${item.id}`;
      previous.timestamp = item.timestamp;
      const previousPayload = typeof previous.payload === 'string' ? previous.payload : previous.body;
      const currentPayload = typeof item.payload === 'string' ? item.payload : item.body;
      const mergedPayload = `${previousPayload}${currentPayload}`;
      previous.payload = mergedPayload;
      previous.body = truncateThinkingBody(mergedPayload);
      continue;
    }
    merged.push(item);
  }

  return merged;
}

function statusFromMessages(messages: DisplayMessage[]): RunCardStatus {
  const statuses = messages
    .filter((message) => message.kind === 'run_status' || message.kind === 'error')
    .map((message) => message.status || message.kind);
  if (statuses.includes('failed') || messages.some((message) => message.kind === 'error')) {
    return 'failed';
  }
  if (statuses.includes('aborted')) {
    return 'aborted';
  }
  if (statuses.includes('completed')) {
    return 'completed';
  }
  return 'running';
}

function headlineForStatus(status: RunCardStatus): string {
  if (status === 'failed') {
    return '执行失败';
  }
  if (status === 'aborted') {
    return '已中止';
  }
  if (status === 'completed') {
    return '已完成';
  }
  if (status === 'waiting_for_input') {
    return '等待你的回答';
  }
  return '执行中';
}

function buildRunCard(input: {
  id: string;
  sessionId: string;
  runId?: string | null;
  anchorMessageId: string | null;
  messages: DisplayMessage[];
  source: RunCard['source'];
}): RunCard {
  const sorted = [...input.messages].sort((left, right) => {
    const timeDelta = timeOf(left.timestamp) - timeOf(right.timestamp);
    return timeDelta || (left.sequence ?? 0) - (right.sequence ?? 0);
  });
  const responseMessages = sorted
    .filter((message) => message.role === 'assistant' && message.kind === 'text' && message.text)
    .map((message) => ({
      id: message.id,
      timestamp: message.timestamp,
      body: message.text || '',
    }));
  const allProcessItems = mergeAdjacentThinkingItems(
    sorted.map(processItemFromMessage).filter((item): item is RunProcessItem => Boolean(item))
  );
  const processItems = allProcessItems;
  const toolTodos = sorted.flatMap(todosFromMessage);
  const continuationTodos =
    toolTodos.length > 0 ? [] : sorted.flatMap(continuationTodosFromMessage);
  const todos = toolTodos.length > 0 ? toolTodos : continuationTodos;
  const files = filesFromMessages(sorted);
  const latestInteraction = [...sorted]
    .reverse()
    .find((message) => message.kind === 'interaction' && message.requestId);
  const latestInteractionRequestId = latestInteraction?.requestId || null;
  const latestInteractionResolved =
    latestInteractionRequestId === null
      ? null
      : [...sorted].reverse().find((message) => {
          if (message.kind !== 'run_status' || message.status !== 'interaction_resolved') {
            return false;
          }
          if (!message.raw || typeof message.raw !== 'object') {
            return false;
          }
          return (message.raw as { requestId?: unknown }).requestId === latestInteractionRequestId;
        });
  const latestInteractionResult =
    latestInteractionRequestId === null
      ? null
      : [...sorted].reverse().find(
          (message) =>
            message.kind === 'tool_result' && message.toolId === latestInteractionRequestId
        );
  const hasActiveInteraction = Boolean(
    latestInteraction &&
      (!latestInteractionResolved ||
        timeOf(latestInteractionResolved.timestamp) < timeOf(latestInteraction.timestamp)) &&
      (!latestInteractionResult ||
        timeOf(latestInteractionResult.timestamp) < timeOf(latestInteraction.timestamp))
  );
  const cardStatus = statusFromMessages(sorted);

  return {
    id: input.id,
    sessionId: input.sessionId,
    runId: input.runId,
    anchorMessageId: input.anchorMessageId,
    cardStatus: hasActiveInteraction ? 'waiting_for_input' : cardStatus,
    headline: headlineForStatus(hasActiveInteraction ? 'waiting_for_input' : cardStatus),
    finalResponse: responseMessages.map((message) => message.body).join('\n\n'),
    responseMessages,
    processItems,
    processItemCount: allProcessItems.length,
    previewItems: getProcessPreviewItems(processItems),
    todos,
    files,
    activeInteraction:
      hasActiveInteraction && latestInteraction
        ? {
            requestId: latestInteraction.requestId || '',
            kind:
              latestInteraction.interactionKind === 'interactive_prompt'
                ? 'interactive_prompt'
                : latestInteraction.interactionKind === 'plan_approval'
                  ? 'plan_approval'
                  : 'permission_request',
            title: getInteractionDisplayMeta(
              latestInteraction.interactionKind === 'interactive_prompt'
                ? 'interactive_prompt'
                : latestInteraction.interactionKind === 'plan_approval'
                  ? 'plan_approval'
                  : 'permission_request'
            ).title,
            toolName: latestInteraction.toolName,
            message: latestInteraction.text,
            input: latestInteraction.toolInput,
          }
        : null,
    startedAt: sorted[0]?.timestamp || null,
    updatedAt: sorted.at(-1)?.timestamp || null,
    source: input.source,
    subagents: [],
  };
}

function nearestUserAround(users: DisplayMessage[], timestamp: string): DisplayMessage | null {
  const target = timeOf(timestamp);
  let selected: DisplayMessage | null = null;
  for (const user of users) {
    if (timeOf(user.timestamp) <= target) {
      selected = user;
    }
  }
  if (selected) {
    return selected;
  }

  for (const user of users) {
    if (timeOf(user.timestamp) >= target) {
      return user;
    }
  }

  return null;
}

export function projectConversationRunItems(messages: DisplayMessage[]): ConversationRunItem[] {
  const sorted = [...messages].sort((left, right) => {
    const timeDelta = timeOf(left.timestamp) - timeOf(right.timestamp);
    return timeDelta || (left.sequence ?? 0) - (right.sequence ?? 0);
  });
  const users = sorted.filter((message) => message.role === 'user' && message.kind === 'text');
  const runGroups = new Map<string, DisplayMessage[]>();
  const noRunMessages = sorted.filter((message) => {
    if (message.runId) {
      const current = runGroups.get(message.runId) || [];
      current.push(message);
      runGroups.set(message.runId, current);
      return false;
    }
    return message.role !== 'user';
  });

  const cards: RunCard[] = [];

  for (const [runId, group] of runGroups) {
    const firstTimestamp = group[0]?.timestamp || '';
    const anchor =
      group.find((message) => message.role === 'user' && message.kind === 'text') ||
      nearestUserAround(users, firstTimestamp);
    cards.push(
      buildRunCard({
        id: runId,
        sessionId: group.find((message) => message.sessionId)?.sessionId || anchor?.sessionId || '',
        runId,
        anchorMessageId: anchor?.id || null,
        messages: group,
        source: 'sdk-live',
      })
    );
  }

  let currentAnchor: DisplayMessage | null = null;
  let currentGroup: DisplayMessage[] = [];
  const flushHistoricalGroup = () => {
    if (!currentAnchor || currentGroup.length === 0) {
      currentGroup = [];
      return;
    }
    cards.push(
      buildRunCard({
        id: `history-${currentAnchor.id}`,
        sessionId: currentAnchor.sessionId,
        anchorMessageId: currentAnchor.id,
        messages: currentGroup,
        source: 'official-history',
      })
    );
    currentGroup = [];
  };

  for (const message of sorted.filter((item) => !item.runId)) {
    if (message.role === 'user') {
      flushHistoricalGroup();
      currentAnchor = message;
      continue;
    }
    if (currentAnchor && noRunMessages.includes(message)) {
      currentGroup.push(message);
    }
  }
  flushHistoricalGroup();

  const cardsByAnchor = new Map<string, RunCard[]>();
  const unanchoredCards: RunCard[] = [];
  for (const card of cards.sort(
    (left, right) => timeOf(left.startedAt) - timeOf(right.startedAt)
  )) {
    if (!card.anchorMessageId) {
      unanchoredCards.push(card);
      continue;
    }
    const current = cardsByAnchor.get(card.anchorMessageId) || [];
    current.push(card);
    cardsByAnchor.set(card.anchorMessageId, current);
  }

  const items: ConversationRunItem[] = [];
  for (const user of users) {
    items.push({ type: 'user', message: user });
    const anchoredCards = cardsByAnchor.get(user.id) || [];
    const hasLiveCard = anchoredCards.some((card) => card.source === 'sdk-live');
    const visibleCards = hasLiveCard
      ? anchoredCards.filter((card) => card.source === 'sdk-live')
      : anchoredCards;
    for (const card of visibleCards) {
      items.push({ type: 'run', card });
    }
  }
  for (const card of unanchoredCards) {
    items.push({ type: 'run', card });
  }

  return items;
}

export function attachSubagentsToConversationItems(input: {
  items: ConversationRunItem[];
  runId: string | null;
  subagents: SessionSubagentSnapshot[];
}): ConversationRunItem[] {
  if (!input.runId || input.subagents.length === 0) {
    return input.items;
  }

  return input.items.map((item) => {
    if (item.type !== 'run' || item.card.runId !== input.runId) {
      return item;
    }
    return {
      ...item,
      card: {
        ...item.card,
        subagents: input.subagents,
      },
    };
  });
}
