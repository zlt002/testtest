// @vitest-environment node

import { describe, expect, it } from 'vitest';
import { hasScrollableContentBelow } from './chat-scroll';

describe('hasScrollableContentBelow', () => {
  it('returns true when the viewport is more than the threshold above the bottom', () => {
    expect(
      hasScrollableContentBelow({
        scrollTop: 120,
        clientHeight: 400,
        scrollHeight: 700,
      })
    ).toBe(true);
  });

  it('returns false when the viewport is already near the bottom', () => {
    expect(
      hasScrollableContentBelow({
        scrollTop: 292,
        clientHeight: 400,
        scrollHeight: 700,
      })
    ).toBe(false);
  });
});
