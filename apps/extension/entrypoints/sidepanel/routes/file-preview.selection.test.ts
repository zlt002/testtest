// @vitest-environment node

import { describe, expect, it, vi } from 'vitest';
import { clearWindowSelection } from './file-preview';

describe('clearWindowSelection', () => {
  it('removes native selection ranges when selection exists', () => {
    const removeAllRanges = vi.fn();
    Object.assign(globalThis, {
      window: {
        getSelection: () => ({
          removeAllRanges,
        }),
      },
    });

    clearWindowSelection();

    expect(removeAllRanges).toHaveBeenCalledTimes(1);
  });

  it('does nothing safely when browser selection is unavailable', () => {
    Object.assign(globalThis, {
      window: {
        getSelection: () => null,
      },
    });

    expect(() => clearWindowSelection()).not.toThrow();
  });
});
