// @vitest-environment node

import { describe, expect, it } from 'vitest';
import { isMarkdownImageInsertModifierActive } from './file-preview.image-insert-trigger';

describe('markdown image insert trigger', () => {
  it('uses Alt as the floating image insert modifier', () => {
    expect(isMarkdownImageInsertModifierActive({ altKey: true, ctrlKey: false }, false)).toBe(
      true
    );
    expect(isMarkdownImageInsertModifierActive({ altKey: false, ctrlKey: true }, false)).toBe(
      false
    );
  });

  it('keeps the floating insert active while Alt is pressed globally', () => {
    expect(isMarkdownImageInsertModifierActive({ altKey: false, ctrlKey: false }, true)).toBe(
      true
    );
  });
});
