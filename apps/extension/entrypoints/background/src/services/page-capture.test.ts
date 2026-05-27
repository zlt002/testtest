// @vitest-environment node

import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { PickedElementContext } from '@/entrypoints/lib/page-picker';
import {
  beginPageCapture,
  capturePageToCurrentWorkspace,
  PAGE_CAPTURE_COMPANION_TIMEOUT_MS,
  PAGE_CAPTURE_WORKSPACE_REQUEST_TIMEOUT_MS,
} from './page-capture';
import type { PageCaptureArtifact } from './page-capture-types';

vi.mock('./page-capture-workspace', () => ({
  saveCaptureToWorkspace: vi.fn(),
}));

vi.mock('./NativeHostManager', () => ({
  ensureCompanionReady: vi.fn(),
}));

const queryTabs = vi.fn();
const sendMessage = vi.fn();
const storageGet = vi.fn();
const saveCaptureToWorkspace = vi.fn();
const ensureCompanionReady = vi.fn();
const fetchMock = vi.fn();

const sampleTarget: PickedElementContext = {
  url: 'https://example.com/articles/hello',
  selector: '#target',
  xpath: '//*[@id="target"]',
  tagName: 'article',
  id: 'target',
  classList: ['card'],
  dataAttributes: {},
  text: 'Example Article',
  rect: { x: 0, y: 0, width: 320, height: 120 },
  outerHTMLSnippet: '<article id="target">Example Article</article>',
  ancestors: [{ tagName: 'main', id: null, classList: [] }],
  siblings: { previous: null, next: null },
};

const sampleArtifact: PageCaptureArtifact = {
  url: 'https://example.com/articles/hello',
  title: 'Example Article',
  capturedAt: '2026-05-12T00:00:00.000Z',
  mode: 'page',
  html: '<html><body>Hello</body></html>',
  assets: [],
  warnings: [],
  metadata: {
    originalUrl: 'https://example.com/articles/hello',
    userAgent: 'test',
    documentTitle: 'Example Article',
  },
};

beforeEach(async () => {
  queryTabs.mockReset();
  sendMessage.mockReset();
  storageGet.mockReset();
  saveCaptureToWorkspace.mockReset();
  ensureCompanionReady.mockReset();
  fetchMock.mockReset();
  vi.useRealTimers();

  const workspaceModule = await import('./page-capture-workspace');
  vi.mocked(workspaceModule.saveCaptureToWorkspace).mockReset();
  vi.mocked(workspaceModule.saveCaptureToWorkspace).mockImplementation(saveCaptureToWorkspace);

  const nativeModule = await import('./NativeHostManager');
  vi.mocked(nativeModule.ensureCompanionReady).mockReset();
  vi.mocked(nativeModule.ensureCompanionReady).mockImplementation(ensureCompanionReady);

  vi.stubGlobal('chrome', {
    tabs: {
      query: queryTabs,
      sendMessage,
    },
    storage: {
      local: {
        get: storageGet,
      },
    },
  });
  vi.stubGlobal('fetch', fetchMock);
});

describe('beginPageCapture', () => {
  it('requests capture from the active tab', async () => {
    queryTabs.mockResolvedValue([{ id: 321, url: 'https://example.com' }]);
    sendMessage.mockResolvedValue({
      type: 'page-capture-result',
      requestId: 'req-1',
      success: true,
      artifact: sampleArtifact,
    });

    const result = await beginPageCapture({ mode: 'page' });

    expect(result).toEqual(sampleArtifact);
    expect(sendMessage).toHaveBeenCalledWith(
      321,
      expect.objectContaining({
        type: 'page-capture',
        mode: 'page',
        requestId: expect.any(String),
      })
    );
  });

  it('forwards the picked target when capturing an element', async () => {
    queryTabs.mockResolvedValue([{ id: 654, url: 'https://example.com' }]);
    sendMessage.mockResolvedValue({
      type: 'page-capture-result',
      requestId: 'req-2',
      success: true,
      artifact: {
        ...sampleArtifact,
        mode: 'element',
      },
    });

    await beginPageCapture({ mode: 'element', target: sampleTarget });

    expect(sendMessage).toHaveBeenCalledWith(
      654,
      expect.objectContaining({
        type: 'page-capture',
        mode: 'element',
        target: sampleTarget,
      })
    );
  });

  it('throws when there is no active tab', async () => {
    queryTabs.mockResolvedValue([]);

    await expect(beginPageCapture({ mode: 'element', target: sampleTarget })).rejects.toThrow(
      '未找到当前活动页面'
    );
  });

  it('throws when the active tab url cannot be captured', async () => {
    queryTabs.mockResolvedValue([{ id: 1, url: 'chrome://extensions' }]);

    await expect(beginPageCapture({ mode: 'page' })).rejects.toThrow('当前页面不支持采集');
  });

  it('throws when content capture returns a failed result', async () => {
    queryTabs.mockResolvedValue([{ id: 321, url: 'https://example.com' }]);
    sendMessage.mockResolvedValue({
      type: 'page-capture-result',
      requestId: 'req-1',
      success: false,
      error: 'capture failed',
    });

    await expect(beginPageCapture({ mode: 'page' })).rejects.toThrow('capture failed');
  });
});

describe('capturePageToCurrentWorkspace', () => {
  it('captures the current page and saves it into the selected workspace', async () => {
    queryTabs.mockResolvedValue([{ id: 321, url: 'https://example.com' }]);
    sendMessage.mockResolvedValue({
      type: 'page-capture-result',
      requestId: 'req-1',
      success: true,
      artifact: sampleArtifact,
    });
    storageGet.mockResolvedValue({
      'agentV2.selectedProject': {
        projectPath: '/tmp/project',
        selectedAt: '2026-05-12T00:00:00.000Z',
      },
    });
    ensureCompanionReady.mockResolvedValue({
      agentBaseUrl: 'http://127.0.0.1:8792',
    });
    saveCaptureToWorkspace.mockResolvedValue({
      entryPath: 'captures/20260512-example-article',
      projectPath: '/tmp/project',
      assetCount: 0,
    });

    const result = await capturePageToCurrentWorkspace({ mode: 'page' });

    expect(ensureCompanionReady).toHaveBeenCalled();
    expect(saveCaptureToWorkspace).toHaveBeenCalledWith(
      expect.objectContaining({
        createEntry: expect.any(Function),
        writeFile: expect.any(Function),
      }),
      '/tmp/project',
      sampleArtifact
    );
    expect(result.entryPath).toContain('captures/');
  });

  it('forwards workbench metadata into workspace persistence when provided', async () => {
    queryTabs.mockResolvedValue([{ id: 321, url: 'https://example.com' }]);
    sendMessage.mockResolvedValue({
      type: 'page-capture-result',
      requestId: 'req-1',
      success: true,
      artifact: sampleArtifact,
    });
    storageGet.mockResolvedValue({
      'agentV2.selectedProject': {
        projectPath: '/tmp/project',
        selectedAt: '2026-05-12T00:00:00.000Z',
      },
    });
    ensureCompanionReady.mockResolvedValue({
      agentBaseUrl: 'http://127.0.0.1:8792',
    });
    saveCaptureToWorkspace.mockResolvedValue({
      entryPath: 'captures/20260512-example-article',
      projectPath: '/tmp/project',
      assetCount: 0,
    });
    const workbench = {
      sourcePageUrl: 'https://example.com/articles/hello',
      sourcePageType: 'live-page' as const,
      targets: [
        {
          targetId: 'target-1',
          pageUrl: 'https://example.com/articles/hello',
          pageType: 'live-page' as const,
          createdAt: 1,
          ...sampleTarget,
        },
      ],
      annotations: [
        {
          annotationId: 'annotation-1',
          targetId: 'target-1',
          content: '重点分析这个模块',
          createdAt: 1,
          updatedAt: 1,
          sourcePageUrl: 'https://example.com/articles/hello',
          sourcePageType: 'live-page' as const,
          status: 'draft' as const,
        },
      ],
    };

    await capturePageToCurrentWorkspace({
      mode: 'element',
      target: sampleTarget,
      workbench,
    });

    expect(saveCaptureToWorkspace).toHaveBeenCalledWith(
      expect.objectContaining({
        createEntry: expect.any(Function),
        writeFile: expect.any(Function),
      }),
      '/tmp/project',
      sampleArtifact,
      workbench
    );
  });

  it('throws when no workspace is selected', async () => {
    queryTabs.mockResolvedValue([{ id: 321, url: 'https://example.com' }]);
    sendMessage.mockResolvedValue({
      type: 'page-capture-result',
      requestId: 'req-1',
      success: true,
      artifact: sampleArtifact,
    });
    storageGet.mockResolvedValue({});

    await expect(capturePageToCurrentWorkspace({ mode: 'page' })).rejects.toThrow(
      '请先选择当前工作区后再采集网页'
    );
  });

  it('fails fast when companion readiness never resolves', async () => {
    vi.useFakeTimers();
    queryTabs.mockResolvedValue([{ id: 321, url: 'https://example.com' }]);
    sendMessage.mockResolvedValue({
      type: 'page-capture-result',
      requestId: 'req-1',
      success: true,
      artifact: sampleArtifact,
    });
    storageGet.mockResolvedValue({
      'agentV2.selectedProject': {
        projectPath: '/tmp/project',
        selectedAt: '2026-05-12T00:00:00.000Z',
      },
    });
    ensureCompanionReady.mockReturnValue(new Promise(() => {}));

    const capturePromise = capturePageToCurrentWorkspace({ mode: 'page' });
    const expectation = expect(capturePromise).rejects.toThrow(
      '等待 Companion 就绪超时，请确认本地服务已启动'
    );
    await vi.advanceTimersByTimeAsync(PAGE_CAPTURE_COMPANION_TIMEOUT_MS);
    await expectation;
  });

  it('fails fast when workspace file requests never resolve', async () => {
    vi.useFakeTimers();
    queryTabs.mockResolvedValue([{ id: 321, url: 'https://example.com' }]);
    sendMessage.mockResolvedValue({
      type: 'page-capture-result',
      requestId: 'req-1',
      success: true,
      artifact: sampleArtifact,
    });
    storageGet.mockResolvedValue({
      'agentV2.selectedProject': {
        projectPath: '/tmp/project',
        selectedAt: '2026-05-12T00:00:00.000Z',
      },
    });
    ensureCompanionReady.mockResolvedValue({
      agentBaseUrl: 'http://127.0.0.1:8792',
    });
    fetchMock.mockReturnValue(new Promise(() => {}));
    saveCaptureToWorkspace.mockImplementation(async (client) => {
      await client.writeFile({
        projectPath: '/tmp/project',
        filePath: 'captures/test/index.html',
        content: '<html></html>',
      });
      return {
        entryPath: 'captures/test',
        projectPath: '/tmp/project',
        assetCount: 0,
        warningCount: 0,
      };
    });

    const capturePromise = capturePageToCurrentWorkspace({ mode: 'page' });
    const expectation = expect(capturePromise).rejects.toThrow(
      '写入当前工作区超时，请确认本地 Agent Backend 正在运行'
    );
    await vi.advanceTimersByTimeAsync(PAGE_CAPTURE_WORKSPACE_REQUEST_TIMEOUT_MS);
    await expectation;
  });
});
