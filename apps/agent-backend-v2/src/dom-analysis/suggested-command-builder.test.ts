import assert from 'node:assert/strict';
import test from 'node:test';
import { buildSuggestedCommand } from './suggested-command-builder.ts';

test('suggested command builder keeps high-signal query terms only', () => {
  const result = buildSuggestedCommand({
    triggerSkill: '/ewankb-server-query',
    ewankbMode: 'graph',
    kbCandidate: 'gls',
    featureName: '快递询价',
    actionTerms: ['搜索', '列表查询'],
    apiTerms: ['expressCostPrice', 'summarySearch', 'api-miloms'],
    fieldTerms: ['供应商简称', '价目表名称', '起始国/地区', '目的地', '服务类型'],
  });

  assert.equal(
    result,
    '/ewankb-server-query graph gls "快递询价 搜索 列表查询 expressCostPrice summarySearch 供应商简称 目的地 服务类型"'
  );
});

test('suggested command builder returns null when kb candidate is missing', () => {
  const result = buildSuggestedCommand({
    triggerSkill: '/ewankb-server-query',
    ewankbMode: 'graph',
    kbCandidate: null,
    featureName: '快递询价',
    actionTerms: ['搜索', '列表查询'],
    apiTerms: ['expressCostPrice', 'summarySearch'],
    fieldTerms: ['供应商简称', '目的地', '服务类型'],
  });

  assert.equal(result, null);
});

test('suggested command builder falls back to default ewankb graph command when route context is missing', () => {
  const result = buildSuggestedCommand({
    triggerSkill: null,
    ewankbMode: null,
    kbCandidate: 'gls',
    featureName: '快递管理',
    actionTerms: ['搜索', '列表查询'],
    apiTerms: ['expressManagement', 'summarySearch'],
    fieldTerms: ['物流订单号', '快递单号', '状态'],
  });

  assert.equal(
    result,
    '/ewankb-server-query graph gls "快递管理 搜索 列表查询 expressManagement summarySearch 物流订单号 快递单号 状态"'
  );
});

test('suggested command builder supports kb mode and deep mode from route context', () => {
  assert.equal(
    buildSuggestedCommand({
      triggerSkill: '/ewankb-server-query',
      ewankbMode: 'kb',
      kbCandidate: 'gls',
      featureName: '快递询价',
      actionTerms: ['搜索'],
      apiTerms: ['summarySearch'],
      fieldTerms: ['供应商简称', '目的地'],
    }),
    '/ewankb-server-query kb gls "快递询价 搜索 summarySearch 供应商简称 目的地"'
  );

  assert.equal(
    buildSuggestedCommand({
      triggerSkill: '/ewankb-server-query',
      ewankbMode: 'deep',
      kbCandidate: 'gls',
      featureName: '快递询价',
      actionTerms: ['搜索'],
      apiTerms: ['summarySearch'],
      fieldTerms: ['供应商简称', '目的地'],
    }),
    '/ewankb-server-query deep gls "快递询价 搜索 summarySearch 供应商简称 目的地"'
  );
});

test('suggested command builder falls back to default graph command for non ewankb trigger skill', () => {
  const result = buildSuggestedCommand({
    triggerSkill: '/other-skill',
    ewankbMode: 'graph',
    kbCandidate: 'gls',
    featureName: '快递询价',
    actionTerms: ['搜索'],
    apiTerms: ['summarySearch'],
    fieldTerms: ['供应商简称'],
  });

  assert.equal(
    result,
    '/ewankb-server-query graph gls "快递询价 搜索 summarySearch 供应商简称"'
  );
});
