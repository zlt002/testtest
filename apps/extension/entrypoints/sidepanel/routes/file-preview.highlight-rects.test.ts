// @vitest-environment node

import { describe, expect, it } from 'vitest';
import { collectHighlightRects, collectViewportHighlightRects } from './file-preview';

describe('collectHighlightRects', () => {
  it('converts viewport rects into article-relative highlight rects', () => {
    const article = {
      getBoundingClientRect: () =>
        ({
          left: 100,
          top: 200,
        }) as DOMRect,
    } as HTMLElement;

    const ranges = [
      {
        getClientRects: () => [
          { left: 140, top: 260, right: 240, bottom: 284, width: 100, height: 24 },
          { left: 140, top: 288, right: 220, bottom: 312, width: 80, height: 24 },
        ],
      } as unknown as Range,
    ];

    expect(collectHighlightRects(article, ranges)).toEqual([
      { left: 40, top: 60, width: 100, height: 24 },
      { left: 40, top: 88, width: 80, height: 24 },
    ]);
  });

  it('recomputes rects from the latest viewport positions after scrolling', () => {
    let articleTop = 200;
    let rangeTop = 260;
    const article = {
      getBoundingClientRect: () =>
        ({
          left: 100,
          top: articleTop,
        }) as DOMRect,
    } as HTMLElement;

    const ranges = [
      {
        getClientRects: () => [
          { left: 140, top: rangeTop, right: 240, bottom: rangeTop + 24, width: 100, height: 24 },
        ],
      } as unknown as Range,
    ];

    expect(collectHighlightRects(article, ranges)).toEqual([
      { left: 40, top: 60, width: 100, height: 24 },
    ]);

    articleTop = 80;
    rangeTop = 140;

    expect(collectHighlightRects(article, ranges)).toEqual([
      { left: 40, top: 60, width: 100, height: 24 },
    ]);
  });

  it('collects viewport highlight rects without depending on article offsets', () => {
    const ranges = [
      {
        getClientRects: () => [
          { left: 140, top: 260, right: 240, bottom: 284, width: 100, height: 24 },
        ],
      } as unknown as Range,
    ];

    expect(collectViewportHighlightRects(ranges)).toEqual([
      { left: 140, top: 260, width: 100, height: 24 },
    ]);
  });
});
