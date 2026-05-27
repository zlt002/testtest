// @vitest-environment node

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { resolveRunFileOpenTarget } from './chat-file-open';

describe('resolveRunFileOpenTarget', () => {
  beforeEach(() => {
    vi.stubGlobal('chrome', {
      runtime: {
        getURL: vi.fn((path: string) => `extension://test${path}`),
      },
    });
  });

  it('opens html files directly in browser preview', () => {
    const target = resolveRunFileOpenTarget(
      {
        filePath: '/Users/zhanglt21/Desktop/gjwl/digital-garden.html',
        label: 'digital-garden.html',
      },
      '/Users/zhanglt21/Desktop/gjwl'
    );

    expect(target).toEqual({
      kind: 'browser-preview',
      url: 'file:///Users/zhanglt21/Desktop/gjwl/digital-garden.html',
    });
  });

  it('keeps non-html files on the sidepanel file preview route', () => {
    const target = resolveRunFileOpenTarget(
      {
        filePath: '/Users/zhanglt21/Desktop/gjwl/notes.md',
        label: 'notes.md',
      },
      '/Users/zhanglt21/Desktop/gjwl'
    );

    expect(target).toEqual({
      kind: 'sidepanel-preview',
      url: 'extension://test/sidepanel.html?route=/file-preview&projectPath=%2FUsers%2Fzhanglt21%2FDesktop%2Fgjwl&filePath=notes.md',
    });
  });
});
