// @vitest-environment node

import { describe, expect, it } from 'vitest';
import {
  countActiveAnnotations,
  formatAnnotationCountLabel,
  resolveAnnotationStatuses,
  type AnnotationStatusSource,
} from './file-preview.annotation-status';

const annotations: AnnotationStatusSource[] = [
  {
    id: 'annotation-active',
    selectedText: '员工进入报销页面',
  },
  {
    id: 'annotation-invalid',
    selectedText: '系统自动回填发票号码',
  },
];

describe('resolveAnnotationStatuses', () => {
  it('匹配到正文的标注保持有效，找不到的标注标记为已作废', () => {
    expect(resolveAnnotationStatuses(annotations, new Set(['annotation-active']))).toEqual([
      {
        id: 'annotation-active',
        selectedText: '员工进入报销页面',
        status: 'active',
      },
      {
        id: 'annotation-invalid',
        selectedText: '系统自动回填发票号码',
        status: 'invalid',
      },
    ]);
  });
});

describe('countActiveAnnotations', () => {
  it('只统计仍然有效的标注', () => {
    expect(
      countActiveAnnotations(
        resolveAnnotationStatuses(annotations, new Set(['annotation-active']))
      )
    ).toBe(1);
  });
});

describe('formatAnnotationCountLabel', () => {
  it('显示有效标注数和总标注数', () => {
    expect(formatAnnotationCountLabel(1, 3)).toBe('1/3');
  });

  it('没有标注时显示 0', () => {
    expect(formatAnnotationCountLabel(0, 0)).toBe('0');
  });
});
