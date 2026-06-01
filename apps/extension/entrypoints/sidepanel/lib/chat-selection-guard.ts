export function isNodeWithinConversationItem(container: HTMLElement, node: Node | null) {
  if (!node || !container.contains(node)) {
    return false;
  }

  const element = node.nodeType === Node.ELEMENT_NODE ? (node as Element) : node.parentElement;
  return Boolean(element?.closest('[data-chat-conversation-item="true"]'));
}

export function getActiveConversationSelection(
  container: HTMLElement | null,
  selection: Selection | null
) {
  if (!container || !selection || selection.rangeCount === 0 || selection.isCollapsed) {
    return null;
  }

  const selectedText = selection.toString().trim();
  if (!selectedText) {
    return null;
  }

  const range = selection.getRangeAt(0);
  if (
    !isNodeWithinConversationItem(container, range.startContainer) ||
    !isNodeWithinConversationItem(container, range.endContainer)
  ) {
    return null;
  }

  return selectedText;
}

export function shouldAutoScrollToLatest({
  hasContentBelow,
  hasActiveSelection,
}: {
  hasContentBelow: boolean;
  hasActiveSelection: boolean;
}) {
  return !hasContentBelow && !hasActiveSelection;
}

export type SelectionHighlightRect = {
  left: number;
  top: number;
  width: number;
  height: number;
};

export function collectViewportSelectionRects(range: Range): SelectionHighlightRect[] {
  const rectList =
    typeof range.getClientRects === 'function'
      ? Array.from(range.getClientRects())
      : typeof range.getBoundingClientRect === 'function'
        ? [range.getBoundingClientRect()]
        : [];

  return rectList
    .filter((rect) => rect.width > 0 && rect.height > 0)
    .map((rect) => ({
      left: rect.left,
      top: rect.top,
      width: rect.width,
      height: rect.height,
    }));
}

export function shouldRenderSelectionOverlayFallback(
  cssHighlights: unknown,
  HighlightCtor: unknown
) {
  return !(cssHighlights && HighlightCtor);
}
