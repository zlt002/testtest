import { SOURCE_INDEX_ATTRIBUTE } from './clone';

const RESOURCE_SELECTOR = 'img,svg,video,audio,canvas,embed,object';

type PlaceholderDimensions = {
  width: number | null;
  height: number | null;
};

function parseLength(value: string | null): number | null {
  if (!value) {
    return null;
  }

  const match = value.trim().match(/^(\d+(?:\.\d+)?)(?:px)?$/i);
  if (!match) {
    return null;
  }

  const number = Number(match[1]);
  return number > 0 ? number : null;
}

function readRenderedDimensions(element: Element): PlaceholderDimensions {
  const rect = element.getBoundingClientRect();
  const computedStyle = element.ownerDocument.defaultView?.getComputedStyle(element);

  return {
    width:
      rect.width > 0 ? rect.width : parseLength(computedStyle?.getPropertyValue('width') || null),
    height:
      rect.height > 0
        ? rect.height
        : parseLength(computedStyle?.getPropertyValue('height') || null),
  };
}

function normalizeDimension(value: number | null | undefined): number | null {
  if (!value || value <= 0) {
    return null;
  }

  return Math.round(value * 100) / 100;
}

function getDimension(
  element: Element,
  name: 'width' | 'height',
  fallback: number,
  renderedDimensions?: PlaceholderDimensions
): number {
  const rendered = normalizeDimension(renderedDimensions?.[name]);
  if (rendered) {
    return rendered;
  }

  const attr = parseLength(element.getAttribute(name));
  if (attr) {
    return attr;
  }

  const style = element.getAttribute('style') || '';
  const match = style.match(
    new RegExp(`(?:^|;)\\s*${name}\\s*:\\s*(\\d+(?:\\.\\d+)?)px\\s*(?:;|$)`, 'i')
  );
  if (match && Number(match[1]) > 0) {
    return Number(match[1]);
  }

  return fallback;
}

function setImportantStyle(element: HTMLElement, name: string, value: string): void {
  element.style.setProperty(name, value, 'important');
}

function createPlaceholder(
  doc: Document,
  source: Element,
  renderedDimensions?: PlaceholderDimensions
): HTMLElement {
  const placeholder = doc.createElement('div');
  placeholder.setAttribute('data-webmcp-placeholder', 'resource');
  placeholder.setAttribute('aria-label', `${source.tagName.toLowerCase()} placeholder`);
  placeholder.className = source.getAttribute('class') || '';
  if (source.id) {
    placeholder.id = source.id;
  }

  const width = getDimension(source, 'width', 120, renderedDimensions);
  const height = getDimension(source, 'height', 80, renderedDimensions);
  placeholder.textContent = 'X';
  setImportantStyle(placeholder, 'box-sizing', 'border-box');
  setImportantStyle(placeholder, 'display', 'inline-flex');
  setImportantStyle(placeholder, 'align-items', 'center');
  setImportantStyle(placeholder, 'justify-content', 'center');
  setImportantStyle(placeholder, 'width', `${width}px`);
  setImportantStyle(placeholder, 'height', `${height}px`);
  setImportantStyle(placeholder, 'border', '1px solid #999');
  setImportantStyle(
    placeholder,
    'background',
    'linear-gradient(45deg, transparent calc(50% - 1px), #999 calc(50% - 1px), #999 calc(50% + 1px), transparent calc(50% + 1px)), linear-gradient(-45deg, transparent calc(50% - 1px), #999 calc(50% - 1px), #999 calc(50% + 1px), transparent calc(50% + 1px))'
  );
  setImportantStyle(placeholder, 'color', '#555');
  setImportantStyle(placeholder, 'font', '12px sans-serif');
  return placeholder;
}

function isInlineSvgIcon(element: Element, renderedDimensions?: PlaceholderDimensions): boolean {
  if (element.localName !== 'svg') {
    return false;
  }

  const width = getDimension(element, 'width', 120, renderedDimensions);
  const height = getDimension(element, 'height', 80, renderedDimensions);
  return width <= 32 && height <= 32;
}

function readSourceIndex(element: Element): number | null {
  const value = element.getAttribute(SOURCE_INDEX_ATTRIBUTE);
  if (value === null || value.trim() === '') {
    return null;
  }

  const sourceIndex = Number(value);
  return Number.isInteger(sourceIndex) && sourceIndex >= 0 ? sourceIndex : null;
}

export function replaceResourceElementsWithPlaceholders(
  doc: Document,
  originalDoc?: Document
): void {
  const originalElements = originalDoc ? Array.from(originalDoc.body.querySelectorAll('*')) : [];
  for (const element of Array.from(doc.querySelectorAll(RESOURCE_SELECTOR))) {
    const sourceIndex = readSourceIndex(element);
    const originalElement = sourceIndex !== null ? originalElements[sourceIndex] : undefined;
    const renderedDimensions = originalElement
      ? readRenderedDimensions(originalElement)
      : undefined;
    if (isInlineSvgIcon(element, renderedDimensions)) {
      continue;
    }

    element.replaceWith(createPlaceholder(doc, element, renderedDimensions));
  }
}
