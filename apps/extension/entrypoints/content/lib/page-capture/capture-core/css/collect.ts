import type { CaptureCoreWarning } from '../types';
import { rewriteCssResourceUrls } from './rewrite';

const CSS_IMPORT_PATTERN =
  /@import\s+(?:url\(\s*)?(?:"([^"]+)"|'([^']+)'|([^'")\s;]+))\s*\)?\s*([^;]*);/gi;

export type StyleSource = {
  sourceUrl: string;
  content: string;
  media?: string;
};

type CollectStyleOptions = {
  originalDoc?: Document;
  pruneUnused?: boolean;
  fetchStylesheet?: (sourceUrl: string) => Promise<string>;
  preserveInlineStyleElements?: boolean;
};

type StyleRoot = Document | ShadowRoot;

type RuleLike = CSSRule & {
  selectorText?: string;
  cssRules?: CSSRuleList;
  conditionText?: string;
};

type StyleSheetLike = CSSStyleSheet & {
  ownerNode?: Element | null;
};

const CSS_STYLE_RULE = 1;
const CSS_MEDIA_RULE = 4;
const CSS_FONT_FACE_RULE = 5;
const CSS_SUPPORTS_RULE = 12;
const MICRO_APP_SCOPE_PREFIX_PATTERN = /micro-app\[name=(?:"[^"]+"|'[^']+'|[^\]]+)\]\s+/gi;

function resolveUrl(url: string, baseUrl: URL): string | null {
  try {
    return new URL(url, baseUrl).href;
  } catch {
    return null;
  }
}

function shouldCaptureStyleSourceUrl(sourceUrl: string | null | undefined): boolean {
  if (!sourceUrl) {
    return true;
  }

  try {
    const { protocol } = new URL(sourceUrl);
    return !['chrome-extension:', 'moz-extension:', 'safari-extension:'].includes(protocol);
  } catch {
    return !/^(chrome-extension|moz-extension|safari-extension):/i.test(sourceUrl);
  }
}

function normalizeStyleContentForDedup(content: string): string {
  return content.replace(MICRO_APP_SCOPE_PREFIX_PATTERN, '');
}

function getLinkRelTokens(node: Element): string[] {
  const relTokens = (node.getAttribute('rel') || '')
    .split(/\s+/)
    .map((token) => token.toLowerCase())
    .filter(Boolean);

  return relTokens;
}

function isLinkElement(node: Element): node is HTMLLinkElement {
  return node.localName === 'link';
}

function isStylesheetLink(node: Element): node is HTMLLinkElement {
  return isLinkElement(node) && getLinkRelTokens(node).includes('stylesheet');
}

function shouldMergeStylesheetLink(node: HTMLLinkElement): boolean {
  const relTokens = getLinkRelTokens(node);
  const href = node.getAttribute('href');
  return !relTokens.includes('alternate') && shouldCaptureStyleSourceUrl(href);
}

function isStyleElement(node: Element): node is HTMLStyleElement {
  return node.localName === 'style';
}

function isStyleCollectionNode(node: Element): boolean {
  return isStyleElement(node) || isStylesheetLink(node);
}

function getStyleSourceUrl(
  node: Element | null | undefined,
  stylesheetHref?: string | null,
  fallback = 'runtime-inline-style'
): string {
  if (stylesheetHref) {
    return stylesheetHref;
  }

  const originHref = node?.getAttribute('data-origin-href');
  if (originHref) {
    return originHref;
  }

  return fallback;
}

async function fetchStylesheet(
  sourceUrl: string,
  warnings: CaptureCoreWarning[],
  fetcher?: (sourceUrl: string) => Promise<string>
): Promise<string | null> {
  try {
    if (fetcher) {
      return await fetcher(sourceUrl);
    }

    const response = await fetch(sourceUrl);
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    return await response.text();
  } catch (error) {
    warnings.push({
      code: 'stylesheet_fetch_failed',
      message: `样式表抓取失败：${error instanceof Error ? error.message : String(error)}`,
      sourceUrl,
    });
    return null;
  }
}

async function expandImports(
  cssText: string,
  sourceUrl: string,
  warnings: CaptureCoreWarning[],
  seen: Set<string>,
  fetcher?: (sourceUrl: string) => Promise<string>
): Promise<string> {
  const chunks: string[] = [];
  let lastIndex = 0;

  for (const match of cssText.matchAll(CSS_IMPORT_PATTERN)) {
    chunks.push(cssText.slice(lastIndex, match.index));
    lastIndex = (match.index || 0) + match[0].length;

    const importUrl = resolveUrl(match[1] || match[2] || match[3] || '', new URL(sourceUrl));
    const importMedia = match[4]?.trim();
    if (!importUrl || seen.has(importUrl)) {
      continue;
    }

    seen.add(importUrl);
    const imported = await fetchStylesheet(importUrl, warnings, fetcher);
    if (imported !== null) {
      const expanded = await expandImports(imported, importUrl, warnings, seen, fetcher);
      chunks.push(importMedia ? `@media ${importMedia} {\n${expanded}\n}` : expanded);
    }
  }

  chunks.push(cssText.slice(lastIndex));
  return chunks.join('');
}

function getSheetCssRules(node: Element): CSSRuleList | null {
  const sheet = (node as HTMLLinkElement | HTMLStyleElement).sheet;
  if (!sheet) {
    return null;
  }

  try {
    return sheet.cssRules;
  } catch {
    return null;
  }
}

function splitSelectorList(selectorText: string): string[] {
  const selectors: string[] = [];
  let current = '';
  let depth = 0;
  let quote: string | null = null;

  for (const char of selectorText) {
    if (quote) {
      current += char;
      if (char === quote) {
        quote = null;
      }
      continue;
    }

    if (char === '"' || char === "'") {
      quote = char;
      current += char;
      continue;
    }

    if (char === '(' || char === '[') {
      depth += 1;
      current += char;
      continue;
    }

    if (char === ')' || char === ']') {
      depth = Math.max(0, depth - 1);
      current += char;
      continue;
    }

    if (char === ',' && depth === 0) {
      selectors.push(current.trim());
      current = '';
      continue;
    }

    current += char;
  }

  if (current.trim()) {
    selectors.push(current.trim());
  }

  return selectors;
}

function stripNonStructuralPseudos(selector: string): string {
  return selector
    .replace(/::[a-z-]+(?:\([^)]*\))?/gi, '')
    .replace(/:(?:hover|active|focus|focus-visible|focus-within|visited|link|target)\b/gi, '');
}

function selectorMatchesCapturedDocument(selectorText: string, doc: Document): boolean {
  return splitSelectorList(selectorText).some((selector) => {
    const candidates = [selector, stripNonStructuralPseudos(selector)];
    let sawInvalidSelector = false;
    for (const candidate of candidates) {
      if (!candidate) {
        continue;
      }

      try {
        if (doc.querySelector(candidate)) {
          return true;
        }
      } catch {
        sawInvalidSelector = true;
      }
    }

    return sawInvalidSelector;
  });
}

function cssRulesToText(rules: CSSRuleList, doc: Document, pruneUnused: boolean): string {
  const chunks: string[] = [];

  for (const rule of Array.from(rules) as RuleLike[]) {
    if (rule.type === CSS_STYLE_RULE && rule.selectorText) {
      if (!pruneUnused || selectorMatchesCapturedDocument(rule.selectorText, doc)) {
        chunks.push(rule.cssText);
      }
      continue;
    }

    if (rule.type === CSS_MEDIA_RULE && rule.cssRules) {
      const nested = cssRulesToText(rule.cssRules, doc, pruneUnused).trim();
      if (nested) {
        chunks.push(`@media ${rule.conditionText || ''} {\n${nested}\n}`);
      }
      continue;
    }

    if (rule.type === CSS_SUPPORTS_RULE && rule.cssRules) {
      const nested = cssRulesToText(rule.cssRules, doc, pruneUnused).trim();
      if (nested) {
        chunks.push(`@supports ${rule.conditionText || ''} {\n${nested}\n}`);
      }
      continue;
    }

    if (rule.type === CSS_FONT_FACE_RULE) {
      continue;
    }

    chunks.push(rule.cssText);
  }

  return chunks.join('\n');
}

function parseCssTextWithCssom(
  cssText: string,
  doc: Document,
  pruneUnused: boolean
): string | null {
  const CssStyleSheet = doc.defaultView?.CSSStyleSheet;
  if (!CssStyleSheet) {
    return null;
  }

  try {
    const sheet = new CssStyleSheet();
    if (typeof sheet.replaceSync !== 'function') {
      return null;
    }

    sheet.replaceSync(cssText);
    return cssRulesToText(sheet.cssRules, doc, pruneUnused);
  } catch {
    return null;
  }
}

function stripFontFaceRules(cssText: string): string {
  return cssText.replace(/@font-face\s*\{(?:[^{}]|\{[^{}]*\})*}/gi, '');
}

function pruneFlatCssText(cssText: string, doc: Document): string {
  let output = '';
  let index = 0;
  const rulePattern = /([^{}@][^{}]*)\{([^{}]*)\}/g;

  for (const match of cssText.matchAll(rulePattern)) {
    output += cssText.slice(index, match.index);
    index = (match.index || 0) + match[0].length;

    const selectorText = match[1].trim();
    if (selectorMatchesCapturedDocument(selectorText, doc)) {
      output += `${selectorText}{${match[2]}}`;
    }
  }

  output += cssText.slice(index);
  return output;
}

function pruneCssText(cssText: string, doc: Document): string {
  const cssomText = parseCssTextWithCssom(cssText, doc, true);
  if (cssomText !== null) {
    return cssomText;
  }

  return pruneFlatCssText(stripFontFaceRules(cssText), doc);
}

function normalizeCssText(cssText: string, doc: Document, pruneUnused: boolean): string {
  if (pruneUnused) {
    return pruneCssText(cssText, doc);
  }

  const cssomText = parseCssTextWithCssom(cssText, doc, false);
  return cssomText ?? stripFontFaceRules(cssText);
}

function findOriginalStyleNode(
  node: Element,
  index: number,
  originalDoc?: Document
): Element | null {
  if (!originalDoc) {
    return null;
  }

  const originalNodes = Array.from(originalDoc.querySelectorAll('link,style')).filter(
    isStyleCollectionNode
  );
  const originalNode = originalNodes[index];
  if (!originalNode || originalNode.localName !== node.localName) {
    return null;
  }

  return originalNode;
}

function readFrameDocument(element: Element): Document | null {
  if (!(element instanceof HTMLIFrameElement)) {
    return null;
  }

  try {
    return element.contentDocument;
  } catch {
    return null;
  }
}

function hasInlineHiddenStyle(element: Element): boolean {
  const style = element.getAttribute('style') || '';
  return (
    /(^|;)\s*display\s*:\s*none\s*(?:!important\s*)?(;|$)/i.test(style) ||
    /(^|;)\s*visibility\s*:\s*(?:hidden|collapse)\s*(?:!important\s*)?(;|$)/i.test(style)
  );
}

function isElementStyleHostVisible(element: Element): boolean {
  for (let current: Element | null = element; current; current = current.parentElement) {
    if (current.hasAttribute('hidden') || current.getAttribute('aria-hidden') === 'true') {
      return false;
    }

    if (hasInlineHiddenStyle(current)) {
      return false;
    }

    const view = current.ownerDocument.defaultView;
    if (!view) {
      continue;
    }

    const computedStyle = view.getComputedStyle(current);
    if (
      computedStyle.getPropertyValue('display') === 'none' ||
      ['hidden', 'collapse'].includes(computedStyle.getPropertyValue('visibility'))
    ) {
      return false;
    }
  }

  return true;
}

function collectDetachedStyleRoots(root: StyleRoot, visibleOnly = false): StyleRoot[] {
  const roots: StyleRoot[] = [];

  for (const element of Array.from(root.querySelectorAll('*'))) {
    if (visibleOnly && !isElementStyleHostVisible(element)) {
      continue;
    }

    if (element.shadowRoot) {
      roots.push(element.shadowRoot);
      roots.push(...collectDetachedStyleRoots(element.shadowRoot, visibleOnly));
    }

    const frameDocument = readFrameDocument(element);
    if (frameDocument) {
      roots.push(frameDocument);
      roots.push(...collectDetachedStyleRoots(frameDocument, visibleOnly));
    }
  }

  return roots;
}

function getStyleRootBaseUrl(root: StyleRoot, fallback: URL): URL {
  const rootAsDocument = root.nodeType === Node.DOCUMENT_NODE ? (root as Document) : null;
  const rootAsShadow = root.nodeType === Node.DOCUMENT_FRAGMENT_NODE ? (root as ShadowRoot) : null;
  const ownerDocument = rootAsShadow?.host?.ownerDocument;
  const baseUrl =
    rootAsDocument?.baseURI ||
    rootAsDocument?.location?.href ||
    ownerDocument?.baseURI ||
    ownerDocument?.location?.href;

  if (!baseUrl) {
    return fallback;
  }

  return resolveUrl(baseUrl, fallback) ? new URL(baseUrl, fallback) : fallback;
}

function readAdoptedStyleSources(
  root: StyleRoot,
  doc: Document,
  pruneUnused: boolean,
  warnings: CaptureCoreWarning[]
): StyleSource[] {
  const adoptedStyleSheets = root.adoptedStyleSheets || [];
  const sources: StyleSource[] = [];

  for (const [index, sheet] of adoptedStyleSheets.entries()) {
    try {
      sources.push({
        sourceUrl: sheet.href || `adopted-style-${index + 1}`,
        content: rewriteCssResourceUrls(cssRulesToText(sheet.cssRules, doc, pruneUnused)),
      });
    } catch (error) {
      warnings.push({
        code: 'stylesheet_fetch_failed',
        message: `运行时样式表读取失败：${error instanceof Error ? error.message : String(error)}`,
        sourceUrl: sheet.href || undefined,
      });
    }
  }

  return sources;
}

function getRootStyleSheets(root: StyleRoot): StyleSheetLike[] {
  const styleSheets = (root as StyleRoot & { styleSheets?: StyleSheetList | StyleSheetLike[] })
    .styleSheets;
  return Array.from(styleSheets || []) as StyleSheetLike[];
}

function getRootStyleNodes(root: StyleRoot): Element[] {
  return Array.from(root.querySelectorAll('link,style')).filter(isStyleCollectionNode);
}

function isLikelyStylesheetResourceUrl(resourceUrl: string): boolean {
  return /\.css(?:[?#]|$)/i.test(resourceUrl);
}

function isSameOriginUrl(resourceUrl: string, baseUrl: URL): boolean {
  try {
    return new URL(resourceUrl).origin === baseUrl.origin;
  } catch {
    return false;
  }
}

function getPerformanceStylesheetUrls(doc: Document, baseUrl: URL): string[] {
  const performanceEntries = doc.defaultView?.performance?.getEntriesByType?.('resource') || [];
  const urls = new Set<string>();

  for (const entry of performanceEntries) {
    const name = entry.name;
    if (typeof name !== 'string' || !name) {
      continue;
    }

    const lowerName = name.toLowerCase();
    const initiatorType =
      'initiatorType' in entry && typeof entry.initiatorType === 'string'
        ? entry.initiatorType.toLowerCase()
        : '';

    if (initiatorType !== 'link' && !isLikelyStylesheetResourceUrl(lowerName)) {
      continue;
    }

    if (!isLikelyStylesheetResourceUrl(lowerName)) {
      continue;
    }

    const resolved = resolveUrl(name, baseUrl);
    if (
      resolved &&
      shouldCaptureStyleSourceUrl(resolved) &&
      isSameOriginUrl(resolved, baseUrl)
    ) {
      urls.add(resolved);
    }
  }

  return Array.from(urls);
}

function getUniqueDocumentRoots(originalDoc: Document): Document[] {
  const documents = new Set<Document>([originalDoc]);

  for (const root of collectDetachedStyleRoots(originalDoc, true)) {
    if (root.nodeType === Node.DOCUMENT_NODE) {
      documents.add(root as Document);
    }
  }

  return Array.from(documents);
}

function collectStyleSheetFallbackSources(
  root: StyleRoot,
  doc: Document,
  warnings: CaptureCoreWarning[],
  pruneUnused: boolean,
  seenNodes: Set<Element>
): StyleSource[] {
  const sources: StyleSource[] = [];

  for (const [index, sheet] of getRootStyleSheets(root).entries()) {
    const ownerNode = sheet.ownerNode instanceof Element ? sheet.ownerNode : null;
    if (ownerNode && seenNodes.has(ownerNode)) {
      continue;
    }

    try {
      const content = rewriteCssResourceUrls(cssRulesToText(sheet.cssRules, doc, pruneUnused));
      if (!content.trim()) {
        continue;
      }

      const media =
        ownerNode?.getAttribute('media') || (sheet.media?.mediaText || undefined);
      const fallbackSourceUrl =
        ownerNode?.localName === 'style' ? 'runtime-inline-style' : `runtime-stylesheet-${index + 1}`;

      const sourceUrl = getStyleSourceUrl(ownerNode, sheet.href, fallbackSourceUrl);
      if (!shouldCaptureStyleSourceUrl(sourceUrl)) {
        continue;
      }

      sources.push({
        sourceUrl,
        content,
        media,
      });
    } catch (error) {
      warnings.push({
        code: 'stylesheet_fetch_failed',
        message: `运行时样式表读取失败：${error instanceof Error ? error.message : String(error)}`,
        sourceUrl: getStyleSourceUrl(ownerNode, sheet.href, undefined),
      });
    }
  }

  return sources;
}

async function collectDetachedStyleSources(
  root: StyleRoot,
  doc: Document,
  baseUrl: URL,
  warnings: CaptureCoreWarning[],
  pruneUnused: boolean,
  fetcher?: (sourceUrl: string) => Promise<string>
): Promise<StyleSource[]> {
  const sources: StyleSource[] = [];
  const rootBaseUrl = getStyleRootBaseUrl(root, baseUrl);
  const styleNodes = getRootStyleNodes(root);
  const seenNodes = new Set(styleNodes);

  for (const node of styleNodes) {
    if (isStylesheetLink(node)) {
      if (!shouldMergeStylesheetLink(node)) {
        continue;
      }

      const href = node.getAttribute('href');
      const sourceUrl = href ? resolveUrl(href, rootBaseUrl) : null;
      if (!sourceUrl) {
        warnings.push({
          code: 'stylesheet_fetch_failed',
          message: '运行时样式表抓取失败：缺少或无效的 href',
        });
        continue;
      }

      if (!shouldCaptureStyleSourceUrl(sourceUrl)) {
        continue;
      }

      const content = await readStylesheetContent(
        node,
        sourceUrl,
        warnings,
        doc,
        node,
        pruneUnused,
        fetcher
      );
      if (content !== null) {
        sources.push({
          sourceUrl,
          content: rewriteCssResourceUrls(content),
          media: node.getAttribute('media') || undefined,
        });
      }
      continue;
    }

    if (isStyleElement(node)) {
      const sourceUrl = getStyleSourceUrl(node, undefined, 'runtime-inline-style');
      if (!shouldCaptureStyleSourceUrl(sourceUrl)) {
        continue;
      }

      sources.push({
        sourceUrl,
        content: rewriteCssResourceUrls(readInlineStyleContent(node, doc, node, pruneUnused)),
        media: node.getAttribute('media') || undefined,
      });
    }
  }

  sources.push(...collectStyleSheetFallbackSources(root, doc, warnings, pruneUnused, seenNodes));
  sources.push(...readAdoptedStyleSources(root, doc, pruneUnused, warnings));
  return sources;
}

async function collectPerformanceStyleSources(
  sourceDoc: Document,
  doc: Document,
  baseUrl: URL,
  warnings: CaptureCoreWarning[],
  pruneUnused: boolean,
  existingSourceUrls: Set<string>,
  fetcher?: (sourceUrl: string) => Promise<string>
): Promise<StyleSource[]> {
  const sources: StyleSource[] = [];

  for (const sourceUrl of getPerformanceStylesheetUrls(sourceDoc, baseUrl)) {
    if (existingSourceUrls.has(sourceUrl)) {
      continue;
    }

    const content = await fetchStylesheet(sourceUrl, warnings, fetcher);
    if (content === null) {
      continue;
    }

    const expanded = await expandImports(content, sourceUrl, warnings, new Set([sourceUrl]), fetcher);
    const normalized = normalizeCssText(expanded, doc, pruneUnused);
    if (!normalized.trim()) {
      continue;
    }

    sources.push({
      sourceUrl,
      content: rewriteCssResourceUrls(normalized),
    });
    existingSourceUrls.add(sourceUrl);
  }

  return sources;
}

function pushUniqueStyleSource(
  sources: StyleSource[],
  seen: Set<string>,
  source: StyleSource
): void {
  const normalizedContent = normalizeStyleContentForDedup(source.content);
  const key = `${source.media || ''}\n${normalizedContent}`;
  if (seen.has(key)) {
    return;
  }

  seen.add(key);
  sources.push(source);
}

async function readStylesheetContent(
  node: HTMLLinkElement,
  sourceUrl: string,
  warnings: CaptureCoreWarning[],
  doc: Document,
  originalNode: Element | null,
  pruneUnused: boolean,
  fetcher?: (sourceUrl: string) => Promise<string>
): Promise<string | null> {
  const rules = originalNode ? getSheetCssRules(originalNode) : getSheetCssRules(node);
  if (rules) {
    return cssRulesToText(rules, doc, pruneUnused);
  }

  const content = await fetchStylesheet(sourceUrl, warnings, fetcher);
  if (content === null) {
    return null;
  }

  const expanded = await expandImports(content, sourceUrl, warnings, new Set([sourceUrl]), fetcher);
  return normalizeCssText(expanded, doc, pruneUnused);
}

function readInlineStyleContent(
  node: HTMLStyleElement,
  doc: Document,
  originalNode: Element | null,
  pruneUnused: boolean
): string {
  const rules = originalNode ? getSheetCssRules(originalNode) : getSheetCssRules(node);
  if (rules) {
    return cssRulesToText(rules, doc, pruneUnused);
  }

  const content = node.textContent || '';
  return normalizeCssText(content, doc, pruneUnused);
}

export async function collectStyleSources(
  doc: Document,
  baseUrl: URL,
  warnings: CaptureCoreWarning[],
  options: CollectStyleOptions = {}
): Promise<StyleSource[]> {
  const sources: StyleSource[] = [];
  const seenSources = new Set<string>();
  const pruneUnused = options.pruneUnused !== false;
  const preserveInlineStyleElements = options.preserveInlineStyleElements === true;
  const nodes = getRootStyleNodes(doc);
  const seenNodes = new Set(nodes);
  const originalSeenNodes = new Set(options.originalDoc ? getRootStyleNodes(options.originalDoc) : nodes);

  for (const [index, node] of nodes.entries()) {
    const originalNode = findOriginalStyleNode(node, index, options.originalDoc);
    if (isStylesheetLink(node)) {
      if (!shouldMergeStylesheetLink(node)) {
        node.remove();
        continue;
      }

      const href = node.getAttribute('href');
      const sourceUrl = href ? resolveUrl(href, baseUrl) : null;
      if (!sourceUrl) {
        warnings.push({
          code: 'stylesheet_fetch_failed',
          message: '样式表抓取失败：缺少或无效的 href',
        });
        node.remove();
        continue;
      }

      if (!shouldCaptureStyleSourceUrl(sourceUrl)) {
        node.remove();
        continue;
      }

      const content = await readStylesheetContent(
        node,
        sourceUrl,
        warnings,
        doc,
        originalNode,
        pruneUnused,
        options.fetchStylesheet
      );
      if (content !== null) {
        pushUniqueStyleSource(sources, seenSources, {
          sourceUrl,
          content: rewriteCssResourceUrls(content),
          media: node.getAttribute('media') || undefined,
        });
      }

      node.remove();
      continue;
    }

    if (isStyleElement(node)) {
      const content = readInlineStyleContent(node, doc, originalNode, pruneUnused);
      if (preserveInlineStyleElements) {
        if (content.trim()) {
          node.textContent = content;
          continue;
        }

        node.remove();
        continue;
      }

      if (!preserveInlineStyleElements) {
        pushUniqueStyleSource(sources, seenSources, {
          sourceUrl: getStyleSourceUrl(node, undefined, 'inline-style'),
          content: rewriteCssResourceUrls(content),
          media: node.getAttribute('media') || undefined,
        });
        node.remove();
      }
    }
  }

  for (const source of collectStyleSheetFallbackSources(
    options.originalDoc || doc,
    doc,
    warnings,
    pruneUnused,
    originalSeenNodes
  )) {
    pushUniqueStyleSource(sources, seenSources, source);
  }

  if (options.originalDoc) {
    const existingSourceUrls = new Set(sources.map((source) => source.sourceUrl));

    for (const source of readAdoptedStyleSources(options.originalDoc, doc, pruneUnused, warnings)) {
      pushUniqueStyleSource(sources, seenSources, source);
      existingSourceUrls.add(source.sourceUrl);
    }

    for (const root of collectDetachedStyleRoots(options.originalDoc, true)) {
      const detachedSources = await collectDetachedStyleSources(
        root,
        doc,
        baseUrl,
        warnings,
        pruneUnused,
        options.fetchStylesheet
      );
      for (const source of detachedSources) {
        pushUniqueStyleSource(sources, seenSources, source);
        existingSourceUrls.add(source.sourceUrl);
      }
    }

    for (const sourceDoc of getUniqueDocumentRoots(options.originalDoc)) {
      for (const source of await collectPerformanceStyleSources(
        sourceDoc,
        doc,
        baseUrl,
        warnings,
        pruneUnused,
        existingSourceUrls,
        options.fetchStylesheet
      )) {
        pushUniqueStyleSource(sources, seenSources, source);
      }
    }
  }

  return sources;
}
