import { cloneElementFragment } from './selection';
import type { PageCaptureMode } from './types';

function createBaseDocument(doc: Document): Document {
  const clone = doc.implementation.createHTMLDocument(doc.title);
  clone.documentElement.setAttribute('lang', doc.documentElement.getAttribute('lang') || 'en');
  clone.head.innerHTML = doc.head.innerHTML;
  clone.body.innerHTML = doc.body.innerHTML;
  return clone;
}

export function normalizeCapturedDocument(doc: Document): Document {
  const clone = createBaseDocument(doc);
  sanitizeCapturedDocument(clone);
  return clone;
}

export function sanitizeCapturedDocument(doc: Document) {
  for (const script of Array.from(doc.querySelectorAll('script'))) {
    script.remove();
  }

  for (const img of Array.from(doc.querySelectorAll('img'))) {
    if (img.getAttribute('src')) {
      continue;
    }

    const fallback = img.getAttribute('data-src') || img.getAttribute('data-original');
    if (fallback) {
      img.setAttribute('src', fallback);
    }
  }
}

export function cloneCaptureRoot(
  doc: Document,
  input: { mode: PageCaptureMode; targetElement?: Element | null }
): Document {
  const normalized = normalizeCapturedDocument(doc);

  if (input.mode === 'page') {
    return normalized;
  }

  if (!input.targetElement) {
    throw new Error('当前页面没有可采集的元素');
  }

  const normalizedTargetElement = resolveNormalizedTargetElement(doc, normalized, input.targetElement);
  if (!normalizedTargetElement) {
    throw new Error('当前页面没有可采集的元素');
  }

  if (
    normalizedTargetElement === normalized.body ||
    normalizedTargetElement === normalized.documentElement
  ) {
    return normalized;
  }

  const elementDoc = doc.implementation.createHTMLDocument(doc.title);
  elementDoc.documentElement.setAttribute(
    'lang',
    normalized.documentElement.getAttribute('lang') || 'en'
  );
  elementDoc.head.innerHTML = normalized.head.innerHTML;
  elementDoc.body.innerHTML = '';

  const fragment = cloneElementFragment(normalized, normalizedTargetElement);
  elementDoc.body.appendChild(elementDoc.importNode(fragment, true));

  return elementDoc;
}

function getElementChildPath(element: Element, doc: Document): number[] {
  const path: number[] = [];
  let current: Element | null = element;

  while (current && current !== doc.body && current !== doc.documentElement) {
    const nextParent: Element | null = current.parentElement;
    if (!nextParent) {
      break;
    }

    path.push(Array.from(nextParent.children).indexOf(current));
    current = nextParent;
  }

  return path.reverse();
}

function resolveElementByChildPath(doc: Document, path: number[]): Element | null {
  let current: Element = doc.body;

  for (const childIndex of path) {
    const next = current.children.item(childIndex);
    if (!(next instanceof Element)) {
      return null;
    }

    current = next;
  }

  return current;
}

function resolveNormalizedTargetElement(
  sourceDoc: Document,
  normalizedDoc: Document,
  targetElement: Element
): Element | null {
  if (targetElement === sourceDoc.body) {
    return normalizedDoc.body;
  }

  if (targetElement === sourceDoc.documentElement) {
    return normalizedDoc.documentElement;
  }

  return resolveElementByChildPath(normalizedDoc, getElementChildPath(targetElement, sourceDoc));
}
