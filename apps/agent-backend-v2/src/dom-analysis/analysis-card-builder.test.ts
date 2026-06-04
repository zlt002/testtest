import assert from 'node:assert/strict';
import test from 'node:test';
import { buildAnalysisCard, extractTableHeaders } from './analysis-card-builder.ts';

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

test('extractTableHeaders prefers table-like business columns over nav and form noise', () => {
  assert.deepEqual(
    extractTableHeaders([
      'GLS',
      '快递管理',
      '供应商简称',
      '物流订单号',
      '快递单号',
      '快递公司',
      '渠道名称',
      '发运类型',
      '服务类型',
      '收货公司',
      '收货人',
      '始发国/地区',
      '搜索',
      '物流订单号，多条运号隔开',
    ]),
    ['供应商简称', '物流订单号', '快递单号', '快递公司', '渠道名称']
  );
});

test('extractTableHeaders falls back to richer business terms when strong table headers are too sparse', () => {
  assert.deepEqual(
    extractTableHeaders([
      'GLS',
      '委托中心',
      '小包订单管理',
      '委托单管理',
      '快递管理',
      '委托单审批管理',
      '快递询价',
      'cargowise',
      '订单报价管理',
      '加价模型',
      '搜索',
      '/api-miloms/order/small/bag/header/v1/page',
    ]),
    [
      'cargowise',
      '委托中心',
      '小包订单管理',
      '委托单管理',
      '快递管理',
      '委托单审批管理',
      '快递询价',
      '订单报价管理',
    ]
  );
});
