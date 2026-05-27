// @vitest-environment node

import { beforeEach, describe, expect, it, vi } from 'vitest';

import { resolveCurrentPageCodebaseContext } from './page-code-context';

vi.mock('./read-current-page-content', () => ({
  readCurrentPageContent: vi.fn(),
}));

const getTab = vi.fn();
const queryTabs = vi.fn();
const executeScriptMock = vi.fn();
const readCurrentPageContentMock = vi.fn();

beforeEach(async () => {
  getTab.mockReset();
  queryTabs.mockReset();
  executeScriptMock.mockReset();
  readCurrentPageContentMock.mockReset();

  const readCurrentPageContentModule = await import('./read-current-page-content');
  vi.mocked(readCurrentPageContentModule.readCurrentPageContent).mockImplementation(
    readCurrentPageContentMock
  );

  vi.stubGlobal('chrome', {
    tabs: {
      get: getTab,
      query: queryTabs,
    },
    scripting: {
      executeScript: executeScriptMock,
    },
  });
});

describe('resolveCurrentPageCodebaseContext', () => {
  it('collects current page evidence locally without loading mapping config or calling backend routes', async () => {
    const ensureCompanionReadyMock = vi.fn();

    getTab.mockResolvedValue({
      id: 12,
      windowId: 34,
      title: 'Repository Console',
      url: 'https://example.com/projects/orders/123#overview',
    });
    readCurrentPageContentMock.mockResolvedValue({
      success: true,
      title: 'Order Center',
      url: 'https://example.com/projects/orders/123#overview',
      text: `
        Order Center route repository matcher endpoint service component handler
        dashboard workspace api project resolver route analysis component issue
        commit branch source graph context backend frontend review search trace
      `,
      frameAnalysis: {
        frameCount: 3,
        reasons: [],
        frames: [],
      },
    });
    executeScriptMock.mockResolvedValue([
      {
        result: [
          'https://an-uat.annto.com/api-tms/receipt/queryList?page=1',
          'https://static.annto.com/assets/receipt-mngt.chunk.js',
          'https://static.annto.com/assets/runtime.bundle.js',
        ],
      },
    ]);

    const result = await resolveCurrentPageCodebaseContext({
      tabId: 12,
      windowId: 34,
      maxChars: 4000,
      includeFrames: true,
      ensureCompanionReady: ensureCompanionReadyMock,
    });

    expect(readCurrentPageContentMock).toHaveBeenCalledWith({
      tabId: 12,
      windowId: 34,
      maxChars: 4000,
      includeFrames: true,
      includeFrameAnalysis: true,
    });
    expect(executeScriptMock).toHaveBeenCalledOnce();
    expect(ensureCompanionReadyMock).not.toHaveBeenCalled();
    expect(result.resolution).toBeNull();
    expect(result.context).toMatchObject({
      tabId: 12,
      windowId: 34,
      title: 'Order Center',
      url: 'https://example.com/projects/orders/123#overview',
      pathname: '/projects/orders/123',
      hashRoute: 'overview',
      apiCandidates: ['/api-tms/receipt/queryList?page=1'],
      resourceHints: ['receipt-mngt.chunk.js', 'runtime.bundle.js'],
      frameHints: {
        includeFrames: true,
        frameCount: 3,
      },
    });
    expect(result.context.pageTextSummary).toEqual(
      expect.arrayContaining(['repository', 'graph', 'analysis'])
    );
  });

  it('falls back to the active tab when tabId is omitted', async () => {
    queryTabs.mockResolvedValue([
      {
        id: 88,
        windowId: 9,
        title: 'Active Tab',
        url: 'https://example.com/dashboard',
      },
    ]);
    readCurrentPageContentMock.mockResolvedValue({
      success: true,
      title: 'Active Dashboard',
      url: 'https://example.com/dashboard',
      text: 'dashboard api panel',
    });
    executeScriptMock.mockResolvedValue([{ result: [] }]);

    const result = await resolveCurrentPageCodebaseContext({
      includeFrames: false,
      ensureCompanionReady: vi.fn(),
    });

    expect(queryTabs).toHaveBeenCalledWith({ active: true, lastFocusedWindow: true });
    expect(result.context).toMatchObject({
      tabId: 88,
      windowId: 9,
      title: 'Active Dashboard',
      pathname: '/dashboard',
      hashRoute: undefined,
      apiCandidates: [],
      resourceHints: [],
      frameHints: {
        includeFrames: false,
      },
    });
  });

  it('gracefully degrades when runtime resource collection fails', async () => {
    getTab.mockResolvedValue({
      id: 61,
      windowId: 6,
      title: 'Graceful Fallback',
      url: 'https://an-uat.annto.com/#/transport/fallback',
    });
    readCurrentPageContentMock.mockResolvedValue({
      success: true,
      title: 'Graceful Fallback',
      url: 'https://an-uat.annto.com/#/transport/fallback',
      text: 'transport fallback',
    });
    executeScriptMock.mockRejectedValue(new Error('Cannot access page performance entries'));

    const result = await resolveCurrentPageCodebaseContext({
      tabId: 61,
      includeFrames: false,
      ensureCompanionReady: vi.fn(),
    });

    expect(result.context).toMatchObject({
      apiCandidates: [],
      resourceHints: [],
    });
  });
});
