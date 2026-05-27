// @vitest-environment node

import { describe, expect, it } from 'vitest';
import { annotationHighlightStyles } from './file-preview';

describe('annotationHighlightStyles', () => {
  it('uses supported highlight properties so saved annotations are visibly painted', () => {
    expect(annotationHighlightStyles).toContain('::highlight(webmcp-file-annotation)');
    expect(annotationHighlightStyles).toContain('background-color: rgba(250, 204, 21, 0.45)');
    expect(annotationHighlightStyles).toContain(
      'background-color: rgba(96, 165, 250, 0.30)'
    );
    expect(annotationHighlightStyles).not.toContain('background: rgba(');
  });
});
