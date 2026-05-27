import assert from 'node:assert/strict';
import test from 'node:test';
import type { AttributionResult } from './types.ts';
import { createChatSummaryBuilder } from './chat-summary-builder.ts';

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

test('chat summary builder emits evidence-first markdown without source routing metadata', () => {
  const builder = createChatSummaryBuilder();

  const markdown = builder.build({
    page: {
      title: '回单管理',
      url: 'https://an-uat.annto.com/#/distribute/receipt-mngt/list',
      pathname: '/index.html',
      hashRoute: '/distribute/receipt-mngt/list',
    },
    targetElement: {
      tagName: 'BUTTON',
      text: '查询',
      selector: '[data-testid="target"]',
      xpath: '//*[@data-testid="target"]',
    },
    attribution: createAttribution(),
    evidence: {
      pageTextSummary: ['回单管理', '监控'],
      apiCandidates: ['/api-tms/receipt/queryList'],
      resourceHints: ['receipt-list.chunk.js'],
    },
  });

  assert.match(markdown, /^# 页面元素接口联分析/m);
  assert.match(markdown, /## 目标元素/);
  assert.match(markdown, /## 接口判断/);
  assert.match(markdown, /推荐接口：`\/api-tms\/receipt\/queryList`/);
  assert.match(markdown, /置信度：high/);
  assert.match(markdown, /## 页面证据/);
  assert.match(markdown, /页面摘要关键词：回单管理、监控/);
  assert.match(markdown, /运行时接口候选：\/api-tms\/receipt\/queryList/);
  assert.match(markdown, /资源线索：receipt-list.chunk.js/);
  assert.doesNotMatch(markdown, /建议知识库|建议查询模式|匹配规则/);
});
