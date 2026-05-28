export const SOURCE_INDEX_ATTRIBUTE = 'data-webmcp-source-index';

type ClonePageDocumentOptions = {
  targetElement?: Element | null;
};

type SourceElementMarker = {
  element: Element;
  previousValue: string | null;
};

function getSourceElements(source: Document): Element[] {
  return Array.from(source.body.querySelectorAll('*'));
}

function copyAttributes(source: Element, target: Element): void {
  for (const attribute of Array.from(target.attributes)) {
    target.removeAttribute(attribute.name);
  }

  for (const attribute of Array.from(source.attributes)) {
    if (attribute.name === SOURCE_INDEX_ATTRIBUTE) {
      continue;
    }

    target.setAttribute(attribute.name, attribute.value);
  }
}

function markSourceElements(source: Document): SourceElementMarker[] {
  return getSourceElements(source).map((element, index) => {
    const previousValue = element.getAttribute(SOURCE_INDEX_ATTRIBUTE);
    element.setAttribute(SOURCE_INDEX_ATTRIBUTE, String(index));
    return { element, previousValue };
  });
}

function restoreSourceElementMarkers(markers: SourceElementMarker[]): void {
  for (const { element, previousValue } of markers) {
    if (previousValue === null) {
      element.removeAttribute(SOURCE_INDEX_ATTRIBUTE);
    } else {
      element.setAttribute(SOURCE_INDEX_ATTRIBUTE, previousValue);
    }
  }
}

function pruneToTargetElement(clone: Document, source: Document, targetElement: Element): void {
  if (targetElement === source.body || targetElement === source.documentElement) {
    return;
  }

  const sourceElements = getSourceElements(source);
  const targetIndex = sourceElements.indexOf(targetElement);
  if (targetIndex === -1) {
    return;
  }

  const targetClone = clone.body.querySelector(`[${SOURCE_INDEX_ATTRIBUTE}="${targetIndex}"]`);
  if (!(targetClone instanceof Element)) {
    return;
  }

  let current: Element | null = targetClone;
  while (current && current !== clone.body) {
    const parent: Element | null = current.parentElement;
    if (!parent) {
      break;
    }

    for (const child of Array.from(parent.children) as Element[]) {
      if (child !== current) {
        child.remove();
      }
    }

    current = parent;
  }
}

function shouldCloneShadowNode(node: Node): boolean {
  if (node.nodeType !== Node.ELEMENT_NODE) {
    return false;
  }

  const element = node as Element;
  const tagName = element.tagName.toLowerCase();
  return tagName === 'style' || tagName === 'link' || tagName === 'micro-app-head';
}

function cloneOpenShadowStyleNodes(source: Document, clone: Document): void {
  const sourceElements = getSourceElements(source);

  for (const [index, element] of sourceElements.entries()) {
    const shadowRoot = element.shadowRoot;
    if (!shadowRoot) {
      continue;
    }

    const cloneHost = clone.body.querySelector(`[${SOURCE_INDEX_ATTRIBUTE}="${index}"]`);
    if (!(cloneHost instanceof Element)) {
      continue;
    }

    const fragment = clone.createDocumentFragment();
    for (const child of Array.from(shadowRoot.childNodes)) {
      if (!shouldCloneShadowNode(child)) {
        continue;
      }

      fragment.append(clone.importNode(child, true));
    }

    if (fragment.childNodes.length > 0) {
      cloneHost.prepend(fragment);
    }
  }
}

function cloneBodyChildNodes(source: Document, clone: Document): void {
  const fragment = clone.createDocumentFragment();
  for (const child of Array.from(source.body.childNodes)) {
    fragment.append(clone.importNode(child, true));
  }

  clone.body.replaceChildren(fragment);
}

export function clonePageDocument(
  source: Document,
  options: ClonePageDocumentOptions = {}
): Document {
  const clone = source.implementation.createHTMLDocument(source.title);
  if (clone.doctype) {
    clone.doctype.remove();
  }
  if (source.doctype) {
    clone.insertBefore(
      clone.implementation.createDocumentType(
        source.doctype.name,
        source.doctype.publicId,
        source.doctype.systemId
      ),
      clone.documentElement
    );
  }

  copyAttributes(source.documentElement, clone.documentElement);
  copyAttributes(source.body, clone.body);
  clone.head.innerHTML = source.head.innerHTML;
  const markers = markSourceElements(source);
  try {
    cloneBodyChildNodes(source, clone);
    cloneOpenShadowStyleNodes(source, clone);
  } finally {
    restoreSourceElementMarkers(markers);
  }

  if (options.targetElement) {
    pruneToTargetElement(clone, source, options.targetElement);
  }

  return clone;
}
