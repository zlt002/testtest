// @vitest-environment node

import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { PickedElementContext } from '@/entrypoints/lib/page-picker';
import { createDomAnalysisSessionStore } from './dom-analysis-session-store';
import {
  classifyPickedElement,
  createPageEditElementAnalysisService,
} from './page-edit-element-analysis';

const buttonTarget: PickedElementContext = {
  url: 'https://example.com/dashboard',
  selector: 'button.save',
  xpath: '//button[@class="save"]',
  tagName: 'button',
  id: null,
  classList: ['save'],
  dataAttributes: {},
  text: '保存',
  rect: { x: 10, y: 20, width: 120, height: 36 },
  outerHTMLSnippet: '<button class="save">保存</button>',
  ancestors: [],
  siblings: { previous: null, next: null },
};

const displayTarget: PickedElementContext = {
  url: 'https://example.com/dashboard',
  selector: '#hero',
  xpath: '//*[@id="hero"]',
  tagName: 'section',
  id: 'hero',
  classList: ['hero'],
  dataAttributes: {},
  text: '欢迎回来',
  rect: { x: 0, y: 0, width: 480, height: 220 },
  outerHTMLSnippet: '<section id="hero"><h1>欢迎回来</h1></section>',
  ancestors: [],
  siblings: { previous: null, next: null },
};

describe('createPageEditElementAnalysisService', () => {
  let startCaptureForTab: ReturnType<typeof vi.fn>;
  let stopCaptureForTab: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    startCaptureForTab = vi.fn().mockResolvedValue(undefined);
    stopCaptureForTab = vi.fn().mockResolvedValue(undefined);
  });

  it('为 interactive target 创建 waiting-interaction 状态并启动 capture', async () => {
    const sessionStore = createDomAnalysisSessionStore({
      createId: () => 'selection-interactive-session',
      now: () => 1_000,
    });
    const service = createPageEditElementAnalysisService({
      now: () => 1_000,
      sessionStore,
      cdpService: {
        startCaptureForTab,
        stopCaptureForTab,
        getNetworkEvidenceForTab: vi.fn(),
        clearTab: vi.fn(),
      },
    });

    await expect(
      service.startSelectionAnalysis({
        tabId: 42,
        targetElement: buttonTarget,
      })
    ).resolves.toEqual({
      sessionId: 'selection-interactive-session',
      tabId: 42,
      analysisMode: 'interactive',
      status: 'waiting-interaction',
    });

    expect(startCaptureForTab).toHaveBeenCalledWith(42);
    expect(sessionStore.getSession('selection-interactive-session')).toMatchObject({
      sessionId: 'selection-interactive-session',
      tabId: 42,
      mode: 'selection-interactive',
      startedAt: 1_000,
      targetElement: buttonTarget,
    });
  });

  it('为 display target 创建 waiting-refresh 状态', async () => {
    const sessionStore = createDomAnalysisSessionStore({
      createId: () => 'selection-display-session',
      now: () => 2_000,
    });
    const service = createPageEditElementAnalysisService({
      now: () => 2_000,
      sessionStore,
      cdpService: {
        startCaptureForTab,
        stopCaptureForTab,
        getNetworkEvidenceForTab: vi.fn(),
        clearTab: vi.fn(),
      },
    });

    await expect(
      service.startSelectionAnalysis({
        tabId: 77,
        targetElement: displayTarget,
      })
    ).resolves.toEqual({
      sessionId: 'selection-display-session',
      tabId: 77,
      analysisMode: 'display',
      status: 'waiting-refresh',
    });

    expect(sessionStore.getSession('selection-display-session')).toMatchObject({
      mode: 'selection-display',
      targetElement: displayTarget,
    });
  });

  it('cancelSelectionAnalysis 会清理 session 并停止 capture', async () => {
    vi.useFakeTimers();
    const sessionStore = createDomAnalysisSessionStore({
      createId: () => 'selection-to-cancel',
      now: () => 4_000,
    });
    const service = createPageEditElementAnalysisService({
      now: () => 4_000,
      sessionStore,
      cdpService: {
        startCaptureForTab,
        stopCaptureForTab,
        getNetworkEvidenceForTab: vi.fn(),
        clearTab: vi.fn(),
      },
      ttlMs: 50,
    });

    await service.startSelectionAnalysis({
      tabId: 88,
      targetElement: buttonTarget,
    });

    await service.cancelSelectionAnalysis('selection-to-cancel');
    await vi.advanceTimersByTimeAsync(60);

    expect(sessionStore.getSession('selection-to-cancel')).toBeUndefined();
    expect(stopCaptureForTab).toHaveBeenCalledWith(88);
    expect(stopCaptureForTab).toHaveBeenCalledTimes(1);
  });

  it('session 超时后会自动清理并停止 capture', async () => {
    vi.useFakeTimers();
    const sessionStore = createDomAnalysisSessionStore({
      createId: () => 'selection-timeout',
      now: () => 5_000,
    });
    const service = createPageEditElementAnalysisService({
      now: () => 5_000,
      sessionStore,
      cdpService: {
        startCaptureForTab,
        stopCaptureForTab,
        getNetworkEvidenceForTab: vi.fn(),
        clearTab: vi.fn(),
      },
      ttlMs: 50,
    });

    await service.startSelectionAnalysis({
      tabId: 66,
      targetElement: buttonTarget,
    });

    await vi.advanceTimersByTimeAsync(60);

    expect(sessionStore.getSession('selection-timeout')).toBeUndefined();
    expect(stopCaptureForTab).toHaveBeenCalledWith(66);
  });

  it('completeSelectionAnalysis 会串起 evidence、dom-analyze 并返回结构化分析结果', async () => {
    const sessionStore = createDomAnalysisSessionStore({
      createId: () => 'selection-complete-session',
      now: () => 10_000,
    });
    const buildEvidenceForTarget = vi.fn().mockResolvedValue({
      pageContext: {
        title: '运单中心',
        url: 'https://example.com/dashboard',
        pathname: '/dashboard',
        hashRoute: '#/orders',
        apiCandidates: ['/api/orders/query'],
      },
      targetElement: {
        tagName: 'button',
        text: '查询',
        selector: 'button.query',
        xpath: '//button[@class="query"]',
      },
      networkEvidence: [],
    });
    const analyzeDom = vi.fn().mockResolvedValue({
      analysisCard: {
        pageName: '运单中心',
        route: '#/orders',
        targetAction: '点击「查询」',
        actionType: '列表查询',
        tableHeaders: ['订单号', '状态'],
        recommendedApi: '/api/orders/query',
        confidence: 'medium',
      },
      suggestedCommand: '/ewankb-server-query graph gls "运单中心 查询 列表查询 orders query 订单号 状态"',
      chatSummary: {
        markdown: '# DOM 分析摘要\n\n- 推荐接口：`/api/orders/query`',
      },
    });
    const ensureCompanionReady = vi.fn().mockResolvedValue({
      agentBaseUrl: 'http://127.0.0.1:8792',
      agentApiBaseUrl: 'http://127.0.0.1:8792/api/agent-v2',
    });
    const onProgress = vi.fn().mockResolvedValue(undefined);
    const service = createPageEditElementAnalysisService({
      now: () => 10_000,
      sessionStore,
      cdpService: {
        startCaptureForTab,
        stopCaptureForTab,
        getNetworkEvidenceForTab: vi.fn(),
        clearTab: vi.fn(),
      },
      buildEvidenceForTarget,
      analyzeDom,
      ensureCompanionReady,
    });

    await service.startSelectionAnalysis({
      tabId: 52,
      targetElement: buttonTarget,
    });

    await expect(
      service.completeSelectionAnalysis({
        sessionId: 'selection-complete-session',
        onProgress,
      })
    ).resolves.toEqual({
      markdown: '# DOM 分析摘要\n\n- 推荐接口：`/api/orders/query`',
      analysisCard: {
        pageName: '运单中心',
        route: '#/orders',
        targetAction: '点击「查询」',
        actionType: '列表查询',
        tableHeaders: ['订单号', '状态'],
        recommendedApi: '/api/orders/query',
        confidence: 'medium',
      },
      suggestedCommand:
        '/ewankb-server-query graph gls "运单中心 查询 列表查询 orders query 订单号 状态"',
    });

    expect(ensureCompanionReady).toHaveBeenCalledTimes(1);
    expect(onProgress).toHaveBeenNthCalledWith(1, '开始收集页面分析证据');
    expect(onProgress).toHaveBeenNthCalledWith(2, '页面分析证据收集完成');
    expect(onProgress).toHaveBeenNthCalledWith(
      3,
      '页面分析证据摘要 | network=0 | apiCandidates=1 | topApis=/api/orders/query'
    );
    expect(onProgress).toHaveBeenNthCalledWith(4, '开始请求页面分析服务');
    expect(onProgress).toHaveBeenNthCalledWith(5, '页面分析服务已返回 | hasCard=yes');
    expect(buildEvidenceForTarget).toHaveBeenCalledWith({
      sessionId: 'selection-complete-session',
      tabId: 52,
      targetElement: buttonTarget,
      mode: 'selection-interactive',
      startedAt: 10_000,
    });
    expect(analyzeDom).toHaveBeenCalledWith({
      agentBaseUrl: 'http://127.0.0.1:8792',
      input: {
        pageEvidence: {
          pageContext: {
            title: '运单中心',
            url: 'https://example.com/dashboard',
            pathname: '/dashboard',
            hashRoute: '#/orders',
            apiCandidates: ['/api/orders/query'],
          },
          targetElement: {
            tagName: 'button',
            text: '查询',
            selector: 'button.query',
            xpath: '//button[@class="query"]',
          },
          networkEvidence: [],
        },
      },
    });
    expect(stopCaptureForTab).toHaveBeenCalledWith(52);
    expect(sessionStore.getSession('selection-complete-session')).toBeUndefined();
  });

  it('retries evidence collection when the first interactive pass has no network candidates', async () => {
    vi.useFakeTimers();
    const sessionStore = createDomAnalysisSessionStore({
      createId: () => 'selection-retry-session',
      now: () => 20_000,
    });
    const retryTarget = {
      ...buttonTarget,
      text: '审核',
      selector: 'button.audit',
      xpath: '//button[@class="audit"]',
      outerHTMLSnippet: '<button class="audit">审核</button>',
    };
    const buildEvidenceForTarget = vi
      .fn()
      .mockResolvedValueOnce({
        pageContext: {
          title: '订单中心',
          url: 'https://example.com/orders',
          pathname: '/orders',
          hashRoute: '#/list',
          apiCandidates: [],
        },
        targetElement: {
          tagName: 'button',
          text: '审核',
          selector: 'button.audit',
          xpath: '//button[@class="audit"]',
        },
        networkEvidence: [],
      })
      .mockResolvedValueOnce({
        pageContext: {
          title: '订单中心',
          url: 'https://example.com/orders',
          pathname: '/orders',
          hashRoute: '#/list',
          apiCandidates: ['/api/orders/audit'],
        },
        targetElement: {
          tagName: 'button',
          text: '审核',
          selector: 'button.audit',
          xpath: '//button[@class="audit"]',
        },
        networkEvidence: [
          {
            requestId: 'retry-1',
            url: 'https://example.com/api/orders/audit',
            method: 'POST',
            status: 200,
            resourceType: 'XHR',
            startedAt: 20_100,
            finishedAt: 20_250,
            initiatorHint: 'script',
            responsePreview: null,
          },
        ],
      });
    const analyzeDom = vi.fn().mockResolvedValue({
      analysisCard: {
        pageName: '订单中心',
        route: '#/list',
        targetAction: '点击「审核」',
        actionType: '审核',
        tableHeaders: ['订单号', '状态'],
        recommendedApi: '/api/orders/audit',
        confidence: 'medium',
      },
      suggestedCommand: '/ewankb-server-query graph el "订单中心 审核"',
      chatSummary: {
        markdown: '# DOM 分析摘要\n\n- 推荐接口：`/api/orders/audit`',
      },
    });
    const ensureCompanionReady = vi.fn().mockResolvedValue({
      agentBaseUrl: 'http://127.0.0.1:8792',
      agentApiBaseUrl: 'http://127.0.0.1:8792/api/agent-v2',
    });
    const onProgress = vi.fn().mockResolvedValue(undefined);
    const service = createPageEditElementAnalysisService({
      now: () => 20_000,
      sessionStore,
      cdpService: {
        startCaptureForTab,
        stopCaptureForTab,
        getNetworkEvidenceForTab: vi.fn(),
        clearTab: vi.fn(),
      },
      buildEvidenceForTarget,
      analyzeDom,
      ensureCompanionReady,
    });

    await service.startSelectionAnalysis({
      tabId: 88,
      targetElement: retryTarget,
    });

    const resultPromise = service.completeSelectionAnalysis({
      sessionId: 'selection-retry-session',
      onProgress,
    });

    await vi.advanceTimersByTimeAsync(1_600);

    await expect(resultPromise).resolves.toEqual({
      markdown: '# DOM 分析摘要\n\n- 推荐接口：`/api/orders/audit`',
      analysisCard: {
        pageName: '订单中心',
        route: '#/list',
        targetAction: '点击「审核」',
        actionType: '审核',
        tableHeaders: ['订单号', '状态'],
        recommendedApi: '/api/orders/audit',
        confidence: 'medium',
      },
      suggestedCommand: '/ewankb-server-query graph el "订单中心 审核"',
    });

    expect(buildEvidenceForTarget).toHaveBeenCalledTimes(2);
    expect(onProgress).toHaveBeenCalledWith('未捕获到候选请求，等待页面异步请求后重试');
    expect(onProgress).toHaveBeenCalledWith('页面分析证据重试收集完成');
    expect(onProgress).toHaveBeenCalledWith(
      '页面分析证据重试摘要 | network=1 | apiCandidates=1 | topApis=/api/orders/audit'
    );
    vi.useRealTimers();
  });
});

describe('createDomAnalysisSessionStore', () => {
  it('启动 session 时可携带初始 targetElement', () => {
    const sessionStore = createDomAnalysisSessionStore({
      createId: () => 'session-with-target',
      now: () => 3_000,
    });

    const session = sessionStore.startSession({
      tabId: 9,
      mode: 'selection-interactive',
      startedAt: 3_000,
      targetElement: buttonTarget,
    });

    expect(session).toMatchObject({
      sessionId: 'session-with-target',
      tabId: 9,
      mode: 'selection-interactive',
      startedAt: 3_000,
      targetElement: buttonTarget,
    });
  });
});

describe('classifyPickedElement', () => {
  it('不会把 tabindex=-1 的普通 section 误判为 interactive', () => {
    const target: PickedElementContext = {
      ...displayTarget,
      outerHTMLSnippet: '<section tabindex="-1">只用于聚焦管理</section>',
    };

    expect(classifyPickedElement(target)).toBe('display');
  });

  it('不会把 contenteditable=false 的普通展示元素误判为 interactive', () => {
    const target: PickedElementContext = {
      ...displayTarget,
      outerHTMLSnippet: '<section contenteditable="false">只读展示内容</section>',
    };

    expect(classifyPickedElement(target)).toBe('display');
  });
});
