// @vitest-environment node

import { describe, expect, it } from 'vitest';
import { computeAnnotationComposerPosition } from './file-preview.annotation-position';

describe('computeAnnotationComposerPosition', () => {
  it('靠近底部时会上移，确保操作按钮不被视口裁掉', () => {
    expect(
      computeAnnotationComposerPosition({
        rect: {
          left: 900,
          width: 120,
          bottom: 1180,
        },
        viewport: {
          width: 1280,
          height: 1200,
        },
      })
    ).toEqual({
      x: 920,
      y: 860,
    });
  });

  it('靠近顶部和左侧时也会保留最小边距', () => {
    expect(
      computeAnnotationComposerPosition({
        rect: {
          left: 10,
          width: 40,
          bottom: 24,
        },
        viewport: {
          width: 1280,
          height: 1200,
        },
      })
    ).toEqual({
      x: 280,
      y: 36,
    });
  });
});
