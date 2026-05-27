function getAncestorPathUntilBody(element: Element, doc: Document): Element[] {
  const path: Element[] = [];
  let current: Element | null = element;

  while (current && current !== doc.body && current !== doc.documentElement) {
    path.push(current);
    current = current.parentElement;
  }

  return path.reverse();
}

function cloneBodyContents(doc: Document, fragment: DocumentFragment) {
  for (const childNode of Array.from(doc.body.childNodes)) {
    fragment.appendChild(childNode.cloneNode(true));
  }
}

export function cloneElementFragment(doc: Document, element: Element): DocumentFragment {
  const fragment = doc.createDocumentFragment();

  if (element === doc.body) {
    cloneBodyContents(doc, fragment);
    return fragment;
  }

  const path = getAncestorPathUntilBody(element, doc);

  if (!path.length) {
    fragment.appendChild(element.cloneNode(true));
    return fragment;
  }

  let rootClone: Element | null = null;
  let currentClone: Element | null = null;

  for (const ancestor of path) {
    const nextClone = ancestor.cloneNode(ancestor === element) as Element;
    if (!rootClone) {
      rootClone = nextClone;
    } else {
      currentClone?.appendChild(nextClone);
    }
    currentClone = nextClone;
  }

  if (rootClone) {
    fragment.appendChild(rootClone);
  }

  return fragment;
}

export function summarizeElementText(element: Element): string | undefined {
  const text = (element.textContent || '').replace(/\s+/g, ' ').trim();

  return text || undefined;
}
