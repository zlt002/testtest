// @vitest-environment jsdom

import { fireEvent, render, screen } from '@testing-library/react';
import { createRef } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { MarkdownPreview } from './file-preview';

describe('MarkdownPreview pending selection visuals', () => {
  it('captures the pending selection without immediately clearing the native browser highlight', () => {
    const onPendingSelectionChange = vi.fn();
    const onImageInsertTargetChange = vi.fn();
    const removeAllRanges = vi.fn();
    const activeAnnotationPreviewRef = createRef();
    activeAnnotationPreviewRef.current = null;
    Object.assign(globalThis, {
      CSS: {
        highlights: {
          set: vi.fn(),
          delete: vi.fn(),
        },
      },
      Highlight: class FakeHighlight {
        constructor(..._ranges: Range[]) {}
      },
    });

    render(
      <MarkdownPreview
        content="包含：Web 端 MVP、iOS / Android 端一期规划。"
        annotations={[]}
        matchedAnnotationIds={new Set()}
        projectPath="/tmp/project"
        filePath="docs/example.md"
        activeAnnotationPreviewRef={activeAnnotationPreviewRef}
        pendingHighlightRects={[]}
        onPendingSelectionChange={onPendingSelectionChange}
        onAnnotationPreviewClose={() => undefined}
        onAnnotationPreviewOpen={() => undefined}
        onImageInsertTargetChange={onImageInsertTargetChange}
        onImageInsertRequest={() => undefined}
        onResolvedAnnotationIdsChange={() => undefined}
        renderMermaid={false}
      />
    );

    const article = document.querySelector('article');
    expect(article).toBeTruthy();
    (article as HTMLElement).getBoundingClientRect = vi.fn(() => ({
      left: 40,
      top: 80,
      right: 1040,
      bottom: 880,
      width: 1000,
      height: 800,
      x: 40,
      y: 80,
      toJSON: () => ({}),
    }));
    const textNode = screen.getByText(/Web 端 MVP/).firstChild;
    expect(textNode).toBeTruthy();

    const range = document.createRange();
    range.setStart(textNode as Text, 3);
    range.setEnd(textNode as Text, 13);
    range.getBoundingClientRect = vi.fn(() => ({
      left: 100,
      top: 200,
      right: 220,
      bottom: 240,
      width: 120,
      height: 40,
      x: 100,
      y: 200,
      toJSON: () => ({}),
    }));

    vi.spyOn(window, 'getSelection').mockReturnValue({
      rangeCount: 1,
      getRangeAt: () => range,
      removeAllRanges,
      toString: () => range.toString(),
    } as unknown as Selection);

    fireEvent.mouseUp(article as HTMLElement);

    expect(onPendingSelectionChange).toHaveBeenCalledTimes(1);
    expect(onPendingSelectionChange.mock.calls[0]?.[0]?.selectedText).toBe('Web 端 MVP、');
    expect(onPendingSelectionChange.mock.calls[0]?.[0]?.highlightRects).toEqual([
      { left: 60, top: 120, width: 120, height: 40 },
    ]);
    expect(removeAllRanges).not.toHaveBeenCalled();
  });
});
