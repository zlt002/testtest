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
      observedApis: ['/api-miloms/guarantee/expressCostPrice/summarySearch'],
    }),
    'gls'
  );
});

test('kb candidate resolver returns null when route context is not ewankb compatible', () => {
  assert.equal(
    resolveKbCandidate({
      routeContext: {
        matched: false,
        triggerSkill: null,
        ewankbKb: null,
        ewankbMode: null,
      },
      observedApis: [],
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
