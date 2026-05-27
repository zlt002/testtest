// @vitest-environment node

import { describe, expect, it } from 'vitest';
import {
  filePreviewDefaultViewMode,
  filePreviewSupportsRenderedPreview,
} from './file-preview.mode';

describe('file preview visual mode', () => {
  it('defaults markdown files to preview mode', () => {
    expect(filePreviewDefaultViewMode('markdown')).toBe('preview');
  });

  it('defaults html files to source mode', () => {
    expect(filePreviewDefaultViewMode('html')).toBe('source');
  });

  it('keeps plain text files in source mode by default', () => {
    expect(filePreviewDefaultViewMode('text')).toBe('source');
  });

  it('supports rendered preview for markdown and html only', () => {
    expect(filePreviewSupportsRenderedPreview('markdown')).toBe(true);
    expect(filePreviewSupportsRenderedPreview('html')).toBe(false);
    expect(filePreviewSupportsRenderedPreview('text')).toBe(false);
  });
});
