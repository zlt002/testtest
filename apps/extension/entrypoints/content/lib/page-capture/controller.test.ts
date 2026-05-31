import { beforeEach, describe, expect, it, vi } from 'vitest';
import { handlePageCaptureRequest } from './controller';

describe('page capture controller', () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
  });

  it('returns capture result for page mode', async () => {
    document.body.innerHTML = '<main><article>页面正文</article></main>';

    const result = await handlePageCaptureRequest({
      type: 'page-capture',
      mode: 'page',
      requestId: 'req-1',
    });

    expect(result.type).toBe('page-capture-result');
    expect(result.requestId).toBe('req-1');
    expect(result.success).toBe(true);

    if (result.success) {
      expect(result.artifact.html).toContain('页面正文');
      expect(result.artifact.mode).toBe('page');
    }
  });

  it('returns element capture with summary metadata', async () => {
    document.body.innerHTML = '<main><p id="target">选区正文</p><p>其余内容</p></main>';

    const result = await handlePageCaptureRequest({
      type: 'page-capture',
      mode: 'element',
      requestId: 'req-2',
      target: {
        url: 'https://example.com',
        selector: '#target',
        xpath: '//*[@id="target"]',
        tagName: 'p',
        id: 'target',
        classList: [],
        dataAttributes: {},
        text: '选区正文',
        rect: { x: 0, y: 0, width: 100, height: 20 },
        outerHTMLSnippet: '<p id="target">选区正文</p>',
        ancestors: [],
        siblings: { previous: null, next: '其余内容' },
      },
    });

    expect(result.success).toBe(true);

    if (result.success) {
      expect(result.artifact.mode).toBe('element');
      expect(result.artifact.metadata.elementSelectionSummary).toBe('选区正文');
      expect(result.artifact.html).toContain('选区正文');
      expect(result.artifact.html).not.toContain('其余内容');
    }
  });

  it('falls back to xpath when selector does not resolve', async () => {
    document.body.innerHTML = '<main><section><p id="target">XPath 兜底</p></section></main>';

    const result = await handlePageCaptureRequest({
      type: 'page-capture',
      mode: 'element',
      requestId: 'req-3',
      target: {
        url: 'https://example.com',
        selector: '#missing',
        xpath: '//*[@id="target"]',
        tagName: 'p',
        id: 'target',
        classList: [],
        dataAttributes: {},
        text: 'XPath 兜底',
        rect: { x: 0, y: 0, width: 100, height: 20 },
        outerHTMLSnippet: '<p id="target">XPath 兜底</p>',
        ancestors: [{ tagName: 'section', id: null, classList: [] }],
        siblings: { previous: null, next: null },
      },
    });

    expect(result.success).toBe(true);

    if (result.success) {
      expect(result.artifact.mode).toBe('element');
      expect(result.artifact.html).toContain('XPath 兜底');
    }
  });

  it('background stylesheet fetch 没有返回结果时，仍会返回页面采集结果', async () => {
    let messageListener: ((response: unknown) => void) | null = null;
    let disconnectListener: (() => void) | null = null;
    const port = {
      onMessage: {
        addListener: vi.fn((listener) => {
          messageListener = listener;
        }),
        removeListener: vi.fn(),
      },
      onDisconnect: {
        addListener: vi.fn((listener) => {
          disconnectListener = listener;
        }),
        removeListener: vi.fn(),
      },
      postMessage: vi.fn(() => {
        messageListener?.(undefined);
      }),
      disconnect: vi.fn(() => {
        disconnectListener?.();
      }),
    };

    vi.stubGlobal('chrome', {
      runtime: {
        connect: vi.fn(() => port),
      },
    });

    document.head.innerHTML =
      '<link rel="stylesheet" href="https://example.com/capture.css">';
    document.body.innerHTML = '<main><article>page content</article></main>';

    const result = await handlePageCaptureRequest({
      type: 'page-capture',
      mode: 'page',
      requestId: 'req-4',
    });

    expect(result.success).toBe(true);

    if (result.success) {
      expect(result.artifact.mode).toBe('page');
      expect(result.artifact.html).toContain('page content');
    }
  });
});
