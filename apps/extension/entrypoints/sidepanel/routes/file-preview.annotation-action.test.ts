// @vitest-environment node

import { describe, expect, it } from 'vitest';
import {
  buildAnnotationDraftFromPendingSelection,
  buildPendingAnnotationSelection,
} from './file-preview.annotation-action';

describe('buildPendingAnnotationSelection', () => {
  it('maps a text selection to a floating action position', () => {
    const range = { collapsed: false } as Range;
    expect(
      buildPendingAnnotationSelection({
        selectedText: '支持输入目标名称',
        range,
        rect: {
          left: 240,
          width: 180,
          bottom: 360,
        },
        viewport: {
          width: 1280,
          height: 900,
        },
      })
    ).toEqual({
      selectedText: '支持输入目标名称',
      range,
      anchor: null,
      x: 330,
      y: 372,
    });
  });
});

describe('buildAnnotationDraftFromPendingSelection', () => {
  it('turns a pending selection into a blank annotation draft', () => {
    const range = { collapsed: false } as Range;
    expect(
      buildAnnotationDraftFromPendingSelection({
        selectedText: '支持设置每周学习频率',
        range,
        anchor: null,
        x: 320,
        y: 420,
      })
    ).toEqual({
      selectedText: '支持设置每周学习频率',
      range,
      anchor: null,
      note: '',
      x: 320,
      y: 420,
    });
  });
});
