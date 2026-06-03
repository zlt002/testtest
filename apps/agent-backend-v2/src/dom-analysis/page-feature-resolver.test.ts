import assert from 'node:assert/strict';
import test from 'node:test';
import { resolvePageFeature } from './page-feature-resolver.ts';

test('page feature resolver prioritizes title and preserves deduped candidates', () => {
  const result = resolvePageFeature({
    pageTitle: '快递询价',
    pageLabel: '快递询价',
    hashRoute: '/entrustedOrderModule/expressInquiry',
    navLabels: ['委托中心', '快递询价'],
    pageTextSummary: ['快递询价', '搜索', '供应商简称'],
  });

  assert.deepEqual(result, {
    primaryFeatureName: '快递询价',
    featureNameCandidates: ['快递询价', '委托中心', '搜索', '供应商简称'],
  });
});

test('page feature resolver prefers known hash route mapping over noisy page label', () => {
  const result = resolvePageFeature({
    pageTitle: '统一认证平台',
    pageLabel: '回单管理',
    hashRoute: '/order-manage/order-center',
    navLabels: ['订单管理', '订单中心'],
    pageTextSummary: ['订单中心', '订单状态', '订单号'],
  });

  assert.deepEqual(result, {
    primaryFeatureName: '订单中心',
    featureNameCandidates: ['订单中心', '订单管理', '统一认证平台', '订单状态', '订单号', '回单管理'],
  });
});

test('page feature resolver resolves order center from hash route leaf', () => {
  const result = resolvePageFeature({
    pageTitle: '',
    pageLabel: null,
    hashRoute: '/order-manage/order-center',
    navLabels: [],
    pageTextSummary: [],
  });

  assert.deepEqual(result, {
    primaryFeatureName: '订单中心',
    featureNameCandidates: ['订单中心'],
  });
});

test('page feature resolver returns empty result for blank inputs', () => {
  const result = resolvePageFeature({
    pageTitle: '',
    pageLabel: null,
    hashRoute: '/unknown',
    navLabels: [],
    pageTextSummary: [],
  });

  assert.deepEqual(result, {
    primaryFeatureName: null,
    featureNameCandidates: [],
  });
});
