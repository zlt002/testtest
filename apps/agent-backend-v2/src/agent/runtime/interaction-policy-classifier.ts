export type InteractionResourceKind =
  | 'local_file_url'
  | 'workspace_file'
  | 'active_web_page'
  | 'remote_url_without_active_tab'
  | 'visual_only_task'
  | 'unknown';

export type InteractionIntentKind =
  | 'source_read'
  | 'rendered_read'
  | 'page_operate'
  | 'structured_extract'
  | 'visual_inspect';

type BrowserContextLike = {
  url?: unknown;
  tabId?: unknown;
  windowId?: unknown;
};

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value : undefined;
}

function hasVisualKeyword(prompt: string): boolean {
  return /(截图|布局|样式|渲染|视觉|像素|对比图|UI)/i.test(prompt);
}

function hasSourceKeyword(prompt: string): boolean {
  return /(源码|源文件|html|css|\bjs\b|index\.html|直接读取文件|代码结构)/i.test(prompt);
}

function extractRemoteUrl(prompt: string): string | undefined {
  const match = prompt.match(/https?:\/\/[^\s]+/i);
  return match?.[0];
}

export function classifyInteractionIntent(prompt: string): InteractionIntentKind {
  if (hasVisualKeyword(prompt)) return 'visual_inspect';
  if (/(提取|导出|列表|字段|结构化|抓取数据)/i.test(prompt)) return 'structured_extract';
  if (hasSourceKeyword(prompt)) return 'source_read';
  if (/(点击|操作|输入|填写|提交|打开菜单|切换)/i.test(prompt)) return 'page_operate';
  return 'rendered_read';
}

export function classifyInteractionResource(input: {
  prompt: string;
  browserContext?: BrowserContextLike;
  projectPath?: string;
  explicitFilePath?: string;
}) {
  const prompt = input.prompt || '';
  const url = stringValue(input.browserContext?.url);
  const explicitFilePath = stringValue(input.explicitFilePath);

  if (explicitFilePath) {
    return { kind: 'workspace_file' as const, usesBrowserContext: false };
  }

  if (url?.startsWith('file://')) {
    return { kind: 'local_file_url' as const, usesBrowserContext: true };
  }

  if (url && /^https?:\/\//i.test(url) && typeof input.browserContext?.tabId === 'number') {
    return { kind: 'active_web_page' as const, usesBrowserContext: true };
  }

  if (extractRemoteUrl(prompt)) {
    return { kind: 'remote_url_without_active_tab' as const, usesBrowserContext: false };
  }

  if (hasVisualKeyword(prompt)) {
    return { kind: 'visual_only_task' as const, usesBrowserContext: Boolean(url) };
  }

  return { kind: 'unknown' as const, usesBrowserContext: Boolean(url) };
}
