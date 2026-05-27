// @vitest-environment node

import { describe, expect, it } from 'vitest';
import { markdownPreviewComponents, shouldRenderHighlightOverlayFallback } from './file-preview';

describe('markdownPreviewComponents', () => {
  it('reuses component mappings for the same mermaid rendering mode', () => {
    expect(markdownPreviewComponents(true)).toBe(markdownPreviewComponents(true));
    expect(markdownPreviewComponents(false)).toBe(markdownPreviewComponents(false));
  });

  it('renders tables directly without an extra scroll wrapper div', () => {
    const components = markdownPreviewComponents(true);
    const element = components.table?.({ children: '单元格' });

    expect(element).toBeTruthy();
    expect(element?.type).toBe('table');
    expect(element?.props.className).toContain('my-4');
    expect(element?.props.className).toContain('w-full');
    expect(element?.props.className).toContain('select-text');
  });

  it('uses the fixed overlay only when CSS highlights are unavailable', () => {
    expect(shouldRenderHighlightOverlayFallback({}, function Highlight() {})).toBe(false);
    expect(shouldRenderHighlightOverlayFallback(null, function Highlight() {})).toBe(true);
    expect(shouldRenderHighlightOverlayFallback({}, undefined)).toBe(true);
  });
});
