// @vitest-environment node

import { describe, expect, it, vi } from 'vitest';
import type { PickedElementContext } from '@/entrypoints/lib/page-picker';
import {
  PageEvidenceSchema,
  type CaptureSessionMeta,
} from '@mcp-b/dom-analysis-contracts';
import { buildPageEvidence } from './dom-analysis-evidence';

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

const captureSessionMeta: CaptureSessionMeta = {
  sessionId: 'session-1',
  tabId: 8,
  capturedAt: 2_000,
  mode: 'interactive',
};

describe('buildPageEvidence', () => {
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
