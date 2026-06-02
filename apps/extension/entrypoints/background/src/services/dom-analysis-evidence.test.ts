// @vitest-environment node

import { JSDOM } from 'jsdom';
import { describe, expect, it, vi } from 'vitest';
import type { PickedElementContext } from '@/entrypoints/lib/page-picker';
import {
  PageEvidenceSchema,
  type CaptureSessionMeta,
} from '@mcp-b/dom-analysis-contracts';
import { buildPageEvidence } from './dom-analysis-evidence';
import {
  extractStructuredDomSignals,
  inferStructuredActionType,
} from './dom-analysis-structured-signals';

const sampleTargetElement: PickedElementContext = {
  url: 'https://example.com/orders#/detail?id=1',
  selector: '#hero',
  xpath: '//*[@id="hero"]',
  tagName: 'section',
  id: 'hero',
  classList: ['hero', 'hero-card'],
  dataAttributes: {
    module: 'orders',
  },
  text: '订单明细',
  rect: { x: 10, y: 20, width: 200, height: 80 },
  outerHTMLSnippet: '<section id="hero">订单明细</section>',
  ancestors: [],
  siblings: { previous: null, next: null },
};

const queryButtonTargetElement: PickedElementContext = {
  ...sampleTargetElement,
  selector: 'button.search',
  xpath: '//button[@class="search"]',
  tagName: 'button',
  classList: ['search'],
  text: '搜索',
  outerHTMLSnippet: '<button class="search">搜索</button>',
};

const captureSessionMeta: CaptureSessionMeta = {
  sessionId: 'session-1',
  tabId: 8,
  capturedAt: 2_000,
  mode: 'interactive',
};

describe('buildPageEvidence', () => {
  it('extracts structured nav, form and table signals from dom fragments', () => {
    const dom = new JSDOM(`
      <!doctype html>
      <html>
        <body>
          <nav class="ant-breadcrumb">
            <span class="ant-breadcrumb-link">委托中心</span>
            <span class="ant-breadcrumb-link">快递询价</span>
          </nav>
          <section class="search-form">
            <label>客户</label>
            <label>航线</label>
            <label>状态</label>
            <label>创建人</label>
            <input placeholder="供应商简称" />
            <input placeholder="价目表名称" />
          </section>
          <table>
            <thead>
              <tr>
                <th>序号</th>
                <th>供应商简称</th>
                <th>价目表名称</th>
                <th>起始国/地区</th>
                <th>目的地</th>
                <th>服务类型</th>
                <th>操作</th>
              </tr>
            </thead>
          </table>
        </body>
      </html>
    `);

    expect(extractStructuredDomSignals(dom.window.document)).toEqual({
      navLabels: ['委托中心', '快递询价'],
      formLabels: ['客户', '航线', '状态', '创建人', '供应商简称', '价目表名称'],
      tableHeaders: ['供应商简称', '价目表名称', '起始国/地区', '目的地', '服务类型'],
    });
  });

  it('combines target element, page context and network evidence into PageEvidence', async () => {
    const result = await buildPageEvidence(
      {
        tab: {
          id: 8,
          windowId: 3,
          title: '订单详情',
          url: 'https://example.com/orders#/detail?id=1',
        },
        targetElement: sampleTargetElement,
        captureSessionMeta,
        networkWindow: {
          startTime: 1_000,
          endTime: 2_500,
        },
      },
      {
        readPageContent: vi.fn().mockResolvedValue({
          success: true,
          title: '订单详情',
          url: 'https://example.com/orders#/detail?id=1',
          text: '订单详情 页面 API 列表 查询 按钮 明细',
        }),
        collectScriptUrls: vi.fn().mockResolvedValue([
          'https://cdn.example.com/assets/orders.chunk.js',
          'https://cdn.example.com/assets/runtime.js.map',
        ]),
        collectStructuredSignals: vi.fn().mockResolvedValue({
          navLabels: ['委托中心', '快递询价'],
          formLabels: ['客户', '航线', '状态', '创建人'],
          tableHeaders: ['供应商简称', '价目表名称', '起始国/地区', '目的地', '服务类型'],
        }),
        getNetworkEvidence: vi.fn().mockReturnValue([
          {
            requestId: 'req-1',
            url: 'https://example.com/api/orders/detail?id=1',
            method: 'GET',
            status: 200,
            resourceType: 'XHR',
            startedAt: 1_500,
            finishedAt: 1_700,
            initiatorHint: 'script',
            responsePreview: null,
          },
        ]),
      }
    );

    expect(result).toEqual(
      expect.objectContaining({
        targetElement: expect.objectContaining({
          selector: '#hero',
          tagName: 'section',
        }),
        pageContext: expect.objectContaining({
          title: '订单详情',
          url: 'https://example.com/orders#/detail?id=1',
          pathname: '/orders',
          hashRoute: '/detail?id=1',
          apiCandidates: ['/api/orders/detail?id=1'],
          resourceHints: ['orders.chunk.js', 'runtime.js.map'],
          pageTextSummary: expect.arrayContaining([
            '订单详情',
            '页面',
            'api',
            '列表',
            '查询',
            '按钮',
            '明细',
            '委托中心',
            '快递询价',
            '客户',
            '航线',
            '状态',
            '创建人',
            '供应商简称',
            '价目表名称',
            '起始国/地区',
            '目的地',
            '服务类型',
          ]),
        }),
        networkEvidence: [
          expect.objectContaining({
            requestId: 'req-1',
          }),
        ],
        runtimeEvidence: {
          scriptUrls: [
            'https://cdn.example.com/assets/orders.chunk.js',
            'https://cdn.example.com/assets/runtime.js.map',
          ],
          chunkHints: ['orders.chunk.js'],
          sourceMapHints: ['runtime.js.map'],
        },
        captureSessionMeta,
      })
    );

    expect(() => PageEvidenceSchema.parse(result)).not.toThrow();
  });

  it('infers 列表查询 for search buttons when form and table areas both exist', async () => {
    const result = await buildPageEvidence(
      {
        tab: {
          id: 8,
          windowId: 3,
          title: '快递询价',
          url: 'https://example.com/express#/inquiry',
        },
        targetElement: queryButtonTargetElement,
        captureSessionMeta,
      },
      {
        readPageContent: vi.fn().mockResolvedValue({
          success: true,
          title: '快递询价',
          url: 'https://example.com/express#/inquiry',
          text: '快递询价 搜索 客户 航线 状态 供应商简称 目的地 服务类型',
        }),
        collectScriptUrls: vi.fn().mockResolvedValue([]),
        collectStructuredSignals: vi.fn().mockResolvedValue({
          navLabels: ['委托中心', '快递询价'],
          formLabels: ['客户', '航线', '状态', '创建人'],
          tableHeaders: ['供应商简称', '价目表名称', '起始国/地区', '目的地', '服务类型'],
        }),
        getNetworkEvidence: vi.fn().mockReturnValue([]),
      }
    );

    expect(
      inferStructuredActionType({
        tagName: queryButtonTargetElement.tagName,
        text: queryButtonTargetElement.text,
        hasFormContext: true,
        hasTableContext: true,
      })
    ).toBe('列表查询');
    expect(result.pageContext.pageTextSummary).toEqual(
      expect.arrayContaining([
        '委托中心',
        '快递询价',
        '客户',
        '航线',
        '状态',
        '供应商简称',
        '目的地',
        '服务类型',
        '列表查询',
      ])
    );
  });

  it('uses the default executeScript runtime path to merge structured terms into pageTextSummary', async () => {
    const executeScript = vi
      .fn()
      .mockResolvedValueOnce([
        {
          result: {
            navLabels: ['委托中心', '快递询价'],
            formLabels: ['客户', '航线', '状态', '创建人'],
            tableHeaders: ['供应商简称', '价目表名称', '起始国/地区', '目的地', '服务类型'],
          },
        },
      ]);

    vi.stubGlobal('chrome', {
      scripting: {
        executeScript,
      },
    });

    const result = await buildPageEvidence(
      {
        tab: {
          id: 8,
          windowId: 3,
          title: '快递询价',
          url: 'https://example.com/express#/inquiry',
        },
        targetElement: queryButtonTargetElement,
        captureSessionMeta,
      },
      {
        readPageContent: vi.fn().mockResolvedValue({
          success: true,
          title: '快递询价',
          url: 'https://example.com/express#/inquiry',
          text: '搜索 快递询价',
        }),
        collectScriptUrls: vi.fn().mockResolvedValue([]),
        getNetworkEvidence: vi.fn().mockReturnValue([]),
      }
    );

    expect(executeScript).toHaveBeenCalledWith({
      target: { tabId: 8 },
      func: extractStructuredDomSignals,
    });
    expect(result.pageContext.pageTextSummary).toEqual(
      expect.arrayContaining([
        '委托中心',
        '快递询价',
        '客户',
        '航线',
        '状态',
        '创建人',
        '供应商简称',
        '价目表名称',
        '起始国/地区',
        '目的地',
        '服务类型',
        '列表查询',
      ])
    );
  });

  it('falls back to empty runtime and network evidence when dependencies return nothing', async () => {
    const result = await buildPageEvidence(
      {
        tab: {
          id: 8,
          windowId: 3,
          title: '订单详情',
          url: 'https://example.com/orders',
        },
        targetElement: sampleTargetElement,
        captureSessionMeta,
      },
      {
        readPageContent: vi.fn().mockResolvedValue({
          success: true,
          title: '订单详情',
          url: 'https://example.com/orders',
          text: '',
        }),
        collectScriptUrls: vi.fn().mockResolvedValue([]),
        collectStructuredSignals: vi.fn().mockResolvedValue({
          navLabels: [],
          formLabels: [],
          tableHeaders: [],
        }),
        getNetworkEvidence: vi.fn().mockReturnValue([]),
      }
    );

    expect(result.runtimeEvidence).toEqual({
      scriptUrls: [],
      chunkHints: [],
      sourceMapHints: [],
    });
    expect(result.networkEvidence).toEqual([]);
    expect(result.interactionEvidence).toEqual([]);
  });
});
