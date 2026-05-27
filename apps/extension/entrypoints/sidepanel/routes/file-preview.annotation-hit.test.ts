// @vitest-environment node

import { describe, expect, it } from 'vitest';
import { findAnnotationIdAtPoint } from './file-preview.annotation-hit';

describe('findAnnotationIdAtPoint', () => {
  function createRangeWithRects(rects: Array<{ left: number; right: number; top: number; bottom: number }>) {
    return {
      getClientRects: () => rects,
    } as unknown as Range;
  }

  const targets = [
    {
      annotationId: 'annotation-1',
      ranges: [createRangeWithRects([{ left: 100, right: 220, top: 200, bottom: 224 }])],
    },
    {
      annotationId: 'annotation-2',
      ranges: [
        createRangeWithRects([
          { left: 240, right: 360, top: 280, bottom: 304 },
          { left: 240, right: 320, top: 306, bottom: 330 },
        ]),
      ],
    },
  ];

  it('returns the matching annotation when the point hits a rect', () => {
    expect(findAnnotationIdAtPoint(targets, { x: 180, y: 212 })).toBe('annotation-1');
    expect(findAnnotationIdAtPoint(targets, { x: 300, y: 320 })).toBe('annotation-2');
  });

  it('returns null when the point is outside every rect', () => {
    expect(findAnnotationIdAtPoint(targets, { x: 50, y: 50 })).toBeNull();
  });

  it('reads client rects at click time instead of relying on stale cached positions', () => {
    let top = 200;
    const liveRange = {
      getClientRects: () => [{ left: 100, right: 220, top, bottom: top + 24 }],
    } as unknown as Range;

    const liveTargets = [{ annotationId: 'annotation-live', ranges: [liveRange] }];

    expect(findAnnotationIdAtPoint(liveTargets, { x: 180, y: 212 })).toBe('annotation-live');

    top = 520;

    expect(findAnnotationIdAtPoint(liveTargets, { x: 180, y: 212 })).toBeNull();
    expect(findAnnotationIdAtPoint(liveTargets, { x: 180, y: 532 })).toBe('annotation-live');
  });
});
