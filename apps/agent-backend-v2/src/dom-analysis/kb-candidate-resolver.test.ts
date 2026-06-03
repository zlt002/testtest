import assert from 'node:assert/strict';
import test from 'node:test';
import { resolveKbCandidate } from './kb-candidate-resolver.ts';
import { resolvePageFeature } from './page-feature-resolver.ts';

test('kb candidate resolver prefers ewankb kb from matched route context', () => {
  assert.equal(
    resolveKbCandidate({
      routeContext: {
        matched: true,
        triggerSkill: '/ewankb-server-query',
        ewankbKb: 'gls',
        ewankbMode: 'graph',
      },
      pageUrl: 'https://other-uat.annto.com/#/demo',
    }),
    'gls'
  );
});

test('kb candidate resolver falls back to host-inferred kb when route context is not ewankb compatible', () => {
  assert.equal(
    resolveKbCandidate({
      routeContext: {
        matched: false,
        triggerSkill: null,
        ewankbKb: null,
        ewankbMode: null,
      },
      pageUrl: 'https://gls-uat.annto.com/#/entrustedOrderModule/expressManagement',
    }),
    'gls'
  );
});

test('kb candidate resolver returns null when neither route context nor host can infer kb', () => {
  assert.equal(
    resolveKbCandidate({
      routeContext: {
        matched: false,
        triggerSkill: null,
        ewankbKb: null,
        ewankbMode: null,
      },
      pageUrl: 'https://example.com/dashboard',
    }),
    null
  );
});

test('page feature resolver returns primary name and deduped candidates', () => {
  assert.deepEqual(
    resolvePageFeature({
      pageTitle: '快递询价',
      hashRoute: '/entrustedOrderModule/expressInquiry',
      navLabels: ['委托中心', '快递询价'],
      pageTextSummary: ['快递询价', '搜索', '快递询价'],
    }),
    {
      primaryFeatureName: '快递询价',
      featureNameCandidates: ['快递询价', '委托中心', '搜索'],
    }
  );
});

test('page feature resolver prefers route and nav feature over generic site title', () => {
  assert.deepEqual(
    resolvePageFeature({
      pageTitle: 'GLS',
      hashRoute: '/entrustedOrderModule/expressManagement',
      navLabels: ['委托中心', '快递管理'],
      pageTextSummary: ['搜索', '物流订单号', '快递单号'],
    }),
    {
      primaryFeatureName: '快递管理',
      featureNameCandidates: ['快递管理', '委托中心', 'GLS', '搜索', '物流订单号', '快递单号'],
    }
  );
});

test('page feature resolver returns null primary name on empty inputs', () => {
  assert.deepEqual(
    resolvePageFeature({
      pageTitle: null,
      hashRoute: null,
      navLabels: [],
      pageTextSummary: [],
    }),
    {
      primaryFeatureName: null,
      featureNameCandidates: [],
    }
  );
});
