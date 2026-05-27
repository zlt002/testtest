import { readFile, stat, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

export type SourceRange = {
  startOffset: number;
  endOffset: number;
  startLine: number;
  startColumn: number;
  endLine: number;
  endColumn: number;
};

export type LocatedDomNode = {
  filePath: string;
  tagName: string;
  id: string | null;
  classList: string[];
  selector: string;
  text: string;
  outerHTMLSnippet: string;
  range: SourceRange;
  openingTagRange: SourceRange;
  ancestors?: DomNodeSummary[];
};

export type DomNodeSummary = {
  tagName: string;
  id: string | null;
  classList: string[];
  selector: string;
  text: string;
  range: SourceRange;
  openingTagRange: SourceRange;
};

export type CssRuleMatch = {
  filePath: string;
  selector: string;
  selectors: string[];
  declarations: Record<string, string>;
  range: SourceRange;
  bodyRange: SourceRange;
};

type LineIndex = {
  starts: number[];
};

type HtmlNodeIndex = {
  filePath: string;
  content: string;
  lineIndex: LineIndex;
  nodes: IndexedHtmlNode[];
  links: string[];
};

type IndexedHtmlNode = {
  tagName: string;
  attributes: Array<{ name: string; value: string | null }>;
  startOffset: number;
  openingEndOffset: number;
  closingStartOffset: number;
  endOffset: number;
};

type CssIndex = {
  filePath: string;
  content: string;
  lineIndex: LineIndex;
  rules: IndexedCssRule[];
};

type IndexedCssRule = {
  selector: string;
  selectors: string[];
  declarations: Record<string, string>;
  startOffset: number;
  bodyStartOffset: number;
  bodyEndOffset: number;
  endOffset: number;
};

type CacheEntry<T> = {
  mtimeMs: number;
  size: number;
  value: T;
};

type SetAttributesOperation = {
  type: 'setAttributes';
  attributes: Record<string, string | null>;
};

type RemoveNodeOperation = {
  type: 'removeNode';
};

type RemoveNodesBySelectorOperation = {
  type: 'removeNodesBySelector';
  selector: string;
  scopeRange?: SourceRange;
};

type RemoveSimilarNodesOperation = {
  type: 'removeSimilarNodes';
  matchMode?: 'sameSelector' | 'sameTagAndClasses' | 'sameStructure';
  scopeRange?: SourceRange;
};

type ReplaceInnerHtmlOperation = {
  type: 'replaceInnerHtml';
  html: string;
};

type ReplaceTextOperation = {
  type: 'replaceText';
  text: string;
};

type HtmlPatchOperation =
  | SetAttributesOperation
  | RemoveNodeOperation
  | RemoveNodesBySelectorOperation
  | RemoveSimilarNodesOperation
  | ReplaceInnerHtmlOperation
  | ReplaceTextOperation;

const VOID_TAGS = new Set([
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

function createLineIndex(content: string): LineIndex {
  const starts = [0];
  for (let index = 0; index < content.length; index += 1) {
    if (content[index] === '\n') {
      starts.push(index + 1);
    }
  }
  return { starts };
}

export function lineColumnToOffset(content: string, line: number, column: number): number {
  const index = createLineIndex(content);
  const lineStart = index.starts[Math.max(0, line - 1)];
  if (lineStart === undefined) {
    throw new Error(`Line ${line} is outside the file`);
  }
  return Math.min(content.length, lineStart + Math.max(0, column - 1));
}

function offsetToLineColumn(index: LineIndex, offset: number) {
  let low = 0;
  let high = index.starts.length - 1;
  while (low <= high) {
    const mid = Math.floor((low + high) / 2);
    if (index.starts[mid] <= offset) {
      low = mid + 1;
    } else {
      high = mid - 1;
    }
  }
  const lineIndex = Math.max(0, high);
  return {
    line: lineIndex + 1,
    column: offset - index.starts[lineIndex] + 1,
  };
}

function toSourceRange(lineIndex: LineIndex, startOffset: number, endOffset: number): SourceRange {
  const start = offsetToLineColumn(lineIndex, startOffset);
  const end = offsetToLineColumn(lineIndex, endOffset);
  return {
    startOffset,
    endOffset,
    startLine: start.line,
    startColumn: start.column,
    endLine: end.line,
    endColumn: end.column,
  };
}

function parseAttributes(openingTag: string): Array<{ name: string; value: string | null }> {
  const tagMatch = openingTag.match(/^<\s*[\w:-]+/);
  const attributesSource = openingTag
    .slice(tagMatch ? tagMatch[0].length : 0)
    .replace(/\/?\s*>$/, '');
  const attributes: Array<{ name: string; value: string | null }> = [];
  const attrPattern = /([\w:.-]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;
  let match = attrPattern.exec(attributesSource);
  while (match) {
    attributes.push({
      name: match[1],
      value: match[2] ?? match[3] ?? match[4] ?? null,
    });
    match = attrPattern.exec(attributesSource);
  }
  return attributes;
}

function getAttribute(node: Pick<IndexedHtmlNode, 'attributes'>, name: string): string | null {
  return node.attributes.find((attribute) => attribute.name.toLowerCase() === name)?.value ?? null;
}

function getClassList(node: Pick<IndexedHtmlNode, 'attributes'>): string[] {
  return (getAttribute(node, 'class') || '').split(/\s+/).filter(Boolean);
}

function buildSelector(node: Pick<IndexedHtmlNode, 'tagName' | 'attributes'>): string {
  const id = getAttribute(node, 'id');
  const classList = getClassList(node);
  return `${node.tagName}${id ? `#${cssEscapeIdent(id)}` : ''}${classList
    .map((className) => `.${cssEscapeIdent(className)}`)
    .join('')}`;
}

function cssEscapeIdent(value: string): string {
  return value.replace(/([!"#$%&'()*+,./:;<=>?@[\\\]^`{|}~])/g, '\\$1');
}

function normalizeTagName(value: string): string {
  return value.toLowerCase();
}

function parseHtmlIndex(filePath: string, content: string): HtmlNodeIndex {
  const lineIndex = createLineIndex(content);
  const nodes: IndexedHtmlNode[] = [];
  const links: string[] = [];
  const stack: IndexedHtmlNode[] = [];
  const tagPattern = /<!--[\s\S]*?-->|<![^>]*>|<\/?\s*([a-zA-Z][\w:-]*)([^>]*)>/g;
  let match = tagPattern.exec(content);

  while (match) {
    const fullTag = match[0];
    const tagName = match[1] ? normalizeTagName(match[1]) : '';
    if (!tagName || fullTag.startsWith('<!')) {
      match = tagPattern.exec(content);
      continue;
    }

    if (fullTag.startsWith('</')) {
      for (let index = stack.length - 1; index >= 0; index -= 1) {
        const candidate = stack[index];
        if (candidate.tagName !== tagName) {
          continue;
        }
        candidate.closingStartOffset = match.index;
        candidate.endOffset = tagPattern.lastIndex;
        nodes.push(candidate);
        stack.splice(index);
        break;
      }
      match = tagPattern.exec(content);
      continue;
    }

    const attributes = parseAttributes(fullTag);
    const node: IndexedHtmlNode = {
      tagName,
      attributes,
      startOffset: match.index,
      openingEndOffset: tagPattern.lastIndex,
      closingStartOffset: tagPattern.lastIndex,
      endOffset: tagPattern.lastIndex,
    };

    if (tagName === 'link' && (getAttribute(node, 'rel') || '').toLowerCase() === 'stylesheet') {
      const href = getAttribute(node, 'href');
      if (href && !/^[a-z][a-z0-9+.-]*:/i.test(href)) {
        links.push(resolve(dirname(filePath), href));
      }
    }

    if (fullTag.endsWith('/>') || VOID_TAGS.has(tagName)) {
      nodes.push(node);
    } else {
      stack.push(node);
    }
    match = tagPattern.exec(content);
  }

  for (const node of stack.reverse()) {
    node.closingStartOffset = content.length;
    node.endOffset = content.length;
    nodes.push(node);
  }

  return { filePath, content, lineIndex, nodes, links };
}

function parseCssDeclarations(body: string): Record<string, string> {
  const declarations: Record<string, string> = {};
  for (const part of body.split(';')) {
    const colonIndex = part.indexOf(':');
    if (colonIndex === -1) {
      continue;
    }
    const name = part.slice(0, colonIndex).trim();
    const value = part.slice(colonIndex + 1).trim();
    if (name && value) {
      declarations[name] = value;
    }
  }
  return declarations;
}

function parseCssIndex(filePath: string, content: string): CssIndex {
  const lineIndex = createLineIndex(content);
  const rules: IndexedCssRule[] = [];
  const rulePattern = /([^{}@][^{}]*)\{([^{}]*)\}/g;
  let match = rulePattern.exec(content);
  while (match) {
    const selector = match[1].trim();
    if (!selector) {
      match = rulePattern.exec(content);
      continue;
    }
    const leadingWhitespace = match[1].match(/^\s*/)?.[0].length ?? 0;
    const selectorStartOffset = match.index + leadingWhitespace;
    const bodyStartOffset = match.index + match[0].indexOf('{') + 1;
    const bodyEndOffset = rulePattern.lastIndex - 1;
    rules.push({
      selector,
      selectors: selector
        .split(',')
        .map((part) => part.trim())
        .filter(Boolean),
      declarations: parseCssDeclarations(match[2]),
      startOffset: selectorStartOffset,
      bodyStartOffset,
      bodyEndOffset,
      endOffset: rulePattern.lastIndex,
    });
    match = rulePattern.exec(content);
  }
  return { filePath, content, lineIndex, rules };
}

function parseCompoundSelector(selector: string) {
  const cleanSelector =
    selector
      .trim()
      .split(/\s+|>|\+|~/)
      .pop() || selector.trim();
  const tagMatch = cleanSelector.match(/^[a-zA-Z][\w:-]*/);
  const idMatch = cleanSelector.match(/#([\w:-]+)/);
  const classList = [...cleanSelector.matchAll(/\.([\w:-]+)/g)].map((match) => match[1]);
  return {
    tagName: tagMatch ? normalizeTagName(tagMatch[0]) : null,
    id: idMatch?.[1] ?? null,
    classList,
  };
}

function selectorMatchesNode(
  selector: string,
  node: Pick<IndexedHtmlNode, 'tagName' | 'attributes'>
) {
  const parsed = parseCompoundSelector(selector);
  if (parsed.tagName && parsed.tagName !== node.tagName) {
    return false;
  }
  if (parsed.id && parsed.id !== getAttribute(node, 'id')) {
    return false;
  }
  const nodeClasses = new Set(getClassList(node));
  return parsed.classList.every((className) => nodeClasses.has(className));
}

function htmlText(content: string): string {
  return content
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function escapeHtmlAttribute(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/"/g, '&quot;');
}

async function readCached<T>(
  filePath: string,
  cache: Map<string, CacheEntry<T>>,
  create: (filePath: string, content: string) => T
): Promise<T> {
  const resolvedPath = resolve(filePath);
  const fileStat = await stat(resolvedPath);
  const cached = cache.get(resolvedPath);
  if (cached && cached.mtimeMs === fileStat.mtimeMs && cached.size === fileStat.size) {
    return cached.value;
  }

  const content = await readFile(resolvedPath, 'utf8');
  const value = create(resolvedPath, content);
  cache.set(resolvedPath, { mtimeMs: fileStat.mtimeMs, size: fileStat.size, value });
  return value;
}

function materializeLocatedNode(index: HtmlNodeIndex, node: IndexedHtmlNode): LocatedDomNode {
  const outerHTML = index.content.slice(node.startOffset, node.endOffset);
  return {
    filePath: index.filePath,
    tagName: node.tagName,
    id: getAttribute(node, 'id'),
    classList: getClassList(node),
    selector: buildSelector(node),
    text: htmlText(outerHTML),
    outerHTMLSnippet: outerHTML.slice(0, 1_000),
    range: toSourceRange(index.lineIndex, node.startOffset, node.endOffset),
    openingTagRange: toSourceRange(index.lineIndex, node.startOffset, node.openingEndOffset),
  };
}

function materializeNodeSummary(index: HtmlNodeIndex, node: IndexedHtmlNode): DomNodeSummary {
  const outerHTML = index.content.slice(node.startOffset, node.endOffset);
  return {
    tagName: node.tagName,
    id: getAttribute(node, 'id'),
    classList: getClassList(node),
    selector: buildSelector(node),
    text: htmlText(outerHTML).slice(0, 240),
    range: toSourceRange(index.lineIndex, node.startOffset, node.endOffset),
    openingTagRange: toSourceRange(index.lineIndex, node.startOffset, node.openingEndOffset),
  };
}

function materializeCssRule(index: CssIndex, rule: IndexedCssRule): CssRuleMatch {
  return {
    filePath: index.filePath,
    selector: rule.selector,
    selectors: rule.selectors,
    declarations: rule.declarations,
    range: toSourceRange(index.lineIndex, rule.startOffset, rule.endOffset),
    bodyRange: toSourceRange(index.lineIndex, rule.bodyStartOffset, rule.bodyEndOffset),
  };
}

function nodeContainsRange(node: IndexedHtmlNode, range: SourceRange) {
  return node.startOffset <= range.startOffset && node.endOffset >= range.endOffset;
}

function findNodeForRange(index: HtmlNodeIndex, range: SourceRange) {
  return (
    index.nodes
      .filter((node) => nodeContainsRange(node, range))
      .sort(
        (left, right) => left.endOffset - left.startOffset - (right.endOffset - right.startOffset)
      )[0] ?? null
  );
}

function isWithinScope(node: IndexedHtmlNode, scopeRange?: SourceRange) {
  if (!scopeRange) {
    return true;
  }
  return node.startOffset >= scopeRange.startOffset && node.endOffset <= scopeRange.endOffset;
}

function compactRemovalNodes(nodes: IndexedHtmlNode[]) {
  const sorted = [...nodes].sort((left, right) => {
    if (left.startOffset !== right.startOffset) {
      return left.startOffset - right.startOffset;
    }
    return right.endOffset - left.endOffset;
  });
  const kept: IndexedHtmlNode[] = [];
  for (const node of sorted) {
    const covered = kept.some(
      (candidate) =>
        candidate.startOffset <= node.startOffset && candidate.endOffset >= node.endOffset
    );
    if (!covered) {
      kept.push(node);
    }
  }
  return kept;
}

async function writeHtmlContent(filePath: string, nextContent: string) {
  await writeFile(filePath, nextContent, 'utf8');
  return createLineIndex(nextContent);
}

export function createSnapshotEditService() {
  const htmlCache = new Map<string, CacheEntry<HtmlNodeIndex>>();
  const cssCache = new Map<string, CacheEntry<CssIndex>>();

  async function getHtmlIndex(filePath: string) {
    return readCached(filePath, htmlCache, parseHtmlIndex);
  }

  async function getCssIndex(filePath: string) {
    return readCached(filePath, cssCache, parseCssIndex);
  }

  function invalidate(filePath: string) {
    const resolvedPath = resolve(filePath);
    htmlCache.delete(resolvedPath);
    cssCache.delete(resolvedPath);
  }

  async function setAttributes(input: {
    filePath: string;
    range: SourceRange;
    operation: SetAttributesOperation;
  }) {
    const filePath = resolve(input.filePath);
    const content = await readFile(filePath, 'utf8');
    const snippet = content.slice(input.range.startOffset, input.range.endOffset);
    const openTagMatch = snippet.match(/^<\s*([a-zA-Z][\w:-]*)([^>]*)>/);
    if (!openTagMatch) {
      throw new Error('The provided range does not start with an HTML element');
    }

    const tagName = openTagMatch[1];
    const originalOpeningTag = openTagMatch[0];
    const attributes = parseAttributes(originalOpeningTag);
    const nextAttributes = [...attributes];
    for (const [name, value] of Object.entries(input.operation.attributes)) {
      const existing = nextAttributes.find(
        (attribute) => attribute.name.toLowerCase() === name.toLowerCase()
      );
      if (value === null) {
        const index = existing ? nextAttributes.indexOf(existing) : -1;
        if (index >= 0) {
          nextAttributes.splice(index, 1);
        }
      } else if (existing) {
        existing.value = value;
      } else {
        nextAttributes.push({ name, value });
      }
    }

    const nextOpeningTag = `<${tagName}${nextAttributes
      .map((attribute) =>
        attribute.value === null
          ? ` ${attribute.name}`
          : ` ${attribute.name}="${escapeHtmlAttribute(attribute.value)}"`
      )
      .join('')}>`;
    const nextContent =
      content.slice(0, input.range.startOffset) +
      nextOpeningTag +
      snippet.slice(originalOpeningTag.length) +
      content.slice(input.range.endOffset);
    await writeHtmlContent(filePath, nextContent);
    invalidate(filePath);
    const lineIndex = createLineIndex(nextContent);
    return {
      changed: nextContent !== content,
      removedCount: 0,
      range: toSourceRange(
        lineIndex,
        input.range.startOffset,
        input.range.startOffset + nextOpeningTag.length
      ),
    };
  }

  async function removeNodes(filePath: string, nodes: IndexedHtmlNode[]) {
    const resolvedPath = resolve(filePath);
    const content = await readFile(resolvedPath, 'utf8');
    const targets = compactRemovalNodes(nodes);
    let nextContent = content;
    for (const node of [...targets].sort((left, right) => right.startOffset - left.startOffset)) {
      nextContent = nextContent.slice(0, node.startOffset) + nextContent.slice(node.endOffset);
    }
    await writeHtmlContent(resolvedPath, nextContent);
    invalidate(resolvedPath);
    const lineIndex = createLineIndex(nextContent);
    return {
      changed: nextContent !== content,
      removedCount: targets.length,
      range:
        targets.length > 0
          ? toSourceRange(lineIndex, targets[0].startOffset, targets[0].startOffset)
          : null,
    };
  }

  async function replaceNodeInnerHtml(input: {
    filePath: string;
    range: SourceRange;
    html: string;
  }) {
    const resolvedPath = resolve(input.filePath);
    const index = await getHtmlIndex(resolvedPath);
    const node = findNodeForRange(index, input.range);
    if (!node) {
      throw new Error('No HTML element found for the provided range');
    }
    const nextContent =
      index.content.slice(0, node.openingEndOffset) +
      input.html +
      index.content.slice(node.closingStartOffset);
    await writeHtmlContent(resolvedPath, nextContent);
    invalidate(resolvedPath);
    const lineIndex = createLineIndex(nextContent);
    return {
      changed: nextContent !== index.content,
      removedCount: 0,
      range: toSourceRange(
        lineIndex,
        node.openingEndOffset,
        node.openingEndOffset + input.html.length
      ),
    };
  }

  async function replaceNodeText(input: {
    filePath: string;
    range: SourceRange;
    text: string;
  }) {
    const resolvedPath = resolve(input.filePath);
    const index = await getHtmlIndex(resolvedPath);
    const node = findNodeForRange(index, input.range);
    if (!node) {
      throw new Error('No HTML element found for the provided range');
    }
    const innerHtml = index.content.slice(node.openingEndOffset, node.closingStartOffset);
    if (/<[a-zA-Z!/]/.test(innerHtml)) {
      throw new Error('replaceText currently supports only text-only elements');
    }
    const nextContent =
      index.content.slice(0, node.openingEndOffset) +
      input.text +
      index.content.slice(node.closingStartOffset);
    await writeHtmlContent(resolvedPath, nextContent);
    invalidate(resolvedPath);
    const lineIndex = createLineIndex(nextContent);
    return {
      changed: nextContent !== index.content,
      removedCount: 0,
      range: toSourceRange(
        lineIndex,
        node.openingEndOffset,
        node.openingEndOffset + input.text.length
      ),
    };
  }

  return {
    async locateDom(input: {
      filePath: string;
      line: number;
      column: number;
      ancestorLimit?: number;
    }): Promise<LocatedDomNode> {
      const index = await getHtmlIndex(input.filePath);
      const offset = lineColumnToOffset(index.content, input.line, input.column);
      const candidates = index.nodes
        .filter((node) => node.startOffset <= offset && offset <= node.endOffset)
        .sort(
          (left, right) => left.endOffset - left.startOffset - (right.endOffset - right.startOffset)
        );
      const node = candidates[0];
      if (!node) {
        throw new Error(`No DOM element found at ${input.filePath}:${input.line}:${input.column}`);
      }
      const ancestorLimit = Math.max(0, Math.min(input.ancestorLimit ?? 6, 20));
      const located = materializeLocatedNode(index, node);
      located.ancestors = candidates
        .filter((candidate) => candidate !== node)
        .slice(0, ancestorLimit)
        .map((candidate) => materializeNodeSummary(index, candidate));
      return located;
    },

    async findCss(input: {
      htmlPath: string;
      selector: string;
    }): Promise<{ rules: CssRuleMatch[] }> {
      const htmlIndex = await getHtmlIndex(input.htmlPath);
      const target = parseCompoundSelector(input.selector);
      const node: Pick<IndexedHtmlNode, 'tagName' | 'attributes'> = {
        tagName: target.tagName || 'div',
        attributes: [
          ...(target.id ? [{ name: 'id', value: target.id }] : []),
          ...(target.classList.length
            ? [{ name: 'class', value: target.classList.join(' ') }]
            : []),
        ],
      };
      const rules: CssRuleMatch[] = [];
      for (const cssPath of htmlIndex.links) {
        const cssIndex = await getCssIndex(cssPath);
        for (const rule of cssIndex.rules) {
          if (rule.selectors.some((selector) => selectorMatchesNode(selector, node))) {
            rules.push(materializeCssRule(cssIndex, rule));
          }
        }
      }
      return { rules };
    },

    async patchCss(input: {
      htmlPath: string;
      selector: string;
      declarations: Record<string, string>;
    }): Promise<{ updatedRules: CssRuleMatch[]; createdRule: boolean; filePath: string }> {
      const htmlIndex = await getHtmlIndex(input.htmlPath);
      const cssPath = htmlIndex.links[0] || resolve(dirname(input.htmlPath), 'style.css');
      let cssIndex = await getCssIndex(cssPath);
      const exactRule = cssIndex.rules.find((rule) =>
        rule.selectors.some((selector) => selector === input.selector)
      );

      if (!exactRule) {
        const appendText = `${cssIndex.content.endsWith('\n') ? '' : '\n'}\n${input.selector} {\n${Object.entries(
          input.declarations
        )
          .map(([name, value]) => `  ${name}: ${value};`)
          .join('\n')}\n}\n`;
        await writeFile(cssPath, cssIndex.content + appendText, 'utf8');
        invalidate(cssPath);
        cssIndex = await getCssIndex(cssPath);
        const created = cssIndex.rules.find((rule) => rule.selector === input.selector);
        return {
          updatedRules: created ? [materializeCssRule(cssIndex, created)] : [],
          createdRule: true,
          filePath: cssPath,
        };
      }

      const nextDeclarations = { ...exactRule.declarations, ...input.declarations };
      const nextRule = `${exactRule.selector} {\n${Object.entries(nextDeclarations)
        .map(([name, value]) => `  ${name}: ${value};`)
        .join('\n')}\n}`;
      const nextContent =
        cssIndex.content.slice(0, exactRule.startOffset) +
        nextRule +
        cssIndex.content.slice(exactRule.endOffset);
      await writeFile(cssPath, nextContent, 'utf8');
      invalidate(cssPath);
      const nextIndex = await getCssIndex(cssPath);
      const updated = nextIndex.rules.find((rule) => rule.selector === exactRule.selector);
      return {
        updatedRules: updated ? [materializeCssRule(nextIndex, updated)] : [],
        createdRule: false,
        filePath: cssPath,
      };
    },

    async patchCssBatch(input: {
      htmlPath: string;
      rules: Array<{ selector: string; declarations: Record<string, string> }>;
    }): Promise<{
      updatedRules: CssRuleMatch[];
      createdRules: CssRuleMatch[];
      filePath: string;
    }> {
      const htmlIndex = await getHtmlIndex(input.htmlPath);
      const cssPath = htmlIndex.links[0] || resolve(dirname(input.htmlPath), 'style.css');
      const cssIndex = await getCssIndex(cssPath);
      const requestedRules = input.rules.filter((rule) => rule.selector.trim());
      const replacements: Array<{ startOffset: number; endOffset: number; text: string }> = [];
      const createdSelectors: string[] = [];
      const updatedSelectors: string[] = [];
      const appendRules: string[] = [];

      for (const requested of requestedRules) {
        const selector = requested.selector.trim();
        const exactRule = cssIndex.rules.find(
          (rule) => rule.selector === selector || rule.selectors.some((part) => part === selector)
        );

        if (!exactRule) {
          createdSelectors.push(selector);
          appendRules.push(
            `${selector} {\n${Object.entries(requested.declarations)
              .map(([name, value]) => `  ${name}: ${value};`)
              .join('\n')}\n}`
          );
          continue;
        }

        updatedSelectors.push(exactRule.selector);
        const nextDeclarations = { ...exactRule.declarations, ...requested.declarations };
        replacements.push({
          startOffset: exactRule.startOffset,
          endOffset: exactRule.endOffset,
          text: `${exactRule.selector} {\n${Object.entries(nextDeclarations)
            .map(([name, value]) => `  ${name}: ${value};`)
            .join('\n')}\n}`,
        });
      }

      let nextContent = cssIndex.content;
      for (const replacement of replacements.sort(
        (left, right) => right.startOffset - left.startOffset
      )) {
        nextContent =
          nextContent.slice(0, replacement.startOffset) +
          replacement.text +
          nextContent.slice(replacement.endOffset);
      }
      if (appendRules.length) {
        nextContent += `${nextContent.endsWith('\n') ? '' : '\n'}\n${appendRules.join('\n\n')}\n`;
      }

      await writeFile(cssPath, nextContent, 'utf8');
      invalidate(cssPath);
      const nextIndex = await getCssIndex(cssPath);
      return {
        updatedRules: nextIndex.rules
          .filter((rule) => updatedSelectors.includes(rule.selector))
          .map((rule) => materializeCssRule(nextIndex, rule)),
        createdRules: nextIndex.rules
          .filter((rule) => createdSelectors.includes(rule.selector))
          .map((rule) => materializeCssRule(nextIndex, rule)),
        filePath: cssPath,
      };
    },

    async removeNode(input: { filePath: string; range: SourceRange }) {
      const index = await getHtmlIndex(input.filePath);
      const node = findNodeForRange(index, input.range);
      if (!node) {
        throw new Error('No HTML element found for the provided range');
      }
      return removeNodes(input.filePath, [node]);
    },

    async removeNodesBySelector(input: {
      filePath: string;
      selector: string;
      scopeRange?: SourceRange;
    }) {
      const index = await getHtmlIndex(input.filePath);
      const matchedNodes = index.nodes.filter(
        (node) => isWithinScope(node, input.scopeRange) && selectorMatchesNode(input.selector, node)
      );
      return removeNodes(input.filePath, matchedNodes);
    },

    async removeSimilarNodes(input: {
      filePath: string;
      range: SourceRange;
      matchMode?: 'sameSelector' | 'sameTagAndClasses' | 'sameStructure';
      scopeRange?: SourceRange;
    }) {
      const index = await getHtmlIndex(input.filePath);
      const anchorNode = findNodeForRange(index, input.range);
      if (!anchorNode) {
        throw new Error('No HTML element found for the provided range');
      }
      const anchorSelector = buildSelector(anchorNode);
      const anchorClasses = new Set(getClassList(anchorNode));
      const anchorChildTags = index.nodes
        .filter(
          (candidate) =>
            candidate.startOffset >= anchorNode.openingEndOffset &&
            candidate.endOffset <= anchorNode.closingStartOffset
        )
        .map((candidate) => candidate.tagName)
        .join('|');

      const matchMode = input.matchMode ?? 'sameTagAndClasses';
      const matchedNodes = index.nodes.filter((node) => {
        if (!isWithinScope(node, input.scopeRange)) {
          return false;
        }
        if (matchMode === 'sameSelector') {
          return buildSelector(node) === anchorSelector;
        }
        if (matchMode === 'sameStructure') {
          const nodeClasses = getClassList(node);
          const nodeChildTags = index.nodes
            .filter(
              (candidate) =>
                candidate.startOffset >= node.openingEndOffset &&
                candidate.endOffset <= node.closingStartOffset
            )
            .map((candidate) => candidate.tagName)
            .join('|');
          return (
            node.tagName === anchorNode.tagName &&
            nodeClasses.length === anchorClasses.size &&
            nodeClasses.every((className) => anchorClasses.has(className)) &&
            nodeChildTags === anchorChildTags
          );
        }
        const nodeClasses = getClassList(node);
        return (
          node.tagName === anchorNode.tagName &&
          nodeClasses.length === anchorClasses.size &&
          nodeClasses.every((className) => anchorClasses.has(className))
        );
      });
      return removeNodes(input.filePath, matchedNodes);
    },

    async replaceInnerHtml(input: { filePath: string; range: SourceRange; html: string }) {
      return replaceNodeInnerHtml(input);
    },

    async replaceText(input: { filePath: string; range: SourceRange; text: string }) {
      return replaceNodeText(input);
    },

    async patchHtml(input: {
      filePath: string;
      range?: SourceRange;
      operation: HtmlPatchOperation;
    }): Promise<{ changed: boolean; range: SourceRange | null; removedCount: number }> {
      switch (input.operation.type) {
        case 'setAttributes':
          if (!input.range) {
            throw new Error('setAttributes requires a source range');
          }
          return setAttributes({
            filePath: input.filePath,
            range: input.range,
            operation: input.operation,
          });
        case 'removeNode':
          if (!input.range) {
            throw new Error('removeNode requires a source range');
          }
          return this.removeNode({
            filePath: input.filePath,
            range: input.range,
          });
        case 'removeNodesBySelector':
          return this.removeNodesBySelector({
            filePath: input.filePath,
            selector: input.operation.selector,
            scopeRange: input.operation.scopeRange,
          });
        case 'removeSimilarNodes':
          if (!input.range) {
            throw new Error('removeSimilarNodes requires a source range');
          }
          return this.removeSimilarNodes({
            filePath: input.filePath,
            range: input.range,
            matchMode: input.operation.matchMode,
            scopeRange: input.operation.scopeRange,
          });
        case 'replaceInnerHtml':
          if (!input.range) {
            throw new Error('replaceInnerHtml requires a source range');
          }
          return replaceNodeInnerHtml({
            filePath: input.filePath,
            range: input.range,
            html: input.operation.html,
          });
        case 'replaceText':
          if (!input.range) {
            throw new Error('replaceText requires a source range');
          }
          return replaceNodeText({
            filePath: input.filePath,
            range: input.range,
            text: input.operation.text,
          });
      }
    },
  };
}
