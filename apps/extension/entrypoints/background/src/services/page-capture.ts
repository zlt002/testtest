import type { CaptureWorkbenchMetadata } from './page-capture-workspace';
import { ensureCompanionReady } from './NativeHostManager';
import {
  isPageCaptureResult,
  type PageCaptureArtifact,
  type PageCaptureMode,
  type PageCaptureRequest,
} from './page-capture-types';
import { type PageCaptureWorkspaceClient, saveCaptureToWorkspace } from './page-capture-workspace';

export const PAGE_CAPTURE_TIMEOUT_MS = 30_000;
export const PAGE_CAPTURE_COMPANION_TIMEOUT_MS = 10_000;
export const PAGE_CAPTURE_WORKSPACE_REQUEST_TIMEOUT_MS = 15_000;
const AGENT_V2_PROJECT_SELECTION_STORAGE_KEY = 'agentV2.selectedProject';

function isSupportedPageCaptureUrl(url: string | undefined): boolean {
  if (!url) {
    return false;
  }

  return !/^(chrome|chrome-extension|edge|about):/i.test(url);
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, message: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = globalThis.setTimeout(() => {
      reject(new Error(message));
    }, timeoutMs);

    promise.then(
      (value) => {
        globalThis.clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        globalThis.clearTimeout(timer);
        reject(error);
      }
    );
  });
}

function requestWorkspaceWrite(
  agentBaseUrl: string,
  path: '/api/files/entries' | '/api/files/content',
  body: unknown
) {
  return withTimeout(
    fetch(`${agentBaseUrl}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }),
    PAGE_CAPTURE_WORKSPACE_REQUEST_TIMEOUT_MS,
    '写入当前工作区超时，请确认本地 Agent Backend 正在运行'
  );
}

async function getCurrentWorkspaceProjectPath(overrideProjectPath?: string): Promise<string> {
  const normalizedProjectPath = overrideProjectPath?.trim();
  if (normalizedProjectPath) {
    return normalizedProjectPath;
  }

  const stored = await chrome.storage.local.get(AGENT_V2_PROJECT_SELECTION_STORAGE_KEY);
  const selection = stored[AGENT_V2_PROJECT_SELECTION_STORAGE_KEY];
  const storedProjectPath =
    typeof selection === 'object' && selection !== null
      ? (selection as { projectPath?: unknown }).projectPath
      : undefined;

  if (typeof storedProjectPath !== 'string' || !storedProjectPath) {
    throw new Error('请先选择当前工作区后再采集网页');
  }

  return storedProjectPath;
}

function createAgentWorkspaceClient(agentBaseUrl: string): PageCaptureWorkspaceClient {
  return {
    async createEntry(input) {
      const response = await requestWorkspaceWrite(agentBaseUrl, '/api/files/entries', input);
      if (!response.ok) {
        throw new Error(`Failed to create file entry: ${response.status}`);
      }
    },

    async writeFile(input) {
      const response = await requestWorkspaceWrite(agentBaseUrl, '/api/files/content', input);
      if (!response.ok) {
        throw new Error(`Failed to write file: ${response.status}`);
      }
    },
  };
}

export async function beginPageCapture(input: {
  mode: PageCaptureMode;
  target?: PageCaptureRequest['target'];
}): Promise<PageCaptureArtifact> {
  const [activeTab] = await chrome.tabs.query({
    active: true,
    currentWindow: true,
  });

  if (activeTab?.id === undefined) {
    throw new Error('未找到当前活动页面');
  }

  if (!isSupportedPageCaptureUrl(activeTab.url)) {
    throw new Error('当前页面不支持采集');
  }

  const request: PageCaptureRequest = {
    type: 'page-capture',
    mode: input.mode,
    requestId: globalThis.crypto.randomUUID(),
    target: input.target,
  };

  const response = await withTimeout(
    chrome.tabs.sendMessage(activeTab.id, request),
    PAGE_CAPTURE_TIMEOUT_MS,
    '页面采集超时'
  );

  if (!isPageCaptureResult(response)) {
    throw new Error('页面采集未返回结果');
  }

  if (!response.success) {
    throw new Error(response.error || '页面采集失败');
  }

  if (!response.artifact) {
    throw new Error('页面采集未返回内容');
  }

  return response.artifact;
}

export async function capturePageToCurrentWorkspace(input: {
  mode: PageCaptureMode;
  projectPath?: string;
  target?: PageCaptureRequest['target'];
  workbench?: CaptureWorkbenchMetadata;
}) {
  const projectPath = await getCurrentWorkspaceProjectPath(input.projectPath);
  const artifact = await beginPageCapture(input);
  const discovery = await withTimeout(
    ensureCompanionReady(),
    PAGE_CAPTURE_COMPANION_TIMEOUT_MS,
    '等待 Companion 就绪超时，请确认本地服务已启动'
  );
  const agentClient = createAgentWorkspaceClient(discovery.agentBaseUrl);

  if (input.workbench) {
    return saveCaptureToWorkspace(agentClient, projectPath, artifact, input.workbench);
  }

  return saveCaptureToWorkspace(agentClient, projectPath, artifact);
}
