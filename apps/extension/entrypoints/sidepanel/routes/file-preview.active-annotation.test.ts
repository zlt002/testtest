// @vitest-environment node

import { describe, expect, it } from 'vitest';
import { findActiveAnnotationById } from './file-preview';

const annotations = [
  {
    id: 'annotation-active',
    selectedText: '当前显示的正文',
    note: '保留这条标注',
    createdAt: '2026-05-21T08:00:00.000Z',
    updatedAt: '2026-05-21T08:00:00.000Z',
  },
  {
    id: 'annotation-invalid',
    selectedText: '已经不存在的正文',
    note: '这条标注应该失效',
    createdAt: '2026-05-21T08:00:00.000Z',
    updatedAt: '2026-05-21T08:00:00.000Z',
  },
];

describe('findActiveAnnotationById', () => {
  it('只返回当前仍然匹配正文的标注预览对象', () => {
    expect(
      findActiveAnnotationById(annotations, new Set(['annotation-active']), 'annotation-active')
    ).toEqual({
      ...annotations[0],
      status: 'active',
    });
  });

  it('对未匹配或不存在的标注返回 null', () => {
    expect(
      findActiveAnnotationById(annotations, new Set(['annotation-active']), 'annotation-invalid')
    ).toBeNull();
    expect(
      findActiveAnnotationById(annotations, new Set(['annotation-active']), 'annotation-missing')
    ).toBeNull();
  });
});
