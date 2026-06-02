import assert from 'node:assert/strict';
import test from 'node:test';
import { buildAnalysisCard } from './analysis-card-builder.ts';

test('analysis card builder formats target action and keeps key evidence fields', () => {
  assert.deepEqual(
    buildAnalysisCard({
      pageName: '快递询价',
      route: '/entrustedOrderModule/expressInquiry',
      elementText: '搜索',
      actionType: '列表查询',
      tableHeaders: ['供应商简称', '价目表名称', '起始国/地区', '目的地', '服务类型'],
      recommendedApi: '/api-miloms/guarantee/expressCostPrice/summarySearch',
      confidence: 'medium',
    }),
    {
      pageName: '快递询价',
      route: '#/entrustedOrderModule/expressInquiry',
      targetAction: '点击「搜索」',
      actionType: '列表查询',
      tableHeaders: ['供应商简称', '价目表名称', '起始国/地区', '目的地', '服务类型'],
      recommendedApi: '/api-miloms/guarantee/expressCostPrice/summarySearch',
      confidence: 'medium',
    }
  );
});

test('analysis card builder keeps low confidence and empty action text stable', () => {
  assert.deepEqual(
    buildAnalysisCard({
      pageName: null,
      route: null,
      elementText: null,
      actionType: null,
      tableHeaders: [],
      recommendedApi: null,
      confidence: 'low',
    }),
    {
      pageName: null,
      route: null,
      targetAction: null,
      actionType: null,
      tableHeaders: [],
      recommendedApi: null,
      confidence: 'low',
    }
  );
});
