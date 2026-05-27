// @vitest-environment node

import { describe, expect, it } from 'vitest';

import { buildSnapshotManifest, type WorkbenchCaptureAsset } from './page-workbench-capture';

describe('buildSnapshotManifest', () => {
  it('includes targets and annotations in the snapshot manifest', () => {
    const manifest = buildSnapshotManifest({
      captureId: 'capture-1',
      entryPath: 'captures/capture-1',
      artifact: {
        url: 'https://example.com/article',
        title: 'Example',
        capturedAt: '2026-05-17T10:00:00.000Z',
        mode: 'element',
        html: '<html></html>',
        assets: [],
        warnings: [],
        metadata: {
          originalUrl: 'https://example.com/article',
          userAgent: 'test',
          documentTitle: 'Example',
        },
      },
      sourcePageType: 'live-page',
      parentCaptureId: 'capture-root',
      targets: [
        {
          targetId: 'target-1',
          pageUrl: 'https://example.com/article',
          pageType: 'live-page',
          createdAt: 1,
          url: 'https://example.com/article',
          selector: '#hero',
          xpath: '//*[@id="hero"]',
          tagName: 'section',
          id: 'hero',
          classList: ['hero'],
          dataAttributes: {},
          text: 'Hero',
          rect: { x: 0, y: 0, width: 200, height: 80 },
          outerHTMLSnippet: '<section id="hero">Hero</section>',
          ancestors: [{ tagName: 'main', id: null, classList: [] }],
          siblings: { previous: null, next: null },
        },
      ],
      annotations: [
        {
          annotationId: 'annotation-1',
          targetId: 'target-1',
          content: '这里要重点关注',
          createdAt: 1,
          updatedAt: 2,
          sourcePageUrl: 'https://example.com/article',
          sourcePageType: 'live-page',
          status: 'captured',
        },
      ],
    } satisfies WorkbenchCaptureAsset);

    expect(manifest).toMatchObject({
      captureId: 'capture-1',
      mode: 'element',
      sourcePageUrl: 'https://example.com/article',
      sourcePageType: 'live-page',
      capturedAt: '2026-05-17T10:00:00.000Z',
      entryPath: 'captures/capture-1',
      parentCaptureId: 'capture-root',
      targets: [{ targetId: 'target-1' }],
      annotations: [{ annotationId: 'annotation-1' }],
    });
  });
});
