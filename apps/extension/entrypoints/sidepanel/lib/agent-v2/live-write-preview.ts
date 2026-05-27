export type LiveWritePreviewPayload = {
  id: string;
  projectPath: string;
  filePath: string;
  content: string;
  operation?: 'write' | 'edit';
  oldString?: string;
  newString?: string;
  replaceAll?: boolean;
  targetOffset?: number;
  status: 'writing' | 'completed' | 'failed';
  updatedAt: string;
};
type BackendLivePreviewSyncInput = {
  backendBaseUrl: string;
  entryFilePath: string;
  projectPath: string;
  filePath: string;
  writeId: string;
  content?: string;
  operation?: 'write' | 'edit';
  oldString?: string;
  newString?: string;
  replaceAll?: boolean;
};
type BackendLivePreviewCompleteInput = {
  backendBaseUrl: string;
  entryFilePath: string;
  projectPath: string;
  filePath: string;
  writeId: string;
  failed?: boolean;
};

const LIVE_WRITE_PREFIX = 'agentV2.liveWritePreview:';

export function liveWritePreviewKey(projectPath: string, filePath: string) {
  return `${LIVE_WRITE_PREFIX}${projectPath}:${filePath}`;
}

export function liveWritePreviewPayloadVersion(payload: LiveWritePreviewPayload) {
  return [
    payload.id,
    payload.status,
    payload.operation || 'write',
    payload.content.length,
    payload.oldString?.length ?? 0,
    payload.newString?.length ?? 0,
    payload.updatedAt,
  ].join(':');
}

export function isLiveWritePreviewMessage(
  message: unknown
): message is { type: 'agent-v2-live-write-preview'; payload: LiveWritePreviewPayload } {
  return Boolean(
    message &&
      typeof message === 'object' &&
      (message as Record<string, unknown>).type === 'agent-v2-live-write-preview' &&
      typeof (message as { payload?: { projectPath?: unknown } }).payload?.projectPath === 'string' &&
      typeof (message as { payload?: { filePath?: unknown } }).payload?.filePath === 'string'
  );
}

export function isBackendLivePreviewFilePath(filePath: string) {
  return /\.(html?|css|m?js)$/i.test(filePath.trim());
}

export function shouldPublishBackendLivePreviewUpdate(input: {
  filePath: string;
  status: LiveWritePreviewPayload['status'];
}) {
  if (!isBackendLivePreviewFilePath(input.filePath)) {
    return false;
  }

  return input.status === 'writing' || input.status === 'completed';
}

export function shouldPublishLiveWritePreviewUpdate(input: {
  operation?: LiveWritePreviewPayload['operation'];
  content: string;
  status: LiveWritePreviewPayload['status'];
}) {
  if (input.operation === 'edit') {
    return true;
  }
  if (input.status === 'completed') {
    return true;
  }
  return input.content.trim().length > 0;
}

export function livePreviewDirectoryKey(projectPath: string, filePath: string) {
  const normalized = filePath.replace(/\\/g, '/').replace(/\/+$/, '');
  const separatorIndex = normalized.lastIndexOf('/');
  const directory = separatorIndex >= 0 ? normalized.slice(0, separatorIndex) : '';
  return `${projectPath}:${directory}`;
}

export async function publishLiveWritePreview(payload: LiveWritePreviewPayload) {
  await chrome.storage.local.set({
    [liveWritePreviewKey(payload.projectPath, payload.filePath)]: payload,
  });
  chrome.runtime.sendMessage({ type: 'agent-v2-live-write-preview', payload }).catch(() => {
    // The preview page may not be open yet. It will read the latest payload from storage.
  });
}

export async function publishBackendLivePreview(
  input: BackendLivePreviewSyncInput,
  deps: { fetch?: typeof globalThis.fetch } = {}
) {
  const fetchImpl = deps.fetch ?? fetch;
  const url = new URL('/api/preview/live', input.backendBaseUrl);
  const response = await fetchImpl(url.toString(), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      projectPath: input.projectPath,
      entryFilePath: input.entryFilePath,
      filePath: input.filePath,
      content: input.content ?? '',
      operation: input.operation,
      oldString: input.oldString,
      newString: input.newString,
      replaceAll: input.replaceAll,
      writeId: input.writeId,
    }),
  });
  if (!response.ok) {
    throw new Error(`Failed to publish backend live preview: ${response.status}`);
  }
}

export async function completeBackendLivePreview(
  input: BackendLivePreviewCompleteInput,
  deps: { fetch?: typeof globalThis.fetch } = {}
) {
  const fetchImpl = deps.fetch ?? fetch;
  const url = new URL('/api/preview/live/complete', input.backendBaseUrl);
  const response = await fetchImpl(url.toString(), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      projectPath: input.projectPath,
      entryFilePath: input.entryFilePath,
      filePath: input.filePath,
      writeId: input.writeId,
      failed: input.failed === true,
    }),
  });
  if (!response.ok) {
    throw new Error(`Failed to complete backend live preview: ${response.status}`);
  }
}

export async function readLiveWritePreview(projectPath: string, filePath: string) {
  const key = liveWritePreviewKey(projectPath, filePath);
  const stored = await chrome.storage.local.get(key);
  const payload = stored[key];
  if (
    payload &&
    typeof payload === 'object' &&
    typeof payload.id === 'string' &&
    typeof payload.projectPath === 'string' &&
    typeof payload.filePath === 'string' &&
    typeof payload.content === 'string'
  ) {
    return payload as LiveWritePreviewPayload;
  }
  return null;
}
