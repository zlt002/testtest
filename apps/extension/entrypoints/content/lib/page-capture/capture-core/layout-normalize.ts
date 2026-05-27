const DUPLICATED_FIXED_LAYER_SELECTORS = ['.el-table__fixed', '.el-table__fixed-right'] as const;
const OVERLAY_SELECTORS = [
  '.feedback_tabs_main',
  '#INTELLIGENCE',
  '[data-html2canvas-ignore="true"]',
 ] as const;

function removeMatchedElements(doc: Document, selectors: readonly string[]): void {
  for (const selector of selectors) {
    for (const element of Array.from(doc.querySelectorAll(selector))) {
      element.remove();
    }
  }
}

function readInlinePixelWidth(element: HTMLElement): number {
  const widthValue = element.style.width.trim();
  const match = /^(-?\d+(?:\.\d+)?)px$/.exec(widthValue);
  return match ? Number(match[1]) : 0;
}

function findScrollableContentElement(container: HTMLElement): HTMLElement | null {
  const directChildren = Array.from(container.children).filter(
    (child): child is HTMLElement => child instanceof HTMLElement,
  );
  if (directChildren.length === 0) {
    return null;
  }

  let widestChild = directChildren[0];
  let widestWidth = readInlinePixelWidth(widestChild);

  for (const child of directChildren.slice(1)) {
    const childWidth = readInlinePixelWidth(child);
    if (childWidth > widestWidth) {
      widestChild = child;
      widestWidth = childWidth;
    }
  }

  return widestChild;
}

function freezeHorizontalScrollContainer(scrollContainer: HTMLElement): void {
  const rawValue = scrollContainer.getAttribute('data-capture-scroll-left');
  scrollContainer.removeAttribute('data-capture-scroll-left');

  const scrollLeft = Number(rawValue || '0');
  if (!Number.isFinite(scrollLeft) || scrollLeft === 0) {
    return;
  }

  scrollContainer.style.overflowX = 'hidden';

  const content = findScrollableContentElement(scrollContainer);
  if (!content) {
    return;
  }

  const existingMarginLeft = content.style.marginLeft.trim();
  content.style.marginLeft = existingMarginLeft
    ? `calc(${existingMarginLeft} - ${scrollLeft}px)`
    : `-${scrollLeft}px`;
}

function freezeCapturedScrollState(doc: Document): void {
  for (const element of Array.from(doc.querySelectorAll('[data-capture-scroll-left]'))) {
    if (!(element instanceof HTMLElement)) {
      continue;
    }

    freezeHorizontalScrollContainer(element);
  }
}

export function normalizeCapturedLayout(doc: Document): void {
  removeMatchedElements(doc, DUPLICATED_FIXED_LAYER_SELECTORS);
  removeMatchedElements(doc, OVERLAY_SELECTORS);
  freezeCapturedScrollState(doc);
}
