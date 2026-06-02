import assert from 'node:assert/strict';
import test from 'node:test';
import { buildSuggestedCommand } from './suggested-command-builder.ts';

test('suggested command builder keeps high-signal query terms only', () => {
  const result = buildSuggestedCommand({
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
    kbCandidate: null,
    featureName: '快递询价',
    actionTerms: ['搜索', '列表查询'],
    apiTerms: ['expressCostPrice', 'summarySearch'],
    fieldTerms: ['供应商简称', '目的地', '服务类型'],
  });

  assert.equal(result, null);
});
