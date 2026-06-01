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
