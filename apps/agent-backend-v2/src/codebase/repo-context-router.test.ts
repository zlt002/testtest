import assert from 'node:assert/strict';
import test from 'node:test';
import { createRepoContextRouter } from './repo-context-router.ts';

test('命中规则时返回页面图谱上下文', () => {
  const router = createRepoContextRouter();
  const resolution = router.resolve({
    url: 'https://an-uat.annto.com/#/distribute/receipt-mngt/list',
    pathname: '/index.html',
    hashRoute: '/distribute/receipt-mngt/list',
    pageTextSummary: ['回单管理', '监控'],
    apiCandidates: ['/api-tms/receipt/queryList'],
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

  assert.deepEqual(resolution, {
    matched: true,
    matchedRuleId: 'otp-receipt',
    businessId: 'otp',
    pageLabel: '回单管理',
    triggerSkill: '/ewankb-server-query',
    ewankbKb: 'otp',
    ewankbMode: 'graph',
    url: 'https://an-uat.annto.com/#/distribute/receipt-mngt/list',
    pathname: '/index.html',
    hashRoute: '/distribute/receipt-mngt/list',
    pageTextSummary: ['回单管理', '监控'],
    apiCandidates: ['/api-tms/receipt/queryList'],
    resourceHints: [],
    frontendGraphProjects: [
      'Users-zhanglt21-Desktop-codebase-otp-pc',
      'Users-zhanglt21-Desktop-codebase-otp-pc2',
    ],
    backendGraphProjects: [
      'Users-zhanglt21-Desktop-codebase-t-tms',
      'Users-zhanglt21-Desktop-codebase-logistics-otp',
    ],
    sharedGraphProjects: ['Users-zhanglt21-Desktop-codebase-tms-components-v3'],
  });
});

test('未命中规则时返回空图谱分组', () => {
  const router = createRepoContextRouter();
  const resolution = router.resolve({
    url: 'https://example.com/#/unknown/page',
    pathname: '/unknown',
    hashRoute: '/unknown/page',
    pageTextSummary: ['首页', '概览'],
    apiCandidates: ['/api/health'],
    resourceHints: ['logo.png'],
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

  assert.deepEqual(resolution, {
    matched: false,
    matchedRuleId: null,
    businessId: null,
    pageLabel: null,
    triggerSkill: null,
    ewankbKb: null,
    ewankbMode: null,
    url: 'https://example.com/#/unknown/page',
    pathname: '/unknown',
    hashRoute: '/unknown/page',
    pageTextSummary: ['首页', '概览'],
    apiCandidates: ['/api/health'],
    resourceHints: ['logo.png'],
    frontendGraphProjects: [],
    backendGraphProjects: [],
    sharedGraphProjects: [],
  });
});

test('非法 url 不会抛错，且仍能基于 hash 和页面信息命中规则', () => {
  const router = createRepoContextRouter();

  assert.doesNotThrow(() => {
    const resolution = router.resolve({
      url: 'not a valid url',
      hashRoute: '/distribute/receipt-mngt/list',
      pageTextSummary: ['回单管理', '监控'],
      apiCandidates: ['/api-tms/receipt/queryList'],
    });

    assert.equal(resolution.matched, true);
    assert.equal(resolution.matchedRuleId, 'otp-receipt');
    assert.equal(resolution.ewankbKb, 'otp');
    assert.equal(resolution.ewankbMode, 'graph');
    assert.deepEqual(resolution.frontendGraphProjects, [
      'Users-zhanglt21-Desktop-codebase-otp-pc',
      'Users-zhanglt21-Desktop-codebase-otp-pc2',
    ]);
  });
});

test('命中规则时会对重复的图谱项目去重', () => {
  const router = createRepoContextRouter();

  const resolution = router.resolve({
    url: 'https://an-uat.annto.com/#/distribute/receipt-mngt/list',
    hashRoute: '/distribute/receipt-mngt/list',
    pageTextSummary: ['回单管理', '监控'],
    apiCandidates: ['/api-tms/receipt/queryList'],
    pageCodebaseMappingConfig: {
      rules: [
        {
          id: 'otp-receipt',
          enabled: true,
          hostIncludes: ['an-uat.annto.com'],
          hashRouteIncludes: ['/distribute/receipt-mngt'],
          apiPrefixes: ['/api-tms/receipt/'],
          frontendGraphProjects: [
            'Users-zhanglt21-Desktop-codebase-otp-pc',
            'Users-zhanglt21-Desktop-codebase-otp-pc',
          ],
          backendGraphProjects: [
            'Users-zhanglt21-Desktop-codebase-t-tms',
            'Users-zhanglt21-Desktop-codebase-t-tms',
          ],
          sharedGraphProjects: [
            'Users-zhanglt21-Desktop-codebase-tms-components-v3',
            'Users-zhanglt21-Desktop-codebase-tms-components-v3',
          ],
        },
      ],
    },
  });

  assert.deepEqual(resolution.frontendGraphProjects, ['Users-zhanglt21-Desktop-codebase-otp-pc']);
  assert.deepEqual(resolution.backendGraphProjects, ['Users-zhanglt21-Desktop-codebase-t-tms']);
  assert.deepEqual(resolution.sharedGraphProjects, [
    'Users-zhanglt21-Desktop-codebase-tms-components-v3',
  ]);
});
