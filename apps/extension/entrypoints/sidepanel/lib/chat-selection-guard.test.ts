import { describe, expect, it } from 'vitest';
import {
  collectViewportSelectionRects,
  getActiveConversationSelection,
  shouldRenderSelectionOverlayFallback,
  shouldAutoScrollToLatest,
} from './chat-selection-guard';

describe('getActiveConversationSelection', () => {
  it('returns the trimmed selection when both endpoints stay inside a conversation item', () => {
    const container = document.createElement('div');
    const item = document.createElement('div');
    item.dataset.chatConversationItem = 'true';
    const text = document.createTextNode('  可选中的会话内容  ');
    item.append(text);
    container.append(item);
    document.body.append(container);

    const range = document.createRange();
    range.setStart(text, 0);
    range.setEnd(text, text.textContent?.length ?? 0);

    const selection = {
      rangeCount: 1,
      isCollapsed: false,
      toString: () => '  可选中的会话内容  ',
      getRangeAt: () => range,
    } as Selection;

    expect(getActiveConversationSelection(container, selection)).toBe('可选中的会话内容');
  });

  it('returns null when the selection reaches outside the conversation item', () => {
    const container = document.createElement('div');
    const item = document.createElement('div');
    item.dataset.chatConversationItem = 'true';
    const text = document.createTextNode('会话内容');
    const outside = document.createTextNode('外部内容');
    item.append(text);
    container.append(item, outside);
    document.body.append(container);

    const range = document.createRange();
    range.setStart(text, 0);
    range.setEnd(outside, outside.textContent?.length ?? 0);

    const selection = {
      rangeCount: 1,
      isCollapsed: false,
      toString: () => '会话内容外部内容',
      getRangeAt: () => range,
    } as Selection;

    expect(getActiveConversationSelection(container, selection)).toBeNull();
  });
});

describe('shouldAutoScrollToLatest', () => {
  it('returns false while the user is selecting conversation text', () => {
    expect(
      shouldAutoScrollToLatest({
        hasContentBelow: false,
        hasActiveSelection: true,
      })
    ).toBe(false);
  });

  it('returns false when the user has scrolled away from the bottom', () => {
    expect(
      shouldAutoScrollToLatest({
        hasContentBelow: true,
        hasActiveSelection: false,
      })
    ).toBe(false);
  });

  it('returns true only when the viewport is near the bottom and no selection is active', () => {
    expect(
      shouldAutoScrollToLatest({
        hasContentBelow: false,
        hasActiveSelection: false,
      })
    ).toBe(true);
  });
});

describe('collectViewportSelectionRects', () => {
  it('collects visible client rects from the range', () => {
    const range = {
      getClientRects: () =>
        [
          { left: 10, top: 20, width: 80, height: 24 },
          { left: 12, top: 48, width: 64, height: 24 },
          { left: 0, top: 0, width: 0, height: 0 },
        ] as DOMRectList,
    } as Range;

    expect(collectViewportSelectionRects(range)).toEqual([
      { left: 10, top: 20, width: 80, height: 24 },
      { left: 12, top: 48, width: 64, height: 24 },
    ]);
  });
});

describe('shouldRenderSelectionOverlayFallback', () => {
  it('returns false when CSS highlights are available', () => {
    expect(
      shouldRenderSelectionOverlayFallback(
        { set: () => undefined, delete: () => undefined },
        function Highlight() {}
      )
    ).toBe(false);
  });

  it('returns true when CSS highlights are unavailable', () => {
    expect(shouldRenderSelectionOverlayFallback(null, function Highlight() {})).toBe(true);
    expect(
      shouldRenderSelectionOverlayFallback({ set: () => undefined, delete: () => undefined }, null)
    ).toBe(true);
  });
});
