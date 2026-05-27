// @vitest-environment node

import { describe, expect, it, vi } from 'vitest';
import {
  clearPendingAnnotationHighlight,
  syncPendingAnnotationHighlight,
} from './file-preview.pending-highlight';

describe('syncPendingAnnotationHighlight', () => {
  it('sets a dedicated CSS highlight for the pending annotation range', () => {
    const set = vi.fn();
    const del = vi.fn();
    const range = { collapsed: false } as Range;

    class FakeHighlight {
      ranges: Range[];

      constructor(...ranges: Range[]) {
        this.ranges = ranges;
      }
    }

    Object.assign(globalThis, { Highlight: FakeHighlight });
    Object.assign(globalThis, {
      CSS: {
        highlights: {
          set,
          delete: del,
        },
      },
    });

    syncPendingAnnotationHighlight(range);

    expect(set).toHaveBeenCalledTimes(1);
    expect(set.mock.calls[0]?.[0]).toBe('webmcp-file-annotation-pending');
    expect(set.mock.calls[0]?.[1]).toBeInstanceOf(FakeHighlight);
    expect(del).not.toHaveBeenCalled();
  });

  it('clears the pending annotation highlight when range is empty', () => {
    const set = vi.fn();
    const del = vi.fn();
    Object.assign(globalThis, {
      CSS: {
        highlights: {
          set,
          delete: del,
        },
      },
    });

    syncPendingAnnotationHighlight(null);

    expect(set).not.toHaveBeenCalled();
    expect(del).toHaveBeenCalledWith('webmcp-file-annotation-pending');
  });
});

describe('clearPendingAnnotationHighlight', () => {
  it('removes the dedicated pending highlight key', () => {
    const del = vi.fn();
    Object.assign(globalThis, {
      CSS: {
        highlights: {
          set: vi.fn(),
          delete: del,
        },
      },
    });

    clearPendingAnnotationHighlight();

    expect(del).toHaveBeenCalledWith('webmcp-file-annotation-pending');
  });
});
