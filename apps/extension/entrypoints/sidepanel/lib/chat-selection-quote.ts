export function appendChatSelectionQuote(currentValue: string, selectedText: string) {
  const trimmedSelectedText = selectedText.trim();
  const quoteBlock = `补充上下文：\n“${trimmedSelectedText}”`;

  if (!currentValue.trim()) {
    return quoteBlock;
  }

  return `${currentValue.trimEnd()}\n\n${quoteBlock}`;
}
