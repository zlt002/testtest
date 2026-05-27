// @vitest-environment node

import { JSDOM } from 'jsdom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PickedElementContext } from '@/entrypoints/lib/page-picker';
import type { PageEvidence } from '@mcp-b/dom-analysis-contracts';
import { BGSWRouter } from '../routers';
import { createDomAnalysisSessionStore } from './dom-analysis-session-store';
import {
  beginPageElementPick,
  buildDomAnalysisEvidenceForTarget,
  captureDomAnalysisEvidenceForSession,
  beginPageDomAnalysisEvidenceCapture,
  PAGE_PICKER_TIMEOUT_MS,
  isSupportedPagePickerUrl,
  startDomAnalysisSession,
} from './page-picker';
import { extractPickedElementContext, runPagePickerInPage } from './page-picker-script';

const executeScript = vi.fn();
const queryTabs = vi.fn();
let dom: JSDOM;

const sampleResult: PickedElementContext = {
  url: 'https://example.com',
  selector: '#hero',
  xpath: '//*[@id="hero"]',
  tagName: 'section',
  id: 'hero',
  classList: ['hero'],
  dataAttributes: {},
  text: 'Hero',
  rect: { x: 0, y: 0, width: 100, height: 50 },
  outerHTMLSnippet: '<section id="hero">Hero</section>',
  ancestors: [],
  siblings: { previous: null, next: null },
};

beforeEach(() => {
  dom = new JSDOM('<!doctype html><html><body></body></html>', {
    url: 'https://example.com',
  });
  vi.stubGlobal('window', dom.window);
  vi.stubGlobal('document', dom.window.document);
  vi.stubGlobal('HTMLElement', dom.window.HTMLElement);
  vi.stubGlobal('Element', dom.window.Element);
  vi.stubGlobal('MouseEvent', dom.window.MouseEvent);
  vi.stubGlobal('location', dom.window.location);
  queryTabs.mockReset();
  executeScript.mockReset();
  vi.stubGlobal('chrome', {
    tabs: {
      query: queryTabs,
    },
    scripting: {
      executeScript,
    },
  });
});

afterEach(() => {
  vi.useRealTimers();
});

describe('isSupportedPagePickerUrl', () => {
  it('rejects browser internal and extension pages', () => {
    expect(isSupportedPagePickerUrl(undefined)).toBe(false);
    expect(isSupportedPagePickerUrl('chrome://extensions')).toBe(false);
    expect(isSupportedPagePickerUrl('chrome-extension://abc/panel.html')).toBe(false);
    expect(isSupportedPagePickerUrl('edge://settings')).toBe(false);
    expect(isSupportedPagePickerUrl('about:blank')).toBe(false);
  });

  it('allows normal http pages', () => {
    expect(isSupportedPagePickerUrl('https://www.baidu.com')).toBe(true);
    expect(isSupportedPagePickerUrl('http://localhost:3000')).toBe(true);
  });
});

describe('beginPageElementPick', () => {
  it('throws when there is no active tab', async () => {
    queryTabs.mockResolvedValue([]);

    await expect(beginPageElementPick()).rejects.toThrow('未找到当前活动页面');
  });

  it('throws when the active tab url cannot be injected', async () => {
    queryTabs.mockResolvedValue([{ id: 1, url: 'chrome://extensions' }]);

    await expect(beginPageElementPick()).rejects.toThrow('当前页面不支持拾取');
  });

  it('throws when executeScript returns no picked element result', async () => {
    queryTabs.mockResolvedValue([{ id: 9, url: 'https://example.com', active: true, windowId: 1 }]);
    executeScript.mockResolvedValue([{ result: undefined }]);

    await expect(beginPageElementPick()).rejects.toThrow('页面元素拾取未返回结果');
  });

  it('throws when page picking times out', async () => {
    vi.useFakeTimers();
    queryTabs.mockResolvedValue([{ id: 9, url: 'https://example.com', active: true, windowId: 1 }]);
    executeScript.mockImplementation(() => new Promise(() => {}));

    const pickPromise = beginPageElementPick().then(
      () => 'resolved',
      (error) => (error instanceof Error ? error.message : String(error))
    );

    await vi.advanceTimersByTimeAsync(PAGE_PICKER_TIMEOUT_MS + 1_001);

    await expect(Promise.race([pickPromise, Promise.resolve('__pending__')])).resolves.toBe(
      '页面元素拾取超时'
    );
  });

  it('returns the picked element payload from executeScript', async () => {
    queryTabs.mockResolvedValue([{ id: 9, url: 'https://example.com', active: true, windowId: 1 }]);
    executeScript.mockResolvedValue([{ result: sampleResult }]);

    await expect(beginPageElementPick()).resolves.toMatchObject({
      selector: '#hero',
      tagName: 'section',
    });
    expect(executeScript).toHaveBeenCalledTimes(1);
    expect(executeScript).toHaveBeenCalledWith(
      expect.objectContaining({
        target: { tabId: 9 },
        world: 'MAIN',
        func: expect.any(Function),
        args: [PAGE_PICKER_TIMEOUT_MS],
      })
    );
  });

  it('builds dom analysis page evidence around the picked element capture window', async () => {
    queryTabs.mockResolvedValue([{ id: 9, url: 'https://example.com', active: true, windowId: 1 }]);
    const pageEvidence = { captureSessionMeta: { sessionId: 'session-1' } } as PageEvidence;
    const startCaptureForTab = vi.fn().mockResolvedValue(undefined);
    const stopCaptureForTab = vi.fn().mockResolvedValue(undefined);
    const buildEvidence = vi.fn().mockResolvedValue(pageEvidence);
    let currentTime = 1_000;
    const now = vi.fn(() => currentTime);
    executeScript.mockImplementation(async () => {
      currentTime = 1_500;
      return [{ result: sampleResult }];
    });

    await expect(
      beginPageDomAnalysisEvidenceCapture({
        now,
        preCaptureWindowMs: 200,
        postCaptureWindowMs: 50,
        sessionStore: createDomAnalysisSessionStore({
          createId: () => 'session-1',
          now: () => currentTime,
        }),
        cdpService: {
          startCaptureForTab,
          stopCaptureForTab,
          getNetworkEvidenceForTab: vi.fn(),
          clearTab: vi.fn(),
        },
        buildEvidence,
      })
    ).resolves.toBe(pageEvidence);

    expect(startCaptureForTab).toHaveBeenCalledWith(9);
    expect(stopCaptureForTab).toHaveBeenCalledWith(9);
    expect(buildEvidence).toHaveBeenCalledWith(
      expect.objectContaining({
        tab: expect.objectContaining({ id: 9 }),
        targetElement: sampleResult,
        captureSessionMeta: {
          sessionId: 'session-1',
          tabId: 9,
          capturedAt: 1_500,
          mode: 'interactive',
        },
        networkWindow: {
          startTime: 800,
          endTime: 1_550,
        },
      })
    );
  });

  it('captureDomAnalysisEvidenceForSession 会把 selection mode 归一为 contracts 支持的 interactive', async () => {
    queryTabs.mockResolvedValue([]);
    const getTab = vi.fn().mockResolvedValue({
      id: 9,
      windowId: 1,
      url: 'https://example.com',
      title: 'Example',
    });
    let currentTime = 1_000;
    const sessionStore = createDomAnalysisSessionStore({
      createId: () => 'selection-session',
      now: () => currentTime,
    });
    sessionStore.startSession({
      tabId: 9,
      mode: 'selection-display',
      startedAt: currentTime,
      targetElement: sampleResult,
    });
    const buildEvidence = vi.fn().mockResolvedValue({
      captureSessionMeta: { sessionId: 'selection-session' },
    } as PageEvidence);
    const startCaptureForTab = vi.fn().mockResolvedValue(undefined);
    const stopCaptureForTab = vi.fn().mockResolvedValue(undefined);
    executeScript.mockImplementation(async () => {
      currentTime = 1_300;
      return [{ result: sampleResult }];
    });
    vi.stubGlobal('chrome', {
      tabs: {
        query: queryTabs,
        get: getTab,
      },
      scripting: {
        executeScript,
      },
    });

    await captureDomAnalysisEvidenceForSession({
      sessionId: 'selection-session',
      now: () => currentTime,
      sessionStore,
      cdpService: {
        startCaptureForTab,
        stopCaptureForTab,
        getNetworkEvidenceForTab: vi.fn(),
        clearTab: vi.fn(),
      },
      buildEvidence,
    });

    expect(buildEvidence).toHaveBeenCalledWith(
      expect.objectContaining({
        captureSessionMeta: expect.objectContaining({
          sessionId: 'selection-session',
          mode: 'interactive',
        }),
      })
    );
  });

  it('cleans up session and capture when dom analysis capture startup fails', async () => {
    queryTabs.mockResolvedValue([{ id: 9, url: 'https://example.com', active: true, windowId: 1 }]);
    let currentTime = 1_000;
    const sessionStore = createDomAnalysisSessionStore({
      createId: () => 'session-startup-fail',
      now: () => currentTime,
    });
    const startCaptureForTab = vi.fn().mockRejectedValue(new Error('cdp unavailable'));
    const stopCaptureForTab = vi.fn().mockResolvedValue(undefined);
    const buildEvidence = vi.fn();

    await expect(
      beginPageDomAnalysisEvidenceCapture({
        now: () => currentTime,
        sessionStore,
        cdpService: {
          startCaptureForTab,
          stopCaptureForTab,
          getNetworkEvidenceForTab: vi.fn(),
          clearTab: vi.fn(),
        },
        buildEvidence,
      })
    ).rejects.toThrow('cdp unavailable');

    expect(sessionStore.getSession('session-startup-fail')).toBeUndefined();
    expect(stopCaptureForTab).toHaveBeenCalledWith(9);
    expect(buildEvidence).not.toHaveBeenCalled();
  });

  it('startDomAnalysisSession 总是收敛为 interactive 模式', async () => {
    queryTabs.mockResolvedValue([{ id: 9, url: 'https://example.com', active: true, windowId: 1 }]);

    const session = await startDomAnalysisSession({
      now: () => 1_000,
      sessionStore: createDomAnalysisSessionStore({
        createId: () => 'session-interactive-only',
      }),
    });

    expect(session).toMatchObject({
      sessionId: 'session-interactive-only',
      tabId: 9,
      mode: 'interactive',
      startedAt: 1_000,
    });
  });

  it('captureDomAnalysisEvidenceForSession 在 session 过期时返回统一错误', async () => {
    queryTabs.mockResolvedValue([{ id: 9, url: 'https://example.com', active: true, windowId: 1 }]);
    let currentTime = 1_000;
    const sessionStore = createDomAnalysisSessionStore({
      createId: () => 'session-expired',
      now: () => currentTime,
      ttlMs: 100,
    });
    await startDomAnalysisSession({
      now: () => 1_000,
      sessionStore,
    });

    expect(sessionStore.listSessions()).toHaveLength(1);
    expect(sessionStore.getSession('session-expired')).toBeDefined();
    currentTime = 1_200;
    expect(sessionStore.listSessions()).toEqual([]);

    await expect(
      captureDomAnalysisEvidenceForSession({
        sessionId: 'session-expired',
        now: () => 1_200,
        sessionStore,
        cdpService: {
          startCaptureForTab: vi.fn(),
          stopCaptureForTab: vi.fn(),
          getNetworkEvidenceForTab: vi.fn(),
          clearTab: vi.fn(),
        },
        buildEvidence: vi.fn(),
      })
    ).rejects.toThrow('未找到 DOM 分析会话: session-expired');
  });

  it('buildDomAnalysisEvidenceForTarget 在 tab 可用时复用 buildPageEvidence', async () => {
    queryTabs.mockResolvedValue([]);
    const getTab = vi.fn().mockResolvedValue({
      id: 9,
      windowId: 3,
      url: 'https://example.com',
      title: 'Example',
    });
    const pageEvidence = { captureSessionMeta: { sessionId: 'target-session' } } as PageEvidence;
    const buildEvidence = vi.fn().mockResolvedValue(pageEvidence);
    vi.stubGlobal('chrome', {
      tabs: {
        query: queryTabs,
        get: getTab,
      },
      scripting: {
        executeScript,
      },
    });

    await expect(
      buildDomAnalysisEvidenceForTarget({
        tabId: 9,
        sessionId: 'target-session',
        targetElement: sampleResult,
        mode: 'interactive',
        startedAt: 1_000,
        capturedAt: 1_300,
        preCaptureWindowMs: 200,
        postCaptureWindowMs: 50,
        includeFrames: true,
        maxChars: 2_048,
        buildEvidence,
      })
    ).resolves.toBe(pageEvidence);

    expect(buildEvidence).toHaveBeenCalledWith({
      tab: expect.objectContaining({
        id: 9,
        windowId: 3,
        url: 'https://example.com',
        title: 'Example',
      }),
      targetElement: sampleResult,
      captureSessionMeta: {
        sessionId: 'target-session',
        tabId: 9,
        capturedAt: 1_300,
        mode: 'interactive',
      },
      networkWindow: {
        startTime: 800,
        endTime: 1_350,
      },
      includeFrames: true,
      maxChars: 2_048,
    });
  });

  it('exposes the picker through the background router chain', async () => {
    queryTabs.mockResolvedValue([{ id: 9, url: 'https://example.com', active: true, windowId: 1 }]);
    executeScript.mockResolvedValue([{ result: sampleResult }]);

    const caller = BGSWRouter.createCaller({});

    await expect(caller.pagePicker.pickElement()).resolves.toMatchObject({
      selector: '#hero',
      tagName: 'section',
    });
  });
});

describe('extractPickedElementContext', () => {
  it('extracts selector, xpath, rect, outerHTML, ancestors and siblings', () => {
    document.body.innerHTML = `
      <main class="page-root">
        <div id="content">
          <div class="previous">搜索框区域</div>
          <div id="target" class="result result-op" data-log="123">CC-Switch配置切换神器</div>
          <div class="next">相关推荐卡片</div>
        </div>
      </main>
    `;

    const target = document.getElementById('target') as HTMLElement;
    vi.spyOn(target, 'getBoundingClientRect').mockReturnValue({
      x: 120,
      y: 240,
      width: 640,
      height: 180,
      top: 240,
      right: 760,
      bottom: 420,
      left: 120,
      toJSON: () => ({}),
    });

    const context = extractPickedElementContext(target);

    expect(context.selector).toContain('#target');
    expect(context.xpath).toContain('//*[@id="target"]');
    expect(context.text).toContain('CC-Switch');
    expect(context.dataAttributes).toEqual({ log: '123' });
    expect(context.ancestors[0]?.tagName).toBe('div');
    expect(context.siblings.previous).toContain('搜索框区域');
    expect(context.siblings.next).toContain('相关推荐卡片');
    expect(context.rect).toEqual({ x: 120, y: 240, width: 640, height: 180 });
  });
});

describe('runPagePickerInPage', () => {
  it('shows hover highlight, resolves on click, and cleans up overlay/listeners', async () => {
    document.body.innerHTML = `
      <main>
        <button id="target" class="cta">立即提交</button>
      </main>
    `;
    const target = document.getElementById('target') as HTMLElement;
    const addEventListenerSpy = vi.spyOn(document, 'addEventListener');
    const removeEventListenerSpy = vi.spyOn(document, 'removeEventListener');
    vi.spyOn(target, 'getBoundingClientRect').mockReturnValue({
      x: 10,
      y: 20,
      width: 200,
      height: 40,
      top: 20,
      right: 210,
      bottom: 60,
      left: 10,
      toJSON: () => ({}),
    });

    const pickPromise = runPagePickerInPage();
    const overlay = document.documentElement.lastElementChild as HTMLElement;

    expect(overlay?.style.pointerEvents).toBe('none');

    target.dispatchEvent(
      new MouseEvent('mousemove', {
        bubbles: true,
        cancelable: true,
      })
    );

    expect(overlay.style.left).toBe('10px');
    expect(overlay.style.top).toBe('20px');
    expect(overlay.style.width).toBe('200px');
    expect(overlay.style.height).toBe('40px');

    const clickEvent = new MouseEvent('click', {
      bubbles: true,
      cancelable: true,
    });
    target.dispatchEvent(clickEvent);

    const result = await pickPromise;

    expect(clickEvent.defaultPrevented).toBe(true);
    expect(result).toMatchObject({
      selector: '#target',
      tagName: 'button',
      text: '立即提交',
    });
    expect(document.documentElement.contains(overlay)).toBe(false);
    expect(addEventListenerSpy).toHaveBeenCalledWith('mousemove', expect.any(Function), true);
    expect(addEventListenerSpy).toHaveBeenCalledWith('click', expect.any(Function), true);
    expect(removeEventListenerSpy).toHaveBeenCalledWith('mousemove', expect.any(Function), true);
    expect(removeEventListenerSpy).toHaveBeenCalledWith('click', expect.any(Function), true);
  });

  it('rejects on timeout and cleans up the overlay', async () => {
    vi.useFakeTimers();
    document.body.innerHTML = '<button id="target">等待超时</button>';

    const pickPromise = runPagePickerInPage(5).then(
      () => 'resolved',
      (error) => (error instanceof Error ? error.message : String(error))
    );

    await vi.advanceTimersByTimeAsync(6);

    await expect(pickPromise).resolves.toBe('页面元素拾取超时');
    expect(document.querySelector('[data-webmcp-page-picker-overlay="true"]')).toBeNull();
  });

  it('cancels the previous picker session before starting a new one', async () => {
    document.body.innerHTML = '<button id="target">再次拾取</button>';
    const target = document.getElementById('target') as HTMLElement;
    vi.spyOn(target, 'getBoundingClientRect').mockReturnValue({
      x: 1,
      y: 2,
      width: 3,
      height: 4,
      top: 2,
      right: 4,
      bottom: 6,
      left: 1,
      toJSON: () => ({}),
    });

    const firstPromise = runPagePickerInPage();
    const firstOverlay = document.querySelector(
      '[data-webmcp-page-picker-overlay="true"]'
    ) as HTMLElement;

    const secondPromise = runPagePickerInPage();
    const secondOverlay = document.querySelector(
      '[data-webmcp-page-picker-overlay="true"]'
    ) as HTMLElement;

    expect(firstOverlay).not.toBe(secondOverlay);
    expect(document.documentElement.contains(firstOverlay)).toBe(false);
    expect(document.documentElement.contains(secondOverlay)).toBe(true);
    await expect(firstPromise).rejects.toThrow('页面元素拾取已取消');

    target.dispatchEvent(
      new MouseEvent('click', {
        bubbles: true,
        cancelable: true,
      })
    );

    await expect(secondPromise).resolves.toMatchObject({
      selector: '#target',
    });
  });
});
