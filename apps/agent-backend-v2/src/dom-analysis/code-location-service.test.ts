import assert from 'node:assert/strict';
import test from 'node:test';
import type { PageEvidence } from '@mcp-b/dom-analysis-contracts';
import type { AttributionResult } from './types.ts';
import { createCodeLocationService } from './code-location-service.ts';

function createEvidence(overrides?: Partial<PageEvidence>): PageEvidence {
  return {
    targetElement: {
      selector: '[data-testid="target"]',
      xpath: '//*[@data-testid="target"]',
      tagName: 'BUTTON',
      text: '回单管理',
      outerHTMLSnippet: '<button>回单管理</button>',
      classList: ['primary-action'],
      dataAttributes: {},
    },
    pageContext: {
      url: 'https://an-uat.annto.com/#/distribute/receipt-mngt/list',
      pathname: '/index.html',
      hashRoute: '/distribute/receipt-mngt/list',
      title: '回单管理',
      pageTextSummary: ['回单管理', '监控'],
      apiCandidates: ['/api-tms/receipt/queryList'],
      resourceHints: ['receipt-list.chunk.js'],
    },
    networkEvidence: [],
    interactionEvidence: [],
    runtimeEvidence: {
      scriptUrls: ['https://cdn.example.com/receipt-list.chunk.js'],
      chunkHints: ['receipt-list.chunk.js'],
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

function createAttributionResult(
  overrides?: Partial<AttributionResult>
): AttributionResult {
  return {
    bestApi: '/api-tms/receipt/queryList',
    candidateApis: [
      {
        api: '/api-tms/receipt/queryList',
        score: 20,
        evidence: ['api-candidate', 'network-request'],
      },
    ],
    confidence: 'high',
    needsMoreEvidence: false,
    recommendedAction: 'inspect-best-api',
    ...overrides,
  };
}

test('代码定位服务会将归因结果映射为 frontend/backend/shared 查询输入', () => {
  const service = createCodeLocationService();

  const result = service.locate({
    pageEvidence: createEvidence(),
    attribution: createAttributionResult(),
    pageCodebaseMappingConfig: {
      rules: [
        {
          id: 'otp-receipt',
          businessId: 'otp',
          pageLabel: '回单管理',
          triggerSkill: '/ewankb-server-query',
          ewankbKb: 'otp',
          ewankbMode: 'graph',
          enabled: true,
          hostIncludes: ['an-uat.annto.com'],
          hashRouteIncludes: ['/distribute/receipt-mngt'],
          pageTextIncludes: ['回单管理', '监控'],
          apiPrefixes: ['/api-tms/receipt/'],
          frontendGraphProjects: [
            'Users-zhanglt21-Desktop-codebase-otp-pc',
            'Users-zhanglt21-Desktop-codebase-otp-pc2',
          ],
          backendGraphProjects: [
            'Users-zhanglt21-Desktop-codebase-t-tms',
            'Users-zhanglt21-Desktop-codebase-logistics-otp',
          ],
          sharedGraphProjects: ['Users-zhanglt21-Desktop-codebase-tms-components-v3'],
        },
      ],
    },
  });

  assert.equal(result.routeContext.matched, true);
  assert.deepEqual(result.frontend.graphProjects, [
    'Users-zhanglt21-Desktop-codebase-otp-pc',
    'Users-zhanglt21-Desktop-codebase-otp-pc2',
  ]);
  assert.deepEqual(result.backend.graphProjects, [
    'Users-zhanglt21-Desktop-codebase-t-tms',
    'Users-zhanglt21-Desktop-codebase-logistics-otp',
  ]);
  assert.deepEqual(result.shared.graphProjects, [
    'Users-zhanglt21-Desktop-codebase-tms-components-v3',
  ]);
  assert.deepEqual(result.frontend.searchTerms, [
    '/distribute/receipt-mngt/list',
    '/index.html',
    '回单管理',
    '监控',
    'receipt-list.chunk.js',
    '/api-tms/receipt/queryList',
  ]);
  assert.deepEqual(result.backend.searchTerms, [
    '/api-tms/receipt/queryList',
    '/distribute/receipt-mngt/list',
    '/index.html',
    '回单管理',
    '监控',
  ]);
  assert.deepEqual(result.shared.searchTerms, [
    'receipt-list.chunk.js',
    '/api-tms/receipt/queryList',
    '回单管理',
    '监控',
  ]);
});

test('低置信归因时仍保留 pageContext 中的原始 API 候选作为查询输入', () => {
  const service = createCodeLocationService();

  const result = service.locate({
    pageEvidence: createEvidence({
      pageContext: {
        url: 'https://an-uat.annto.com/#/distribute/receipt-mngt/list',
        pathname: '/index.html',
        hashRoute: '/distribute/receipt-mngt/list',
        title: '回单管理',
        pageTextSummary: ['回单管理'],
        apiCandidates: ['/api-tms/receipt/queryList', '/api-tms/receipt/detail?id=1'],
        resourceHints: ['receipt-list.chunk.js'],
      },
    }),
    attribution: createAttributionResult({
      bestApi: null,
      candidateApis: [],
      confidence: 'low',
      needsMoreEvidence: true,
      recommendedAction: 'collect-more-evidence',
    }),
    pageCodebaseMappingConfig: {
      rules: [
        {
          id: 'otp-receipt',
          businessId: 'otp',
          pageLabel: '回单管理',
          triggerSkill: '/ewankb-server-query',
          ewankbKb: 'otp',
          ewankbMode: 'graph',
          enabled: true,
          hostIncludes: ['an-uat.annto.com'],
          hashRouteIncludes: ['/distribute/receipt-mngt'],
          pageTextIncludes: ['回单管理'],
          apiPrefixes: ['/api-tms/receipt/'],
          frontendGraphProjects: ['Users-zhanglt21-Desktop-codebase-otp-pc'],
          backendGraphProjects: ['Users-zhanglt21-Desktop-codebase-t-tms'],
          sharedGraphProjects: ['Users-zhanglt21-Desktop-codebase-tms-components-v3'],
        },
      ],
    },
  });

  assert.deepEqual(result.frontend.searchTerms, [
    '/distribute/receipt-mngt/list',
    '/index.html',
    '回单管理',
    'receipt-list.chunk.js',
    '/api-tms/receipt/queryList',
    '/api-tms/receipt/detail?id=1',
  ]);
  assert.deepEqual(result.backend.searchTerms, [
    '/api-tms/receipt/queryList',
    '/api-tms/receipt/detail?id=1',
    '/distribute/receipt-mngt/list',
    '/index.html',
    '回单管理',
  ]);
});
