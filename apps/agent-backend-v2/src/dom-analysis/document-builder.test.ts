import assert from 'node:assert/strict';
import test from 'node:test';
import { createDocumentBuilder } from './document-builder.ts';
import type { AttributionResult, DomDocumentLocation, DomDocumentPage } from './types.ts';

function createPage(): DomDocumentPage {
  return {
    title: '回单管理',
    url: 'https://an-uat.annto.com/#/distribute/receipt-mngt/list',
    hashRoute: '/distribute/receipt-mngt/list',
    targetElement: '回单管理',
  };
}

function createAttribution(): AttributionResult {
  return {
    bestApi: '/api-tms/receipt/queryList',
    candidateApis: [
      {
        api: '/api-tms/receipt/queryList',
        score: 20,
        evidence: ['api-candidate', 'network-request', 'element-text'],
      },
    ],
    confidence: 'high',
    needsMoreEvidence: false,
    recommendedAction: 'inspect-best-api',
  };
}

function createLocation(): DomDocumentLocation {
  return {
    matchedRuleId: 'otp-receipt',
    frontend: {
      graphProjects: ['Users-zhanglt21-Desktop-codebase-otp-pc'],
      searchTerms: ['/distribute/receipt-mngt/list', '回单管理', 'receipt-list.chunk.js'],
    },
    backend: {
      graphProjects: ['Users-zhanglt21-Desktop-codebase-t-tms'],
      searchTerms: ['/api-tms/receipt/queryList', '回单管理'],
    },
    shared: {
      graphProjects: ['Users-zhanglt21-Desktop-codebase-tms-components-v3'],
      searchTerms: ['receipt-list.chunk.js', '回单管理'],
    },
  };
}

test('文档生成器可以生成分析报告 markdown', () => {
  const builder = createDocumentBuilder();

  const markdown = builder.build({
    documentType: 'analysis-report',
    page: createPage(),
    attribution: createAttribution(),
    location: createLocation(),
  });

  assert.match(markdown, /^# 页面 DOM 分析报告/m);
  assert.match(markdown, /回单管理/);
  assert.match(markdown, /最佳接口：`\/api-tms\/receipt\/queryList`/);
  assert.match(markdown, /Users-zhanglt21-Desktop-codebase-otp-pc/);
});

test('文档生成器可以生成技术方案 markdown', () => {
  const builder = createDocumentBuilder();

  const markdown = builder.build({
    documentType: 'technical-design',
    page: createPage(),
    attribution: createAttribution(),
    location: createLocation(),
  });

  assert.match(markdown, /^# 技术方案草案/m);
  assert.match(markdown, /接口与数据来源/);
  assert.match(markdown, /前端改造点/);
  assert.match(markdown, /测试与验收建议/);
});
