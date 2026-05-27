const RAW_TEXT_ELEMENTS = new Set(['style', 'textarea']);
const VOID_ELEMENTS = new Set([
  'area',
  'base',
  'br',
  'col',
  'embed',
  'hr',
  'img',
  'input',
  'link',
  'meta',
  'param',
  'source',
  'track',
  'wbr',
]);

function escapeText(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function escapeAttribute(value: string): string {
  return escapeText(value).replace(/"/g, '&quot;');
}

function formatAttributes(element: Element): string {
  const attrs = Array.from(element.attributes).map((attr) => {
    return `${attr.name}="${escapeAttribute(attr.value)}"`;
  });

  return attrs.length > 0 ? ` ${attrs.join(' ')}` : '';
}

function formatRawTextElement(element: Element, depth: number): string[] {
  const indent = '  '.repeat(depth);
  const tagName = element.tagName.toLowerCase();
  const attributes = formatAttributes(element);
  const textContent = element.textContent || '';

  if (tagName === 'style') {
    return [`${indent}<${tagName}${attributes}>${textContent}</${tagName}>`];
  }

  return [`${indent}<${tagName}${attributes}>${escapeText(textContent)}</${tagName}>`];
}

function formatTextNode(node: Text, depth: number): string[] {
  const text = node.textContent || '';
  const normalized = text.replace(/\s+/g, ' ').trim();
  return normalized ? [`${'  '.repeat(depth)}${escapeText(normalized)}`] : [];
}

function formatElement(element: Element, depth: number): string[] {
  const tagName = element.tagName.toLowerCase();
  const indent = '  '.repeat(depth);
  const attributes = formatAttributes(element);

  if (RAW_TEXT_ELEMENTS.has(tagName)) {
    return formatRawTextElement(element, depth);
  }

  if (VOID_ELEMENTS.has(tagName)) {
    return [`${indent}<${tagName}${attributes}>`];
  }

  const childLines = Array.from(element.childNodes).flatMap((child) => {
    return formatNode(child, depth + 1);
  });

  if (childLines.length === 0) {
    return [`${indent}<${tagName}${attributes}></${tagName}>`];
  }

  return [`${indent}<${tagName}${attributes}>`, ...childLines, `${indent}</${tagName}>`];
}

function formatNode(node: Node, depth: number): string[] {
  if (node.nodeType === Node.ELEMENT_NODE) {
    return formatElement(node as Element, depth);
  }

  if (node.nodeType === Node.TEXT_NODE) {
    return formatTextNode(node as Text, depth);
  }

  if (node.nodeType === Node.COMMENT_NODE) {
    return [`${'  '.repeat(depth)}<!--${node.textContent || ''}-->`];
  }

  return [];
}

export function prettyPrintHtml(doc: Document): string {
  const doctype = doc.doctype
    ? `<!DOCTYPE ${doc.doctype.name}${
        doc.doctype.publicId ? ` PUBLIC "${doc.doctype.publicId}"` : ''
      }${doc.doctype.systemId ? ` "${doc.doctype.systemId}"` : ''}>`
    : '<!DOCTYPE html>';

  return `${doctype}\n${formatElement(doc.documentElement, 0).join('\n')}`;
}
