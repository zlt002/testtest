import { describe, expect, it } from 'vitest';
import { getWebScrapBookCapturePreset } from './capture-core/preset';
import {
  isPageCaptureRequest,
  isPageCaptureResult,
  type CaptureArtifactDraft,
  type PageCaptureResult,
} from './types';

describe('page capture types', () => {
  it('accepts page and element requests', () => {
    expect(isPageCaptureRequest({ type: 'page-capture', mode: 'page', requestId: 'req-1' })).toBe(
      true
    );
    expect(
      isPageCaptureRequest({
        type: 'page-capture',
        mode: 'element',
        requestId: 'req-2',
        target: {
          url: 'https://example.com',
          selector: '#target',
          xpath: '//*[@id="target"]',
          tagName: 'div',
          id: 'target',
          classList: [],
          dataAttributes: {},
          text: '正文',
          rect: { x: 0, y: 0, width: 1, height: 1 },
          outerHTMLSnippet: '<div id="target">正文</div>',
          ancestors: [],
          siblings: { previous: null, next: null },
        },
      })
    ).toBe(true);
  });

  it('rejects malformed requests', () => {
    expect(isPageCaptureRequest({ type: 'page-capture', mode: 'partial' })).toBe(false);
    expect(isPageCaptureRequest({ type: 'other', mode: 'page', requestId: 'req-1' })).toBe(false);
  });

  it('accepts capture success and failure results', () => {
    const successResult: PageCaptureResult = {
      type: 'page-capture-result',
      requestId: 'req-1',
      success: true,
      artifact: {
        url: 'https://example.com',
        title: 'Example',
        capturedAt: '2026-05-12T00:00:00.000Z',
        mode: 'page',
        html: '<html></html>',
        styles: [],
        assets: [],
        warnings: [],
        metadata: {
          originalUrl: 'https://example.com',
          userAgent: 'test',
          documentTitle: 'Example',
          elementSelectionSummary: '正文',
        },
      },
    };

    expect(isPageCaptureResult(successResult)).toBe(true);
    expect(
      isPageCaptureResult({
        type: 'page-capture-result',
        requestId: 'req-2',
        success: false,
        error: 'capture failed',
      })
    ).toBe(true);
  });
});

describe('webscrapbook capture-core preset and artifact shape', () => {
  it('returns the fixed no-assets folder capture preset', () => {
    const preset = getWebScrapBookCapturePreset();

    expect(preset.image).toBe('placeholder');
    expect(preset.imageBackground).toBe('placeholder');
    expect(preset.font).toBe('placeholder');
    expect(preset.mergeCssFiles).toBe(true);
    expect(preset.prettyPrint).toBe(true);
    expect(preset.removeHidden).toBe(true);
    expect(preset.script).toBe('remove');
    expect(preset.noscript).toBe('remove');
    expect(preset.saveResources).toBe(false);
    expect(preset.outputStylePath).toBe('style.css');
  });

  it('allows page capture artifacts to carry merged styles without assets', () => {
    const artifact: CaptureArtifactDraft = {
      url: 'https://example.com',
      title: 'Example',
      capturedAt: '2026-05-16T00:00:00.000Z',
      mode: 'page',
      html: '<html></html>',
      styles: [{ path: 'style.css', content: 'body{color:red;}' }],
      assets: [],
      warnings: [],
      metadata: {
        originalUrl: 'https://example.com',
        userAgent: 'test',
        documentTitle: 'Example',
      },
    };

    expect(artifact.styles[0]?.path).toBe('style.css');
    expect(artifact.assets).toEqual([]);
  });
});
