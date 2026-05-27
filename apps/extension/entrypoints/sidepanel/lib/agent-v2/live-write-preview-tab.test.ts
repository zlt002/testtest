// @vitest-environment node

import { describe, expect, it } from 'vitest';
import {
  createLiveWritePreviewTabUpdate,
  shouldAutoOpenLiveWritePreview,
} from './live-write-preview-tab';

describe('createLiveWritePreviewTabUpdate', () => {
  it('activates an existing preview tab without reloading the same URL', () => {
    const previewUrl =
      'extension://example/sidepanel.html?route=/file-preview&projectPath=%2Ftmp%2Fapp&filePath=src%2Findex.ts';

    expect(createLiveWritePreviewTabUpdate(previewUrl, previewUrl)).toEqual({ active: true });
  });

  it('navigates the existing preview tab when the requested URL changes', () => {
    const currentUrl =
      'extension://example/sidepanel.html?route=/file-preview&projectPath=%2Ftmp%2Fapp&filePath=src%2Fold.ts';
    const nextUrl =
      'extension://example/sidepanel.html?route=/file-preview&projectPath=%2Ftmp%2Fapp&filePath=src%2Fnew.ts';

    expect(createLiveWritePreviewTabUpdate(currentUrl, nextUrl)).toEqual({
      active: true,
      url: nextUrl,
    });
  });

  it('only auto-opens once for the same live write preview while it is writing', () => {
    const openedPreviewIds = new Set<string>();

    expect(
      shouldAutoOpenLiveWritePreview(openedPreviewIds, 'tool-1:/tmp/app:a.md', 'writing', 'a.md')
    ).toBe(true);
    expect(
      shouldAutoOpenLiveWritePreview(openedPreviewIds, 'tool-1:/tmp/app:a.md', 'writing', 'a.md')
    ).toBe(false);
  });

  it('does not auto-open previews for completed or failed markdown writes', () => {
    const openedPreviewIds = new Set<string>();

    expect(
      shouldAutoOpenLiveWritePreview(openedPreviewIds, 'tool-1:/tmp/app:a.md', 'completed', 'a.md')
    ).toBe(false);
    expect(
      shouldAutoOpenLiveWritePreview(openedPreviewIds, 'tool-1:/tmp/app:a.md', 'failed', 'a.md')
    ).toBe(false);
  });

  it('does not auto-open previews for non-previewable files', () => {
    const openedPreviewIds = new Set<string>();

    expect(
      shouldAutoOpenLiveWritePreview(
        openedPreviewIds,
        'tool-1:/tmp/app:delete-element.js',
        'writing',
        'delete-element.js'
      )
    ).toBe(false);
  });

  it('auto-opens html files while AI is still writing', () => {
    const openedPreviewIds = new Set<string>();

    expect(
      shouldAutoOpenLiveWritePreview(
        openedPreviewIds,
        'tool-1:/tmp/app:index.html',
        'writing',
        'index.html'
      )
    ).toBe(true);
  });

  it('auto-opens html files after AI writing completes', () => {
    const openedPreviewIds = new Set<string>();

    expect(
      shouldAutoOpenLiveWritePreview(
        openedPreviewIds,
        'tool-1:/tmp/app:index.html',
        'completed',
        'index.html'
      )
    ).toBe(true);
  });
});
