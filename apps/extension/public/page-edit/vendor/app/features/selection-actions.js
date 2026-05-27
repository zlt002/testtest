const VISBUG_NODE_PATTERN = /^visbug-/i;
const PAGE_EDIT_UI_TAG_PATTERN = /^(vis-bug|visbug-)/i;
const MAX_TEXT_LENGTH = 120;
const MAX_HTML_LENGTH = 400;
const MAX_ANCESTOR_COUNT = 3;

function isDomElement(value) {
  return !!value && value.nodeType === 1 && typeof value.tagName === 'string';
}

function normalizeText(value) {
  return String(value || '')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizePickedText(value) {
  const text = normalizeText(value);
  return text ? text.slice(0, MAX_TEXT_LENGTH) : null;
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function escapeCssIdentifier(value) {
  const stringValue = String(value);
  const length = stringValue.length;

  if (!length) {
    return '';
  }

  let result = '';

  for (let index = 0; index < length; index += 1) {
    const codeUnit = stringValue.charCodeAt(index);
    const char = stringValue.charAt(index);

    if (codeUnit === 0x0000) {
      result += '\uFFFD';
      continue;
    }

    const shouldEscapeAsCodePoint =
      (codeUnit >= 0x0001 && codeUnit <= 0x001f) ||
      codeUnit === 0x007f ||
      (index === 0 && codeUnit >= 0x0030 && codeUnit <= 0x0039) ||
      (index === 1 &&
        codeUnit >= 0x0030 &&
        codeUnit <= 0x0039 &&
        stringValue.charCodeAt(0) === 0x002d);

    if (shouldEscapeAsCodePoint) {
      result += `\\${codeUnit.toString(16)} `;
      continue;
    }

    const isSafeIdentifierChar =
      codeUnit >= 0x0080 ||
      codeUnit === 0x002d ||
      codeUnit === 0x005f ||
      (codeUnit >= 0x0030 && codeUnit <= 0x0039) ||
      (codeUnit >= 0x0041 && codeUnit <= 0x005a) ||
      (codeUnit >= 0x0061 && codeUnit <= 0x007a);

    if (isSafeIdentifierChar) {
      result += char;
      continue;
    }

    result += `\\${char}`;
  }

  return result;
}

function escapeXPathLiteral(value) {
  const stringValue = String(value);
  if (!stringValue.includes('"')) {
    return `"${stringValue}"`;
  }

  if (!stringValue.includes("'")) {
    return `'${stringValue}'`;
  }

  const parts = stringValue.split('"');
  return `concat(${parts.map((part, index) => `${index > 0 ? ", '\"', " : ''}"${part}"`).join('')})`;
}

function normalizeFilePathFromUrl(pageUrl) {
  const filePath = decodeURIComponent(pageUrl.replace(/^file:\/\//, ''));
  return filePath.replace(/^\/([A-Za-z]:\/)/, '$1');
}

function getElementChildPath(element, root) {
  const path = [];
  let current = element;

  while (current && current !== root) {
    const parent = current.parentElement;
    if (!parent) {
      return null;
    }

    path.unshift(Array.from(parent.children).indexOf(current));
    current = parent;
  }

  return current === root ? path : null;
}

function resolveElementByChildPath(root, path) {
  let current = root;

  for (const childIndex of path) {
    current = current?.children?.[childIndex] ?? null;
    if (!current) {
      return null;
    }
  }

  return current;
}

function buildOpeningTagMatcher(element) {
  const tag = element.tagName.toLowerCase();
  const id = element.id || null;
  const classes = Array.from(element.classList);

  return (rawTag) => {
    if (!new RegExp(`^<${tag}(\\s|>)`, 'i').test(rawTag)) {
      return false;
    }

    if (id && !new RegExp(`\\bid=["']${escapeRegExp(id)}["']`, 'i').test(rawTag)) {
      return false;
    }

    if (!classes.length) {
      return true;
    }

    const classMatch = rawTag.match(/\bclass=["']([^"']*)["']/i);
    if (!classMatch) {
      return false;
    }

    const rawClasses = classMatch[1].split(/\s+/).filter(Boolean);
    return classes.every((className) => rawClasses.includes(className));
  };
}

function extractOpeningTag(html) {
  const match = html.match(/^<[^>]+>/);
  return match ? match[0] : '';
}

function haveSameClassList(left, right) {
  const leftClasses = Array.from(left.classList);
  const rightClasses = Array.from(right.classList);

  return (
    leftClasses.length === rightClasses.length &&
    leftClasses.every((className, index) => className === rightClasses[index])
  );
}

function areElementsEquivalent(liveElement, parsedElement) {
  return (
    liveElement.tagName === parsedElement.tagName &&
    liveElement.id === parsedElement.id &&
    haveSameClassList(liveElement, parsedElement) &&
    normalizeText(liveElement.textContent) === normalizeText(parsedElement.textContent)
  );
}

function findNthOpeningTagMatch(html, tagName, matcher, occurrenceIndex) {
  const openingTagPattern = new RegExp(`<${tagName}(?:"[^"]*"|'[^']*'|[^'">])*?>`, 'gi');
  let match;
  let index = 0;

  while ((match = openingTagPattern.exec(html))) {
    if (matcher(match[0])) {
      if (index === occurrenceIndex) {
        return match;
      }
      index += 1;
    }
  }

  return null;
}

function isPageEditUiTagName(tagName) {
  return PAGE_EDIT_UI_TAG_PATTERN.test(tagName);
}

function getParentElementAcrossShadowBoundary(element) {
  if (element.parentElement) {
    return element.parentElement;
  }

  const rootNode = element.getRootNode?.();
  if (rootNode && rootNode.nodeType === 11 && isDomElement(rootNode.host)) {
    return rootNode.host;
  }

  return null;
}

export function isPageEditUiElement(element) {
  if (!isDomElement(element)) {
    return false;
  }

  let current = element;
  while (isDomElement(current)) {
    if (
      isPageEditUiTagName(current.tagName) ||
      current.getAttribute?.('data-webmcp-annotation-ui') === 'true'
    ) {
      return true;
    }

    current = getParentElementAcrossShadowBoundary(current);
  }

  return false;
}

export function findSelectableParentElement(element) {
  if (!isDomElement(element) || VISBUG_NODE_PATTERN.test(element.tagName)) {
    return null;
  }

  let parent = getParentElementAcrossShadowBoundary(element);
  while (parent) {
    if (!VISBUG_NODE_PATTERN.test(parent.tagName) && !parent.closest('vis-bug')) {
      return parent;
    }
    parent = getParentElementAcrossShadowBoundary(parent);
  }

  return null;
}

export function buildElementSummary(element) {
  const tag = element.tagName.toLowerCase();
  const id = element.id ? `#${element.id}` : '';
  const classes = Array.from(element.classList)
    .slice(0, 3)
    .map((name) => `.${name}`)
    .join('');
  const text = normalizeText(element.textContent).slice(0, 40) || '(空)';

  return `${tag}${id}${classes}  文本: ${text}`;
}

export function buildCssSelector(element) {
  const parts = [];
  let current = element;

  while (isDomElement(current) && parts.length < 4) {
    let part = current.tagName.toLowerCase();

    if (current.id) {
      part = `#${escapeCssIdentifier(current.id)}`;
      parts.unshift(part);
      break;
    }

    const classes = Array.from(current.classList).slice(0, 2);
    if (classes.length) {
      part += classes.map((name) => `.${escapeCssIdentifier(name)}`).join('');
    } else if (current.parentElement) {
      const index = Array.from(current.parentElement.children).indexOf(current) + 1;
      part += `:nth-child(${index})`;
    }

    parts.unshift(part);
    current = getParentElementAcrossShadowBoundary(current);
  }

  return parts.join(' > ');
}

export function buildXPath(element) {
  if (!isDomElement(element)) {
    return null;
  }

  if (element.id) {
    return `//*[@id=${escapeXPathLiteral(element.id)}]`;
  }

  const parent = getParentElementAcrossShadowBoundary(element);
  if (!parent) {
    return `/${element.tagName.toLowerCase()}`;
  }

  const sameTagSiblings = Array.from(parent.children).filter(
    (child) => child.tagName === element.tagName
  );
  const index = sameTagSiblings.indexOf(element) + 1;

  return `${buildXPath(parent)}/${element.tagName.toLowerCase()}[${index}]`;
}

function collectDataAttributes(element) {
  return Object.fromEntries(
    Array.from(element.attributes)
      .filter((attribute) => attribute.name.startsWith('data-'))
      .map((attribute) => [attribute.name.slice(5), attribute.value])
  );
}

function collectAncestors(element) {
  const ancestors = [];
  let current = element.parentElement;

  while (current && ancestors.length < MAX_ANCESTOR_COUNT) {
    ancestors.push({
      tagName: current.tagName.toLowerCase(),
      id: current.id || null,
      classList: Array.from(current.classList).slice(0, 3),
    });
    current = current.parentElement;
  }

  return ancestors;
}

export function buildPickedElementCaptureContext(element) {
  const rect = element.getBoundingClientRect();

  return {
    url: window.location.href,
    selector: buildCssSelector(element) || null,
    xpath: buildXPath(element),
    tagName: element.tagName.toLowerCase(),
    id: element.id || null,
    classList: Array.from(element.classList),
    dataAttributes: collectDataAttributes(element),
    text: normalizePickedText(element.innerText || element.textContent),
    rect: {
      x: rect.x,
      y: rect.y,
      width: rect.width,
      height: rect.height,
    },
    outerHTMLSnippet: element.outerHTML.slice(0, MAX_HTML_LENGTH),
    ancestors: collectAncestors(element),
    siblings: {
      previous: normalizePickedText(element.previousElementSibling?.textContent),
      next: normalizePickedText(element.nextElementSibling?.textContent),
    },
  };
}

export function describeSelectedElement(element, options = {}) {
  const pageUrl = options.pageUrl || window.location.href;
  const summary = buildElementSummary(element);

  if (pageUrl.startsWith('file://')) {
    const filePath = normalizeFilePathFromUrl(pageUrl);
    const html = options.documentHtml || document.documentElement?.outerHTML || '';
    const location = tryResolveSourceLocation(element, html);
    const prefix = location
      ? `定位信息：\n文件: ${filePath}\n行: ${location.line}\n列: ${location.column}`
      : `定位信息：\n文件: ${filePath}`;

    return {
      source: 'file',
      text: `${prefix}\n元素: ${summary}`,
    };
  }

  return {
    source: 'live-page',
    text: `定位信息：\n选择器: ${buildCssSelector(element)}\n元素: ${summary}`,
  };
}

export function tryResolveSourceLocation(element, html) {
  const liveRoot = document.documentElement;
  const path = getElementChildPath(element, liveRoot);
  if (!path) {
    return null;
  }

  const parser = new window.DOMParser();
  const parsedDocument = parser.parseFromString(html, 'text/html');
  const parsedElement = resolveElementByChildPath(parsedDocument.documentElement, path);
  if (!parsedElement || !areElementsEquivalent(element, parsedElement)) {
    return null;
  }

  const tag = parsedElement.tagName.toLowerCase();
  const matcher = buildOpeningTagMatcher(parsedElement);
  const matchingElements = Array.from(parsedDocument.querySelectorAll(tag)).filter((candidate) =>
    matcher(extractOpeningTag(candidate.outerHTML))
  );
  const occurrenceIndex = matchingElements.indexOf(parsedElement);
  if (occurrenceIndex === -1) {
    return null;
  }

  const match = findNthOpeningTagMatch(html, tag, matcher, occurrenceIndex);
  if (!match || typeof match.index !== 'number') {
    return null;
  }

  const before = html.slice(0, match.index);
  const line = before.split('\n').length;
  const lastLineBreak = before.lastIndexOf('\n');
  const column = match.index - lastLineBreak;

  return { line, column };
}
