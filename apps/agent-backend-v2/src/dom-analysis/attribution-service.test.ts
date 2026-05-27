import assert from 'node:assert/strict';
import test from 'node:test';
import type { PageEvidence } from '@mcp-b/dom-analysis-contracts';
import { createAttributionService } from './attribution-service.ts';

function createEvidence(overrides?: Partial<PageEvidence>): PageEvidence {
  return {
    targetElement: {
      selector: '[data-testid="target"]',
      xpath: '//*[@data-testid="target"]',
      tagName: 'BUTTON',
      text: '订单详情',
      outerHTMLSnippet: '<button>订单详情</button>',
      classList: ['primary-action'],
      dataAttributes: {},
    },
    pageContext: {
      url: 'https://example.com/orders/detail?id=1',
      pathname: '/orders/detail',
      hashRoute: '/orders/detail',
      title: '订单详情',
      pageTextSummary: ['订单详情', '订单', '详情'],
      apiCandidates: ['/api/orders/detail?id=1'],
      resourceHints: ['orders.chunk.js'],
    },
    networkEvidence: [
      {
        requestId: 'req-1',
        url: 'https://api.example.com/api/orders/detail?id=1',
        method: 'GET',
        status: 200,
        resourceType: 'xhr',
        startedAt: 1,
        finishedAt: 2,
        initiatorHint: 'orders-detail-page',
        responsePreview: '订单详情 Alice',
      },
    ],
    interactionEvidence: [],
    runtimeEvidence: {
      scriptUrls: ['https://cdn.example.com/orders.chunk.js'],
      chunkHints: ['orders.chunk.js'],
      sourceMapHints: [],
    },
    captureSessionMeta: {
      sessionId: 'session-1',
      tabId: 1,
      capturedAt: 100,
      mode: 'interactive',
    },
    ...overrides,
  };
}

test('高置信度时返回最佳接口并建议直接查看接口实现', () => {
  const service = createAttributionService();

  const result = service.attribute(createEvidence());

  assert.equal(result.bestApi, '/api/orders/detail');
  assert.equal(result.confidence, 'high');
  assert.equal(result.needsMoreEvidence, false);
  assert.equal(result.recommendedAction, 'inspect-best-api');
  assert.equal(result.candidateApis[0]?.api, '/api/orders/detail');
});

test('中等置信度时保留候选并建议补充交叉验证', () => {
  const service = createAttributionService();

  const result = service.attribute(
    createEvidence({
      targetElement: {
        selector: '[data-testid="target"]',
        xpath: '//*[@data-testid="target"]',
        tagName: 'SPAN',
        text: '订单',
        outerHTMLSnippet: '<span>订单</span>',
        classList: [],
        dataAttributes: {},
      },
      pageContext: {
        url: 'https://example.com/orders',
        pathname: '/orders',
        hashRoute: '/orders',
        title: '订单列表',
        pageTextSummary: ['订单', '列表'],
        apiCandidates: ['/api/orders/list?page=1'],
        resourceHints: [],
      },
      networkEvidence: [
        {
          requestId: 'req-1',
          url: 'https://api.example.com/api/orders/list?page=1',
          method: 'GET',
          status: 200,
          resourceType: 'fetch',
          startedAt: 1,
          finishedAt: 2,
          initiatorHint: null,
          responsePreview: null,
        },
      ],
      runtimeEvidence: {
        scriptUrls: [],
        chunkHints: [],
        sourceMapHints: [],
      },
    })
  );

  assert.equal(result.bestApi, '/api/orders/list');
  assert.equal(result.confidence, 'medium');
  assert.equal(result.needsMoreEvidence, true);
  assert.equal(result.recommendedAction, 'validate-top-candidates');
  assert.ok(result.candidateApis.length >= 1);
});

test('低置信度时提示继续采集证据', () => {
  const service = createAttributionService();

  const result = service.attribute(
    createEvidence({
      targetElement: {
        selector: null,
        xpath: null,
        tagName: 'DIV',
        text: '概览',
        outerHTMLSnippet: '<div>概览</div>',
        classList: [],
        dataAttributes: {},
      },
      pageContext: {
        url: 'https://example.com/dashboard',
        pathname: '/dashboard',
        hashRoute: '/dashboard',
        title: '首页',
        pageTextSummary: ['首页', '概览'],
        apiCandidates: [],
        resourceHints: [],
      },
      networkEvidence: [],
      runtimeEvidence: {
        scriptUrls: [],
        chunkHints: [],
        sourceMapHints: [],
      },
    })
  );

  assert.equal(result.bestApi, null);
  assert.equal(result.confidence, 'low');
  assert.equal(result.needsMoreEvidence, true);
  assert.equal(result.recommendedAction, 'collect-more-evidence');
  assert.deepEqual(result.candidateApis, []);
});

test('单候选但文本摘要与候选无关时不会轻易提升到高置信度', () => {
  const service = createAttributionService();

  const result = service.attribute(
    createEvidence({
      targetElement: {
        selector: '[data-testid="target"]',
        xpath: '//*[@data-testid="target"]',
        tagName: 'DIV',
        text: '用户概览',
        outerHTMLSnippet: '<div>用户概览</div>',
        classList: [],
        dataAttributes: {},
      },
      pageContext: {
        url: 'https://example.com/dashboard',
        pathname: '/dashboard',
        hashRoute: '/dashboard',
        title: '用户中心',
        pageTextSummary: ['用户中心', '概览', '统计'],
        apiCandidates: ['/api/orders/detail?id=1'],
        resourceHints: [],
      },
      networkEvidence: [
        {
          requestId: 'req-1',
          url: 'https://api.example.com/api/orders/detail?id=1',
          method: 'GET',
          status: 200,
          resourceType: 'xhr',
          startedAt: 1,
          finishedAt: 2,
          initiatorHint: null,
          responsePreview: null,
        },
      ],
      runtimeEvidence: {
        scriptUrls: [],
        chunkHints: [],
        sourceMapHints: [],
      },
    })
  );

  assert.equal(result.bestApi, '/api/orders/detail');
  assert.equal(result.confidence, 'medium');
  assert.equal(result.needsMoreEvidence, true);
  assert.equal(result.recommendedAction, 'validate-top-candidates');
  assert.deepEqual(result.candidateApis[0]?.evidence, ['api-candidate', 'network-request']);
  assert.equal(result.candidateApis[0]?.score, 14);
});
