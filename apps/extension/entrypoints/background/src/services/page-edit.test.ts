// @vitest-environment node

import { beforeEach, describe, expect, it, vi } from 'vitest';

import { BGSWRouter } from '../routers';
import {
  createPageEditCommandListener,
  createPageEditFileSaveMessageListener,
  createPageEditSelectionAnalyzeCompletionMessageListener,
  createPageEditSelectionAnalyzeMessageListener,
  createPageEditSelectionAnalyzeTabUpdateListener,
  createPageEditSelectionMessageListener,
  createPageWorkbenchStateRestoreMessageListener,
  createPageEditService,
  isSupportedPageEditUrl,
  resetPageEditServiceForTests,
} from './page-edit';

function createAnalyzeTarget(
  overrides: Partial<{
    url: string;
    selector: string | null;
    xpath: string | null;
    tagName: string;
    id: string | null;
    classList: string[];
    dataAttributes: Record<string, string>;
    text: string | null;
    rect: { x: number; y: number; width: number; height: number };
    outerHTMLSnippet: string | null;
    ancestors: Array<{
      tagName: string;
      id: string | null;
      classList: string[];
    }>;
    siblings: {
      previous: string | null;
      next: string | null;
    };
  }> = {}
) {
  return {
    url: 'https://example.com',
    selector: '#card > span.status',
    xpath: '//*[@id="card"]/span',
    tagName: 'span',
    id: null,
    classList: ['status'],
    dataAttributes: {},
    text: '运单查询',
    rect: { x: 1, y: 2, width: 3, height: 4 },
    outerHTMLSnippet: '<span class="status">运单查询</span>',
    ancestors: [],
    siblings: {
      previous: null,
      next: null,
    },
    ...overrides,
  };
}

describe('createPageEditService', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('rejects unsupported urls before injecting', async () => {
    const service = createPageEditService({
      getActiveTab: vi.fn().mockResolvedValue({
        id: 1,
        url: 'chrome://extensions',
        active: true,
        windowId: 1,
      }),
    });

    expect(isSupportedPageEditUrl('chrome://extensions')).toBe(false);
    await expect(service.activateForActiveTab()).rejects.toThrow('当前页面不支持网页编辑');
    expect(service.getState(1)).toBeNull();
  });

  it('activates a supported tab and stores active state', async () => {
    const executeScript = vi.fn().mockResolvedValue([]);
    const service = createPageEditService({
      getActiveTab: vi.fn().mockResolvedValue({
        id: 9,
        url: 'https://example.com',
        active: true,
        windowId: 1,
      }),
      executeScript,
      createSessionNonce: () => 'nonce-9',
      now: () => 1_234,
    });

    const state = await service.activateForActiveTab();

    expect(state).toMatchObject({
      tabId: 9,
      windowId: 1,
      url: 'https://example.com',
      status: 'active',
      pageMode: 'live-page',
      capabilities: {
        canAnnotate: true,
        canCapture: true,
        canSend: true,
        canEdit: false,
        canSave: false,
      },
      activatedAt: 1_234,
      selectionSessionNonce: 'nonce-9',
    });
    expect(service.getState(9)).toMatchObject({
      tabId: 9,
      status: 'active',
      pageMode: 'live-page',
      capabilities: {
        canAnnotate: true,
        canCapture: true,
        canSend: true,
        canEdit: false,
        canSave: false,
      },
      selectionSessionNonce: 'nonce-9',
    });
    expect(executeScript).toHaveBeenNthCalledWith(1, {
      target: { tabId: 9 },
      args: [
        {
          pageMode: 'live-page',
          selectionSessionNonce: 'nonce-9',
        },
      ],
      func: expect.any(Function),
      world: 'ISOLATED',
    });
    expect(executeScript).toHaveBeenNthCalledWith(2, {
      target: { tabId: 9 },
      files: ['page-edit/inject.js'],
      world: 'MAIN',
    });
    expect(executeScript).toHaveBeenNthCalledWith(3, {
      target: { tabId: 9 },
      args: ['nonce-9'],
      func: expect.any(Function),
      world: 'MAIN',
    });
  });

  it('deduplicates concurrent activation for the same tab', async () => {
    let releaseScript: (() => void) | null = null;
    const executeScript = vi.fn().mockImplementation(
      () =>
        new Promise((resolve) => {
          releaseScript = () => resolve([]);
        })
    );
    const service = createPageEditService({
      createSessionNonce: () => 'nonce-21',
      getActiveTab: vi.fn().mockResolvedValue({
        id: 21,
        url: 'https://example.com',
        active: true,
        windowId: 4,
      }),
      executeScript,
      now: () => 999,
    });

    const firstActivation = service.activateForActiveTab();
    const secondActivation = service.activateForActiveTab();

    await Promise.resolve();

    expect(executeScript).toHaveBeenCalledTimes(1);

    releaseScript?.();
    await Promise.resolve();

    expect(executeScript).toHaveBeenCalledTimes(2);

    releaseScript?.();
    await Promise.resolve();

    expect(executeScript).toHaveBeenCalledTimes(3);

    releaseScript?.();

    const [firstState, secondState] = await Promise.all([firstActivation, secondActivation]);

    expect(firstState).toEqual(secondState);
    expect(executeScript).toHaveBeenCalledTimes(3);
    expect(service.getState(21)).toMatchObject({
      tabId: 21,
      status: 'active',
      activatedAt: 999,
      selectionSessionNonce: 'nonce-21',
    });
  });

  it('toggles the active tab off when page edit is already active', async () => {
    const executeScript = vi.fn().mockResolvedValue([]);
    const getActiveTab = vi.fn().mockResolvedValue({
      id: 5,
      url: 'https://example.com/doc',
      active: true,
      windowId: 3,
    });
    const service = createPageEditService({
      getActiveTab,
      executeScript,
      now: () => 2_000,
    });

    await service.activateForActiveTab();
    const result = await service.toggleForActiveTab();

    expect(result).toBeNull();
    expect(service.getState(5)).toBeNull();
    expect(executeScript).toHaveBeenNthCalledWith(4, {
      target: { tabId: 5 },
      files: ['page-edit/eject.js'],
      world: 'MAIN',
    });
    expect(executeScript).toHaveBeenNthCalledWith(5, {
      target: { tabId: 5 },
      func: expect.any(Function),
      world: 'ISOLATED',
    });
  });

  it('recycles active state when the tab navigates to a new url', async () => {
    const executeScript = vi.fn().mockResolvedValue([]);
    const service = createPageEditService({
      getActiveTab: vi.fn().mockResolvedValue({
        id: 12,
        url: 'https://example.com/start',
        active: true,
        windowId: 8,
      }),
      executeScript,
    });

    await service.activateForActiveTab();
    const result = service.handleTabUpdated({
      tabId: 12,
      url: 'https://example.com/next',
    });

    expect(result).toBeNull();
    expect(service.getState(12)).toBeNull();
  });

  it('recycles active state when the tab is removed', async () => {
    const service = createPageEditService({
      getActiveTab: vi.fn().mockResolvedValue({
        id: 18,
        url: 'https://example.com/remove-me',
        active: true,
        windowId: 2,
      }),
      executeScript: vi.fn().mockResolvedValue([]),
    });

    await service.activateForActiveTab();
    const result = service.handleTabRemoved({ tabId: 18 });

    expect(result).toBeNull();
    expect(service.getState(18)).toBeNull();
  });

  it('reconciles active state from lingering page runtime when background state is missing', async () => {
    const executeScript = vi.fn().mockResolvedValue([
      {
        result: {
          active: true,
          pageMode: 'live-page',
          pageUrl: 'https://example.com/orders',
          selectionSessionNonce: 'nonce-13',
        },
      },
    ]);
    const service = createPageEditService({
      executeScript,
      getTabById: vi.fn().mockResolvedValue({
        id: 13,
        url: 'https://example.com/orders',
        windowId: 6,
      }),
      now: () => 6_789,
    });

    const state = await service.getStateForTab(13);

    expect(state).toMatchObject({
      tabId: 13,
      windowId: 6,
      url: 'https://example.com/orders',
      status: 'active',
      pageMode: 'live-page',
      selectionSessionNonce: 'nonce-13',
      activatedAt: 6_789,
    });
    expect(service.getState(13)).toMatchObject({
      tabId: 13,
      status: 'active',
      selectionSessionNonce: 'nonce-13',
    });
    expect(executeScript).toHaveBeenCalledWith({
      target: { tabId: 13 },
      func: expect.any(Function),
      world: 'ISOLATED',
    });
  });

  it('deactivates lingering page runtime even when background state is missing', async () => {
    const executeScript = vi
      .fn()
      .mockResolvedValueOnce([
        {
          result: {
            active: true,
            pageMode: 'live-page',
            pageUrl: 'https://example.com/orders',
            selectionSessionNonce: 'nonce-8',
          },
        },
      ])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([]);
    const service = createPageEditService({
      executeScript,
    });

    const result = await service.deactivateForTab(8);

    expect(result).toBeNull();
    expect(service.getState(8)).toBeNull();
    expect(executeScript).toHaveBeenNthCalledWith(1, {
      target: { tabId: 8 },
      func: expect.any(Function),
      world: 'ISOLATED',
    });
    expect(executeScript).toHaveBeenNthCalledWith(2, {
      target: { tabId: 8 },
      files: ['page-edit/eject.js'],
      world: 'MAIN',
    });
    expect(executeScript).toHaveBeenNthCalledWith(3, {
      target: { tabId: 8 },
      func: expect.any(Function),
      world: 'ISOLATED',
    });
  });

  it('does not revive a deactivating tab back to active while eject is still running', async () => {
    let releaseEject: (() => void) | null = null;
    const executeScript = vi.fn().mockImplementation((input: { files?: string[]; func?: unknown }) => {
      if (input.files?.[0] === 'page-edit/eject.js') {
        return new Promise((resolve) => {
          releaseEject = () => resolve([]);
        });
      }

      if (typeof input.func === 'function') {
        return Promise.resolve([
          {
            result: {
              active: true,
              pageMode: 'live-page',
              pageUrl: 'https://example.com/orders',
              selectionSessionNonce: 'nonce-15',
            },
          },
        ]);
      }

      return Promise.resolve([]);
    });
    const service = createPageEditService({
      getActiveTab: vi.fn().mockResolvedValue({
        id: 15,
        url: 'https://example.com/orders',
        active: true,
        windowId: 5,
      }),
      getTabById: vi.fn().mockResolvedValue({
        id: 15,
        url: 'https://example.com/orders',
        windowId: 5,
      }),
      executeScript,
      createSessionNonce: () => 'nonce-15',
      now: () => 1_500,
    });

    await service.activateForActiveTab();

    const deactivatePromise = service.deactivateForTab(15);
    await Promise.resolve();

    expect(service.getState(15)).toMatchObject({
      status: 'deactivating',
    });

    const reconciledState = await service.getStateForTab(15);

    expect(reconciledState).toMatchObject({
      status: 'deactivating',
      selectionSessionNonce: 'nonce-15',
    });

    releaseEject?.();
    await deactivatePromise;
  });

  it('exposes pageEdit procedures through the background router chain', async () => {
    resetPageEditServiceForTests({
      getActiveTab: vi.fn().mockResolvedValue({
        id: 7,
        url: 'https://example.com',
        active: true,
        windowId: 1,
      }),
      executeScript: vi.fn().mockResolvedValue([]),
    });

    const caller = BGSWRouter.createCaller({});
    await expect(caller.pageEdit.activate()).resolves.toMatchObject({
      tabId: 7,
      status: 'active',
    });
  });

  it('toggles page edit mode when the page-edit command is fired', async () => {
    const toggleForActiveTab = vi.fn().mockResolvedValue({
      tabId: 11,
      windowId: 1,
      url: 'https://example.com',
      status: 'active',
    });

    const listener = createPageEditCommandListener({ toggleForActiveTab });
    await listener('toggle-page-edit');

    expect(toggleForActiveTab).toHaveBeenCalledTimes(1);
  });

  it('forwards page-edit selection payload into composer append and opens sidepanel', async () => {
    const publishComposerAppend = vi.fn().mockResolvedValue(undefined);
    const openSidePanel = vi.fn().mockResolvedValue(undefined);
    const getActiveTab = vi.fn().mockResolvedValue({
      id: 7,
      windowId: 7,
      url: 'https://example.com',
    });
    const getPageEditState = vi.fn().mockReturnValue({
      tabId: 7,
      windowId: 7,
      url: 'https://example.com',
      status: 'active',
      selectionSessionNonce: 'nonce-7',
    });
    const listener = createPageEditSelectionMessageListener({
      getActiveTab,
      getPageEditState,
      publishComposerAppend,
      openSidePanel,
    });

    listener(
      {
        type: 'page_edit_selection_append',
        payload: {
          nonce: 'nonce-7',
          source: 'file',
          text: '定位信息：\n文件: /tmp/mock.html',
        },
      },
      { tab: { id: 7, windowId: 7 } } as chrome.runtime.MessageSender
    );

    await Promise.resolve();
    await Promise.resolve();

    expect(getPageEditState).toHaveBeenCalledWith(7);
    expect(getActiveTab).toHaveBeenCalledTimes(1);
    expect(openSidePanel).toHaveBeenCalledWith(7);
    expect(publishComposerAppend).toHaveBeenCalledWith({
      text: '定位信息：\n文件: /tmp/mock.html',
      source: 'page-edit:file',
    });
  });

  it('ignores page-edit selection messages when sender tab is not the current front active tab', async () => {
    const publishComposerAppend = vi.fn().mockResolvedValue(undefined);
    const openSidePanel = vi.fn().mockResolvedValue(undefined);
    const getActiveTab = vi.fn().mockResolvedValue({
      id: 8,
      windowId: 7,
      url: 'https://example.com/other',
    });
    const getPageEditState = vi.fn().mockReturnValue({
      tabId: 7,
      windowId: 7,
      url: 'https://example.com',
      status: 'active',
      selectionSessionNonce: 'nonce-7',
    });
    const listener = createPageEditSelectionMessageListener({
      getActiveTab,
      getPageEditState,
      publishComposerAppend,
      openSidePanel,
    });

    listener(
      {
        type: 'page_edit_selection_append',
        payload: {
          nonce: 'nonce-7',
          source: 'live-page',
          text: '定位信息：\n选择器: #card',
        },
      },
      { tab: { id: 7, windowId: 7 } } as chrome.runtime.MessageSender
    );

    await Promise.resolve();
    await Promise.resolve();

    expect(getPageEditState).toHaveBeenCalledWith(7);
    expect(getActiveTab).toHaveBeenCalledTimes(1);
    expect(openSidePanel).not.toHaveBeenCalled();
    expect(publishComposerAppend).not.toHaveBeenCalled();
  });

  it('ignores page-edit selection messages when nonce is missing or mismatched', async () => {
    const publishComposerAppend = vi.fn().mockResolvedValue(undefined);
    const openSidePanel = vi.fn().mockResolvedValue(undefined);
    const getActiveTab = vi.fn().mockResolvedValue({
      id: 7,
      windowId: 7,
      url: 'https://example.com',
    });
    const getPageEditState = vi.fn().mockReturnValue({
      tabId: 7,
      windowId: 7,
      url: 'https://example.com',
      status: 'active',
      selectionSessionNonce: 'nonce-7',
    });
    const listener = createPageEditSelectionMessageListener({
      getActiveTab,
      getPageEditState,
      publishComposerAppend,
      openSidePanel,
    });

    listener(
      {
        type: 'page_edit_selection_append',
        payload: {
          source: 'file',
          text: '定位信息：\n文件: /tmp/mock.html',
        },
      },
      { tab: { id: 7, windowId: 7 } } as chrome.runtime.MessageSender
    );
    listener(
      {
        type: 'page_edit_selection_append',
        payload: {
          nonce: 'wrong-nonce',
          source: 'live-page',
          text: '定位信息：\n选择器: #card',
        },
      },
      { tab: { id: 7, windowId: 7 } } as chrome.runtime.MessageSender
    );

    await Promise.resolve();
    await Promise.resolve();

    expect(openSidePanel).not.toHaveBeenCalled();
    expect(publishComposerAppend).not.toHaveBeenCalled();
  });

  it('ignores invalid page-edit selection runtime messages', async () => {
    const publishComposerAppend = vi.fn().mockResolvedValue(undefined);
    const openSidePanel = vi.fn().mockResolvedValue(undefined);
    const getPageEditState = vi.fn();
    const listener = createPageEditSelectionMessageListener({
      getPageEditState,
      publishComposerAppend,
      openSidePanel,
    });

    listener(
      {
        type: 'page_edit_selection_append',
        payload: {
          source: 'selection',
          nonce: 'nonce-1',
          text: '定位信息：\n文件: /tmp/mock.html',
        },
      },
      { tab: { windowId: 7 } } as chrome.runtime.MessageSender
    );

    listener(
      {
        type: 'page_edit_selection_append',
        payload: {
          nonce: 'nonce-2',
          source: 'file',
          text: 123,
        },
      },
      { tab: { windowId: 8 } } as chrome.runtime.MessageSender
    );

    await Promise.resolve();

    expect(getPageEditState).not.toHaveBeenCalled();
    expect(openSidePanel).not.toHaveBeenCalled();
    expect(publishComposerAppend).not.toHaveBeenCalled();
  });

  it('ignores page-edit selection messages without a sender tab id', async () => {
    const publishComposerAppend = vi.fn().mockResolvedValue(undefined);
    const openSidePanel = vi.fn().mockResolvedValue(undefined);
    const getPageEditState = vi.fn();
    const listener = createPageEditSelectionMessageListener({
      getPageEditState,
      publishComposerAppend,
      openSidePanel,
    });

    listener(
      {
        type: 'page_edit_selection_append',
        payload: {
          nonce: 'nonce-3',
          source: 'file',
          text: '定位信息：\n文件: /tmp/mock.html',
        },
      },
      { tab: {} } as chrome.runtime.MessageSender
    );

    await Promise.resolve();

    expect(getPageEditState).not.toHaveBeenCalled();
    expect(openSidePanel).not.toHaveBeenCalled();
    expect(publishComposerAppend).not.toHaveBeenCalled();
  });

  it('ignores page-edit selection messages when the tab is not in active page-edit state', async () => {
    const publishComposerAppend = vi.fn().mockResolvedValue(undefined);
    const openSidePanel = vi.fn().mockResolvedValue(undefined);
    const getPageEditState = vi.fn().mockReturnValue(null);
    const listener = createPageEditSelectionMessageListener({
      getPageEditState,
      publishComposerAppend,
      openSidePanel,
    });

    listener(
      {
        type: 'page_edit_selection_append',
        payload: {
          nonce: 'nonce-4',
          source: 'live-page',
          text: '定位信息：\n选择器: #card',
        },
      },
      { tab: { id: 9, windowId: 7 } } as chrome.runtime.MessageSender
    );

    await Promise.resolve();

    expect(getPageEditState).toHaveBeenCalledWith(9);
    expect(openSidePanel).not.toHaveBeenCalled();
    expect(publishComposerAppend).not.toHaveBeenCalled();
  });

  it('starts interactive element analysis and appends guidance to the active sidepanel session', async () => {
    const publishComposerAppend = vi.fn().mockResolvedValue(undefined);
    const openSidePanel = vi.fn().mockResolvedValue(undefined);
    const armInteractiveSelectionAnalysis = vi.fn().mockResolvedValue(undefined);
    const rememberPendingSelectionAnalysis = vi.fn();
    const startSelectionAnalysis = vi.fn().mockResolvedValue({
      sessionId: 'analysis-1',
      tabId: 7,
      analysisMode: 'interactive',
      status: 'waiting-interaction',
    });
    const getActiveTab = vi.fn().mockResolvedValue({
      id: 7,
      windowId: 7,
      url: 'https://example.com',
    });
    const getPageEditState = vi.fn().mockReturnValue({
      tabId: 7,
      windowId: 7,
      url: 'https://example.com',
      status: 'active',
      selectionSessionNonce: 'nonce-7',
    });
    const listener = createPageEditSelectionAnalyzeMessageListener({
      getActiveTab,
      getPageEditState,
      startSelectionAnalysis,
      armInteractiveSelectionAnalysis,
      rememberPendingSelectionAnalysis,
      publishComposerAppend,
      openSidePanel,
    });

    listener(
      {
        type: 'page_edit_selection_analyze',
        payload: {
          nonce: 'nonce-7',
          target: createAnalyzeTarget({
            tagName: 'button',
            text: '查询',
            outerHTMLSnippet: '<button type="button">查询</button>',
          }),
        },
      },
      { tab: { id: 7, windowId: 7 } } as chrome.runtime.MessageSender
    );

    await Promise.resolve();
    await Promise.resolve();

    expect(getPageEditState).toHaveBeenCalledWith(7);
    expect(getActiveTab).toHaveBeenCalledTimes(1);
    expect(startSelectionAnalysis).toHaveBeenCalledWith({
      tabId: 7,
      targetElement: createAnalyzeTarget({
        tagName: 'button',
        text: '查询',
        outerHTMLSnippet: '<button type="button">查询</button>',
      }),
    });
    expect(rememberPendingSelectionAnalysis).toHaveBeenCalledWith({
      sessionId: 'analysis-1',
      tabId: 7,
      windowId: 7,
      nonce: 'nonce-7',
      analysisMode: 'interactive',
    });
    expect(armInteractiveSelectionAnalysis).toHaveBeenCalledWith({
      tabId: 7,
      sessionId: 'analysis-1',
      nonce: 'nonce-7',
      targetElement: createAnalyzeTarget({
        tagName: 'button',
        text: '查询',
        outerHTMLSnippet: '<button type="button">查询</button>',
      }),
    });
    await vi.waitFor(() => {
      expect(openSidePanel).toHaveBeenCalledWith(7);
      expect(publishComposerAppend).toHaveBeenCalledWith({
        text: expect.stringContaining('请在页面上执行一次真实点击或交互'),
        source: 'page-edit:analyze',
      });
    });
  });

  it('starts display element analysis and appends refresh guidance to the active sidepanel session', async () => {
    const publishComposerAppend = vi.fn().mockResolvedValue(undefined);
    const openSidePanel = vi.fn().mockResolvedValue(undefined);
    const armInteractiveSelectionAnalysis = vi.fn().mockResolvedValue(undefined);
    const rememberPendingSelectionAnalysis = vi.fn();
    const startSelectionAnalysis = vi.fn().mockResolvedValue({
      sessionId: 'analysis-2',
      tabId: 7,
      analysisMode: 'display',
      status: 'waiting-refresh',
    });
    const getActiveTab = vi.fn().mockResolvedValue({
      id: 7,
      windowId: 7,
      url: 'https://example.com',
    });
    const getPageEditState = vi.fn().mockReturnValue({
      tabId: 7,
      windowId: 7,
      url: 'https://example.com',
      status: 'active',
      selectionSessionNonce: 'nonce-7',
    });
    const listener = createPageEditSelectionAnalyzeMessageListener({
      getActiveTab,
      getPageEditState,
      startSelectionAnalysis,
      armInteractiveSelectionAnalysis,
      rememberPendingSelectionAnalysis,
      publishComposerAppend,
      openSidePanel,
    });

    listener(
      {
        type: 'page_edit_selection_analyze',
        payload: {
          nonce: 'nonce-7',
          target: createAnalyzeTarget({
            tagName: 'span',
            text: '运单查询',
          }),
        },
      },
      { tab: { id: 7, windowId: 7 } } as chrome.runtime.MessageSender
    );

    await Promise.resolve();
    await Promise.resolve();

    expect(startSelectionAnalysis).toHaveBeenCalledTimes(1);
    expect(rememberPendingSelectionAnalysis).toHaveBeenCalledWith({
      sessionId: 'analysis-2',
      tabId: 7,
      windowId: 7,
      nonce: 'nonce-7',
      analysisMode: 'display',
    });
    expect(armInteractiveSelectionAnalysis).not.toHaveBeenCalled();
    expect(openSidePanel).toHaveBeenCalledWith(7);
    expect(publishComposerAppend).toHaveBeenCalledWith({
      text: expect.stringContaining('请刷新页面或触发一次重新加载'),
      source: 'page-edit:analyze',
    });
  });

  it('appends a failure notice when starting page-edit selection analysis fails', async () => {
    const publishComposerAppend = vi.fn().mockResolvedValue(undefined);
    const openSidePanel = vi.fn().mockResolvedValue(undefined);
    const startSelectionAnalysis = vi.fn().mockRejectedValue(new Error('CDP 未连接'));
    const getActiveTab = vi.fn().mockResolvedValue({
      id: 7,
      windowId: 7,
      url: 'https://example.com',
    });
    const getPageEditState = vi.fn().mockReturnValue({
      tabId: 7,
      windowId: 7,
      url: 'https://example.com',
      status: 'active',
      selectionSessionNonce: 'nonce-7',
    });
    const listener = createPageEditSelectionAnalyzeMessageListener({
      getActiveTab,
      getPageEditState,
      startSelectionAnalysis,
      publishComposerAppend,
      openSidePanel,
    });

    listener(
      {
        type: 'page_edit_selection_analyze',
        payload: {
          nonce: 'nonce-7',
          target: createAnalyzeTarget(),
        },
      },
      { tab: { id: 7, windowId: 7 } } as chrome.runtime.MessageSender
    );

    await Promise.resolve();
    await Promise.resolve();

    expect(openSidePanel).toHaveBeenCalledWith(7);
    expect(publishComposerAppend).toHaveBeenCalledWith({
      text: '页面元素分析启动失败：CDP 未连接',
      source: 'page-edit:analyze',
    });
  });

  it('ignores page-edit selection analyze messages when nonce is missing or mismatched', async () => {
    const publishComposerAppend = vi.fn().mockResolvedValue(undefined);
    const openSidePanel = vi.fn().mockResolvedValue(undefined);
    const getActiveTab = vi.fn().mockResolvedValue({
      id: 7,
      windowId: 7,
      url: 'https://example.com',
    });
    const getPageEditState = vi.fn().mockReturnValue({
      tabId: 7,
      windowId: 7,
      url: 'https://example.com',
      status: 'active',
      selectionSessionNonce: 'nonce-7',
    });
    const listener = createPageEditSelectionAnalyzeMessageListener({
      getActiveTab,
      getPageEditState,
      publishComposerAppend,
      openSidePanel,
    });

    listener(
      {
        type: 'page_edit_selection_analyze',
        payload: {
          target: createAnalyzeTarget(),
        },
      },
      { tab: { id: 7, windowId: 7 } } as chrome.runtime.MessageSender
    );
    listener(
      {
        type: 'page_edit_selection_analyze',
        payload: {
          nonce: 'wrong-nonce',
          target: createAnalyzeTarget(),
        },
      },
      { tab: { id: 7, windowId: 7 } } as chrome.runtime.MessageSender
    );

    await Promise.resolve();
    await Promise.resolve();

    expect(openSidePanel).not.toHaveBeenCalled();
    expect(publishComposerAppend).not.toHaveBeenCalled();
  });

  it('completes interactive analysis after runtime click completion message', async () => {
    const publishComposerAppend = vi.fn().mockResolvedValue(undefined);
    const openSidePanel = vi.fn().mockResolvedValue(undefined);
    const completeSelectionAnalysis = vi.fn().mockResolvedValue({
      markdown: '# 页面元素接口关联分析\n\n- 推荐接口：`/api/orders/query`',
    });
    const clearPendingSelectionAnalysis = vi.fn();
    const getPendingSelectionAnalysis = vi.fn().mockReturnValue({
      sessionId: 'analysis-3',
      tabId: 7,
      windowId: 7,
      nonce: 'nonce-7',
      analysisMode: 'interactive',
    });
    const getPageEditState = vi.fn().mockReturnValue({
      tabId: 7,
      windowId: 7,
      url: 'https://example.com',
      status: 'active',
      selectionSessionNonce: 'nonce-7',
    });
    const listener = createPageEditSelectionAnalyzeCompletionMessageListener({
      getPendingSelectionAnalysis,
      clearPendingSelectionAnalysis,
      getPageEditState,
      completeSelectionAnalysis,
      publishComposerAppend,
      openSidePanel,
    });

    listener(
      {
        type: 'page_edit_selection_analysis_complete',
        payload: {
          sessionId: 'analysis-3',
          nonce: 'nonce-7',
          trigger: 'interaction-complete',
        },
      },
      { tab: { id: 7, windowId: 7 } } as chrome.runtime.MessageSender
    );

    await Promise.resolve();
    await Promise.resolve();

    expect(clearPendingSelectionAnalysis).toHaveBeenCalledWith('analysis-3');
    expect(completeSelectionAnalysis).toHaveBeenCalledWith({
      sessionId: 'analysis-3',
    });
    expect(openSidePanel).toHaveBeenCalledWith(7);
    expect(publishComposerAppend).toHaveBeenCalledWith({
      text: '# 页面元素接口关联分析\n\n- 推荐接口：`/api/orders/query`',
      source: 'page-edit:analyze-result',
    });
  });

  it('ignores interactive completion messages when pending session does not match', async () => {
    const publishComposerAppend = vi.fn().mockResolvedValue(undefined);
    const openSidePanel = vi.fn().mockResolvedValue(undefined);
    const completeSelectionAnalysis = vi.fn().mockResolvedValue({
      markdown: '# 页面元素接口关联分析',
    });
    const clearPendingSelectionAnalysis = vi.fn();
    const getPendingSelectionAnalysis = vi.fn().mockReturnValue(null);
    const listener = createPageEditSelectionAnalyzeCompletionMessageListener({
      getPendingSelectionAnalysis,
      clearPendingSelectionAnalysis,
      completeSelectionAnalysis,
      publishComposerAppend,
      openSidePanel,
    });

    listener(
      {
        type: 'page_edit_selection_analysis_complete',
        payload: {
          sessionId: 'missing-session',
          nonce: 'nonce-7',
          trigger: 'interaction-complete',
        },
      },
      { tab: { id: 7, windowId: 7 } } as chrome.runtime.MessageSender
    );

    await Promise.resolve();

    expect(clearPendingSelectionAnalysis).not.toHaveBeenCalled();
    expect(completeSelectionAnalysis).not.toHaveBeenCalled();
    expect(openSidePanel).not.toHaveBeenCalled();
    expect(publishComposerAppend).not.toHaveBeenCalled();
  });

  it('completes display analysis when the tracked tab reload finishes', async () => {
    const publishComposerAppend = vi.fn().mockResolvedValue(undefined);
    const openSidePanel = vi.fn().mockResolvedValue(undefined);
    const completeSelectionAnalysis = vi.fn().mockResolvedValue({
      markdown: '# 页面元素接口关联分析\n\n- 推荐接口：`/api/orders/list`',
    });
    const clearPendingSelectionAnalysis = vi.fn();
    const listPendingSelectionAnalysesByTabId = vi.fn().mockReturnValue([
      {
        sessionId: 'analysis-4',
        tabId: 9,
        windowId: 3,
        nonce: 'nonce-9',
        analysisMode: 'display',
      },
    ]);
    const listener = createPageEditSelectionAnalyzeTabUpdateListener({
      listPendingSelectionAnalysesByTabId,
      clearPendingSelectionAnalysis,
      completeSelectionAnalysis,
      publishComposerAppend,
      openSidePanel,
    });

    listener(9, { status: 'complete' } as chrome.tabs.TabChangeInfo);

    await Promise.resolve();
    await Promise.resolve();

    expect(listPendingSelectionAnalysesByTabId).toHaveBeenCalledWith(9);
    expect(clearPendingSelectionAnalysis).toHaveBeenCalledWith('analysis-4');
    expect(completeSelectionAnalysis).toHaveBeenCalledWith({
      sessionId: 'analysis-4',
    });
    expect(openSidePanel).toHaveBeenCalledWith(3);
    expect(publishComposerAppend).toHaveBeenCalledWith({
      text: '# 页面元素接口关联分析\n\n- 推荐接口：`/api/orders/list`',
      source: 'page-edit:analyze-result',
    });
  });

  it('saves file-page html when the sender tab is front active and the nonce matches', async () => {
    const getActiveTab = vi.fn().mockResolvedValue({
      id: 7,
      windowId: 7,
      url: 'file:///Users/demo/index.html',
    });
    const getPageEditState = vi.fn().mockReturnValue({
      tabId: 7,
      windowId: 7,
      url: 'file:///Users/demo/index.html',
      status: 'active',
      selectionSessionNonce: 'nonce-7',
    });
    const saveFile = vi.fn().mockResolvedValue(undefined);
    const listener = createPageEditFileSaveMessageListener({
      getActiveTab,
      getPageEditState,
      saveFile,
    });

    const result = await listener(
      {
        type: 'page_edit_save_file',
        payload: {
          nonce: 'nonce-7',
          pageUrl: 'file:///Users/demo/index.html',
          html: '<!DOCTYPE html><html><body>saved</body></html>',
        },
      },
      {
        tab: {
          id: 7,
          windowId: 7,
          url: 'file:///Users/demo/index.html',
        },
      } as chrome.runtime.MessageSender
    );

    expect(result).toEqual({ success: true });
    expect(getPageEditState).toHaveBeenCalledWith(7);
    expect(getActiveTab).toHaveBeenCalledTimes(1);
    expect(saveFile).toHaveBeenCalledWith({
      pageUrl: 'file:///Users/demo/index.html',
      html: '<!DOCTYPE html><html><body>saved</body></html>',
    });
  });

  it('rejects save requests when the sender tab is not the current front active tab', async () => {
    const getActiveTab = vi.fn().mockResolvedValue({
      id: 8,
      windowId: 7,
      url: 'file:///Users/demo/index.html',
    });
    const getPageEditState = vi.fn().mockReturnValue({
      tabId: 7,
      windowId: 7,
      url: 'file:///Users/demo/index.html',
      status: 'active',
      selectionSessionNonce: 'nonce-7',
    });
    const saveFile = vi.fn().mockResolvedValue(undefined);
    const listener = createPageEditFileSaveMessageListener({
      getActiveTab,
      getPageEditState,
      saveFile,
    });

    const result = await listener(
      {
        type: 'page_edit_save_file',
        payload: {
          nonce: 'nonce-7',
          pageUrl: 'file:///Users/demo/index.html',
          html: '<!DOCTYPE html><html><body>saved</body></html>',
        },
      },
      {
        tab: {
          id: 7,
          windowId: 7,
          url: 'file:///Users/demo/index.html',
        },
      } as chrome.runtime.MessageSender
    );

    expect(result).toEqual({ success: false, error: '当前页面不可保存' });
    expect(saveFile).not.toHaveBeenCalled();
  });

  it('rejects save requests when the selection session nonce does not match', async () => {
    const getActiveTab = vi.fn().mockResolvedValue({
      id: 7,
      windowId: 7,
      url: 'file:///Users/demo/index.html',
    });
    const getPageEditState = vi.fn().mockReturnValue({
      tabId: 7,
      windowId: 7,
      url: 'file:///Users/demo/index.html',
      status: 'active',
      selectionSessionNonce: 'nonce-7',
    });
    const saveFile = vi.fn().mockResolvedValue(undefined);
    const listener = createPageEditFileSaveMessageListener({
      getActiveTab,
      getPageEditState,
      saveFile,
    });

    const result = await listener(
      {
        type: 'page_edit_save_file',
        payload: {
          nonce: 'wrong-nonce',
          pageUrl: 'file:///Users/demo/index.html',
          html: '<!DOCTYPE html><html><body>saved</body></html>',
        },
      },
      {
        tab: {
          id: 7,
          windowId: 7,
          url: 'file:///Users/demo/index.html',
        },
      } as chrome.runtime.MessageSender
    );

    expect(result).toEqual({ success: false, error: '当前页面不可保存' });
    expect(saveFile).not.toHaveBeenCalled();
  });

  it('rejects save requests when the page is not a file url', async () => {
    const getActiveTab = vi.fn().mockResolvedValue({
      id: 7,
      windowId: 7,
      url: 'https://example.com/index.html',
    });
    const getPageEditState = vi.fn().mockReturnValue({
      tabId: 7,
      windowId: 7,
      url: 'https://example.com/index.html',
      status: 'active',
      selectionSessionNonce: 'nonce-7',
    });
    const saveFile = vi.fn().mockResolvedValue(undefined);
    const listener = createPageEditFileSaveMessageListener({
      getActiveTab,
      getPageEditState,
      saveFile,
    });

    const result = await listener(
      {
        type: 'page_edit_save_file',
        payload: {
          nonce: 'nonce-7',
          pageUrl: 'https://example.com/index.html',
          html: '<!DOCTYPE html><html><body>saved</body></html>',
        },
      },
      {
        tab: {
          id: 7,
          windowId: 7,
          url: 'https://example.com/index.html',
        },
      } as chrome.runtime.MessageSender
    );

    expect(result).toEqual({ success: false, error: '当前页面不可保存' });
    expect(saveFile).not.toHaveBeenCalled();
  });

  it('accepts save requests for local snapshot preview asset urls', async () => {
    const previewUrl = 'http://127.0.0.1:8792/api/preview/assets/demo-preview/captures/demo/index.html';
    const getActiveTab = vi.fn().mockResolvedValue({
      id: 7,
      windowId: 7,
      url: previewUrl,
    });
    const getPageEditState = vi.fn().mockReturnValue({
      tabId: 7,
      windowId: 7,
      url: previewUrl,
      status: 'active',
      pageMode: 'local-snapshot',
      selectionSessionNonce: 'nonce-7',
    });
    const saveFile = vi.fn().mockResolvedValue(undefined);
    const listener = createPageEditFileSaveMessageListener({
      getActiveTab,
      getPageEditState,
      saveFile,
    });

    const result = await listener(
      {
        type: 'page_edit_save_file',
        payload: {
          nonce: 'nonce-7',
          pageUrl: previewUrl,
          html: '<!DOCTYPE html><html><body>saved</body></html>',
        },
      },
      {
        tab: {
          id: 7,
          windowId: 7,
          url: previewUrl,
        },
      } as chrome.runtime.MessageSender
    );

    expect(result).toEqual({ success: true });
    expect(saveFile).toHaveBeenCalledWith({
      pageUrl: previewUrl,
      html: '<!DOCTYPE html><html><body>saved</body></html>',
    });
  });

  it('returns the write failure error when saving the file fails', async () => {
    const getActiveTab = vi.fn().mockResolvedValue({
      id: 7,
      windowId: 7,
      url: 'file:///Users/demo/index.html',
    });
    const getPageEditState = vi.fn().mockReturnValue({
      tabId: 7,
      windowId: 7,
      url: 'file:///Users/demo/index.html',
      status: 'active',
      selectionSessionNonce: 'nonce-7',
    });
    const saveFile = vi.fn().mockRejectedValue(new Error('写文件失败'));
    const listener = createPageEditFileSaveMessageListener({
      getActiveTab,
      getPageEditState,
      saveFile,
    });

    const result = await listener(
      {
        type: 'page_edit_save_file',
        payload: {
          nonce: 'nonce-7',
          pageUrl: 'file:///Users/demo/index.html',
          html: '<!DOCTYPE html><html><body>saved</body></html>',
        },
      },
      {
        tab: {
          id: 7,
          windowId: 7,
          url: 'file:///Users/demo/index.html',
        },
      } as chrome.runtime.MessageSender
    );

    expect(result).toEqual({ success: false, error: '写文件失败' });
    expect(saveFile).toHaveBeenCalledTimes(1);
  });

  it('restores local snapshot workbench state for the current active tab', async () => {
    const getActiveTab = vi.fn().mockResolvedValue({
      id: 7,
      windowId: 7,
      url: 'file:///Users/demo/capture/index.html',
    });
    const getPageEditState = vi.fn().mockReturnValue({
      tabId: 7,
      windowId: 7,
      url: 'file:///Users/demo/capture/index.html',
      status: 'activating',
      pageMode: 'local-snapshot',
      selectionSessionNonce: 'nonce-7',
    });
    const clearTab = vi.fn();
    const upsertTarget = vi.fn();
    const upsertAnnotation = vi.fn();
    const updatePageEditState = vi.fn();
    const listener = createPageWorkbenchStateRestoreMessageListener({
      getActiveTab,
      getPageEditState,
      annotationStore: {
        clearTab,
        upsertTarget,
        upsertAnnotation,
      },
      updatePageEditState,
    });

    const result = await listener(
      {
        type: 'page_workbench_state_restore',
        payload: {
          nonce: 'nonce-7',
          pageUrl: 'file:///Users/demo/capture/index.html',
          sourcePageUrl: 'https://example.com/articles/hello',
          sourcePageType: 'live-page',
          targets: [
            {
              targetId: 'target-1',
              pageUrl: 'https://example.com/articles/hello',
              pageType: 'live-page',
              createdAt: 101,
              url: 'https://example.com/articles/hello',
              selector: '#hero',
              xpath: '//*[@id="hero"]',
              tagName: 'section',
              id: 'hero',
              classList: ['hero'],
              dataAttributes: {
                section: 'hero',
              },
              text: 'hero',
              rect: { x: 1, y: 2, width: 3, height: 4 },
              outerHTMLSnippet: '<section id="hero"></section>',
              ancestors: [
                {
                  tagName: 'body',
                  id: null,
                  classList: [],
                },
              ],
              siblings: {
                previous: null,
                next: null,
              },
            },
          ],
          annotations: [
            {
              annotationId: 'annotation-1',
              targetId: 'target-1',
              content: '继续处理这里',
              createdAt: 101,
              updatedAt: 102,
              sourcePageUrl: 'https://example.com/articles/hello',
              sourcePageType: 'live-page',
              status: 'draft',
            },
          ],
        },
      },
      {
        tab: {
          id: 7,
          windowId: 7,
          url: 'file:///Users/demo/capture/index.html',
        },
      } as chrome.runtime.MessageSender
    );

    expect(result).toBe(false);
    expect(getPageEditState).toHaveBeenCalledWith(7);
    expect(getActiveTab).toHaveBeenCalledTimes(1);
    expect(clearTab).toHaveBeenCalledWith(7);
    expect(upsertTarget).toHaveBeenCalledTimes(1);
    expect(upsertAnnotation).toHaveBeenCalledTimes(1);
    expect(updatePageEditState).toHaveBeenCalledWith(7, {
      sourcePageUrl: 'https://example.com/articles/hello',
      sourcePageType: 'live-page',
    });
  });

  it('preserves restored source page metadata through activation completion', async () => {
    let releaseScript: (() => void) | null = null;
    const executeScript = vi.fn().mockImplementation(
      () =>
        new Promise((resolve) => {
          releaseScript = () => resolve([]);
        })
    );
    const service = createPageEditService({
      getActiveTab: vi.fn().mockResolvedValue({
        id: 11,
        url: 'file:///Users/demo/capture/index.html',
        active: true,
        windowId: 3,
      }),
      executeScript,
      createSessionNonce: () => 'nonce-11',
      now: () => 2_345,
    });

    const activationPromise = service.activateForActiveTab();
    await Promise.resolve();

    const listener = createPageWorkbenchStateRestoreMessageListener({
      getActiveTab: vi.fn().mockResolvedValue({
        id: 11,
        windowId: 3,
        url: 'file:///Users/demo/capture/index.html',
      }),
      getPageEditState: (tabId) => service.getState(tabId),
      updatePageEditState: (tabId, restoredState) =>
        service.restoreWorkbenchState(tabId, restoredState),
    });

    await listener(
      {
        type: 'page_workbench_state_restore',
        payload: {
          nonce: 'nonce-11',
          pageUrl: 'file:///Users/demo/capture/index.html',
          sourcePageUrl: 'https://example.com/articles/hello',
          sourcePageType: 'live-page',
          targets: [],
          annotations: [],
        },
      },
      {
        tab: {
          id: 11,
          windowId: 3,
          url: 'file:///Users/demo/capture/index.html',
        },
      } as chrome.runtime.MessageSender
    );

    releaseScript?.();
    await Promise.resolve();
    releaseScript?.();
    await Promise.resolve();
    releaseScript?.();

    const state = await activationPromise;

    expect(state).toMatchObject({
      status: 'active',
      sourcePageUrl: 'https://example.com/articles/hello',
      sourcePageType: 'live-page',
      selectionSessionNonce: 'nonce-11',
    });
    expect(service.getState(11)).toMatchObject({
      status: 'active',
      sourcePageUrl: 'https://example.com/articles/hello',
      sourcePageType: 'live-page',
    });
  });

  it('ignores invalid local snapshot restore messages', async () => {
    const getActiveTab = vi.fn().mockResolvedValue({
      id: 7,
      windowId: 7,
      url: 'file:///Users/demo/capture/index.html',
    });
    const getPageEditState = vi.fn().mockReturnValue({
      tabId: 7,
      windowId: 7,
      url: 'file:///Users/demo/capture/index.html',
      status: 'active',
      pageMode: 'local-snapshot',
      selectionSessionNonce: 'nonce-7',
    });
    const clearTab = vi.fn();
    const upsertTarget = vi.fn();
    const upsertAnnotation = vi.fn();
    const updatePageEditState = vi.fn();
    const listener = createPageWorkbenchStateRestoreMessageListener({
      getActiveTab,
      getPageEditState,
      annotationStore: {
        clearTab,
        upsertTarget,
        upsertAnnotation,
      },
      updatePageEditState,
    });

    const result = await listener(
      {
        type: 'page_workbench_state_restore',
        payload: {
          nonce: 'wrong-nonce',
          pageUrl: 'file:///Users/demo/capture/index.html',
          sourcePageUrl: 'https://example.com/articles/hello',
          sourcePageType: 'live-page',
          targets: [],
          annotations: [],
        },
      },
      {
        tab: {
          id: 7,
          windowId: 7,
          url: 'file:///Users/demo/capture/index.html',
        },
      } as chrome.runtime.MessageSender
    );

    expect(result).toBe(false);
    expect(getPageEditState).toHaveBeenCalledWith(7);
    expect(getActiveTab).not.toHaveBeenCalled();
    expect(clearTab).not.toHaveBeenCalled();
    expect(upsertTarget).not.toHaveBeenCalled();
    expect(upsertAnnotation).not.toHaveBeenCalled();
    expect(updatePageEditState).not.toHaveBeenCalled();
  });

  it('ignores malformed local snapshot restore payloads', async () => {
    const getActiveTab = vi.fn().mockResolvedValue({
      id: 7,
      windowId: 7,
      url: 'file:///Users/demo/capture/index.html',
    });
    const getPageEditState = vi.fn().mockReturnValue({
      tabId: 7,
      windowId: 7,
      url: 'file:///Users/demo/capture/index.html',
      status: 'active',
      pageMode: 'local-snapshot',
      selectionSessionNonce: 'nonce-7',
    });
    const clearTab = vi.fn();
    const upsertTarget = vi.fn();
    const upsertAnnotation = vi.fn();
    const updatePageEditState = vi.fn();
    const listener = createPageWorkbenchStateRestoreMessageListener({
      getActiveTab,
      getPageEditState,
      annotationStore: {
        clearTab,
        upsertTarget,
        upsertAnnotation,
      },
      updatePageEditState,
    });

    const result = await listener(
      {
        type: 'page_workbench_state_restore',
        payload: {
          nonce: 'nonce-7',
          pageUrl: 'file:///Users/demo/capture/index.html',
          sourcePageUrl: 'https://example.com/articles/hello',
          sourcePageType: 'invalid-page-type',
          targets: [],
          annotations: [],
        },
      },
      {
        tab: {
          id: 7,
          windowId: 7,
          url: 'file:///Users/demo/capture/index.html',
        },
      } as chrome.runtime.MessageSender
    );

    expect(result).toBe(false);
    expect(getPageEditState).not.toHaveBeenCalled();
    expect(getActiveTab).not.toHaveBeenCalled();
    expect(clearTab).not.toHaveBeenCalled();
    expect(upsertTarget).not.toHaveBeenCalled();
    expect(upsertAnnotation).not.toHaveBeenCalled();
    expect(updatePageEditState).not.toHaveBeenCalled();
  });
});
