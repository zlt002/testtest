function hasZeroSvgDimension(value: string | null): boolean {
  return value === '0' || value === '0px' || value === '0.0' || value === '0.0px';
}

function isSvgElement(element: Element): boolean {
  return element.namespaceURI === 'http://www.w3.org/2000/svg';
}

function isZeroSizedSvg(element: Element, style: CSSStyleDeclaration | null): boolean {
  if (!isSvgElement(element)) {
    return false;
  }

  const width = element.getAttribute('width');
  const height = element.getAttribute('height');
  if (hasZeroSvgDimension(width) && hasZeroSvgDimension(height)) {
    return true;
  }

  const inlineStyle = element.getAttribute('style') || '';
  if (
    /(^|;)\s*width\s*:\s*0(?:\.0)?(?:px)?\s*(;|$)/i.test(inlineStyle) &&
    /(^|;)\s*height\s*:\s*0(?:\.0)?(?:px)?\s*(;|$)/i.test(inlineStyle)
  ) {
    return true;
  }

  return style?.getPropertyValue('width') === '0px' && style?.getPropertyValue('height') === '0px';
}

function shouldPreserveHiddenStyleContainer(element: Element): boolean {
  if (element.localName === 'micro-app-head') {
    return true;
  }

  return false;
}

function shouldPreserveMicroAppHeadStyleNode(element: Element): boolean {
  if ((element.localName === 'style' || element.localName === 'link') && element.closest('micro-app-head')) {
    return true;
  }

  return false;
}

function shouldPreserveRuntimeStyleNode(element: Element): boolean {
  return element.localName === 'style' || element.localName === 'link';
}

function isElementHidden(element: Element, originalElement?: Element): boolean {
  if (
    shouldPreserveHiddenStyleContainer(element) ||
    shouldPreserveMicroAppHeadStyleNode(element) ||
    shouldPreserveRuntimeStyleNode(element)
  ) {
    return false;
  }

  if (element.hasAttribute('hidden') || element.getAttribute('aria-hidden') === 'true') {
    return true;
  }

  const style = element.getAttribute('style') || '';
  if (/(^|;)\s*display\s*:\s*none\s*(;|$)/i.test(style)) {
    return true;
  }

  if (originalElement?.ownerDocument.defaultView) {
    const computedStyle =
      originalElement.ownerDocument.defaultView.getComputedStyle(originalElement);
    if (
      computedStyle.getPropertyValue('display') === 'none' ||
      ['hidden', 'collapse'].includes(computedStyle.getPropertyValue('visibility')) ||
      isZeroSizedSvg(originalElement, computedStyle)
    ) {
      return true;
    }
  }

  if (isZeroSizedSvg(element, null)) {
    return true;
  }

  return false;
}

function hasInlineZeroOpacity(element: Element): boolean {
  const style = element.getAttribute('style') || '';
  return /(^|;)\s*opacity\s*:\s*0(?:\.0+)?\s*(?:!important\s*)?(;|$)/i.test(style);
}

function isRenderedBox(element: Element): boolean {
  const rect = element.getBoundingClientRect();
  return rect.width > 0 && rect.height > 0;
}

function isInlineStyleHidden(element: Element): boolean {
  const style = element.getAttribute('style') || '';
  return (
    /(^|;)\s*display\s*:\s*none\s*(?:!important\s*)?(;|$)/i.test(style) ||
    /(^|;)\s*visibility\s*:\s*(?:hidden|collapse)\s*(?:!important\s*)?(;|$)/i.test(style)
  );
}

function shouldRevealAnimationHiddenElement(originalElement?: Element): boolean {
  if (!originalElement?.ownerDocument.defaultView || !isRenderedBox(originalElement)) {
    return false;
  }

  const computedStyle = originalElement.ownerDocument.defaultView.getComputedStyle(originalElement);
  return (
    computedStyle.getPropertyValue('display') !== 'none' &&
    !['hidden', 'collapse'].includes(computedStyle.getPropertyValue('visibility'))
  );
}

function shouldRevealWithoutSourceMapping(element: Element): boolean {
  if (isInlineStyleHidden(element)) {
    return false;
  }

  // Detached cloned nodes have no layout box, so when source mapping is missing
  // prefer a readable static snapshot over preserving SPA animation start states.
  return Boolean(element.textContent?.trim() || element.children.length > 0);
}

function revealAnimationHiddenElement(element: Element, originalElement?: Element): void {
  if (!(element instanceof HTMLElement) || !hasInlineZeroOpacity(element)) {
    return;
  }

  if (
    shouldRevealAnimationHiddenElement(originalElement) ||
    (!originalElement && shouldRevealWithoutSourceMapping(element))
  ) {
    element.style.setProperty('opacity', '1');
  }
}

function readSourceIndex(element: Element): number | null {
  const value = element.getAttribute(SOURCE_INDEX_ATTRIBUTE);
  if (value === null || value.trim() === '') {
    return null;
  }

  const sourceIndex = Number(value);
  return Number.isInteger(sourceIndex) && sourceIndex >= 0 ? sourceIndex : null;
}

function getBodyElementPairs(
  doc: Document,
  originalDoc?: Document
): Array<{
  element: Element;
  originalElement?: Element;
}> {
  const elements = Array.from(doc.body.querySelectorAll('*'));
  if (!originalDoc) {
    return elements.map((element) => ({ element }));
  }

  const originalElements = Array.from(originalDoc.body.querySelectorAll('*'));
  return elements.map((element) => {
    const sourceIndex = readSourceIndex(element);
    return {
      element,
      originalElement: sourceIndex !== null ? originalElements[sourceIndex] : undefined,
    };
  });
}

function getRelTokens(element: Element): string[] {
  return (element.getAttribute('rel') || '')
    .split(/\s+/)
    .map((token) => token.toLowerCase())
    .filter(Boolean);
}

function isDisposableLink(element: Element): boolean {
  if (element.localName !== 'link') {
    return false;
  }

  const relTokens = getRelTokens(element);
  return relTokens.some((token) =>
    ['dns-prefetch', 'modulepreload', 'preconnect', 'prefetch', 'preload', 'prerender'].includes(
      token
    )
  );
}

function normalizeMicroAppContainers(doc: Document): void {
  for (const element of Array.from(doc.querySelectorAll('micro-app-body'))) {
    element.classList.add('is-in-micro-el');
  }
}

const DISPOSABLE_OVERLAY_SELECTORS = [
  '.feedback_tabs_main',
  '#INTELLIGENCE',
  '[data-html2canvas-ignore="true"]',
] as const;

export function removeDisposableOverlays(doc: Document): void {
  for (const selector of DISPOSABLE_OVERLAY_SELECTORS) {
    for (const element of Array.from(doc.querySelectorAll(selector))) {
      element.remove();
    }
  }
}

export function cleanupCapturedDocument(doc: Document, originalDoc?: Document): void {
  normalizeMicroAppContainers(doc);
  removeDisposableOverlays(doc);

  for (const { element, originalElement } of getBodyElementPairs(doc, originalDoc)) {
    if (isElementHidden(element, originalElement)) {
      element.remove();
      continue;
    }

    revealAnimationHiddenElement(element, originalElement);
  }

  for (const selector of ['script', 'noscript', 'meta[http-equiv="Content-Security-Policy" i]']) {
    for (const element of Array.from(doc.querySelectorAll(selector))) {
      element.remove();
    }
  }

  for (const element of Array.from(doc.querySelectorAll('link'))) {
    if (isDisposableLink(element)) {
      element.remove();
    }
  }
}
import { SOURCE_INDEX_ATTRIBUTE } from './clone';
