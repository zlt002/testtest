(function (global) {
  'use strict';

  if (global.__webeditRuntimeAdapter) {
    return;
  }

  function safeString(value) {
    if (value === null || typeof value === 'undefined') {
      return null;
    }
    try {
      return String(value);
    } catch (error) {
      return '[unserializable]';
    }
  }

  function cleanObject(value) {
    const output = {};
    Object.keys(value).forEach(function (key) {
      if (typeof value[key] !== 'undefined') {
        output[key] = value[key];
      }
    });
    return output;
  }

  async function resolveValue(value) {
    if (value && typeof value.then === 'function') {
      return await value;
    }
    return value;
  }

  async function readProperty(target, key) {
    if (!target) {
      return undefined;
    }

    try {
      return await resolveValue(target[key]);
    } catch (error) {
      return undefined;
    }
  }

  async function callMethod(target, key, args) {
    if (!target || typeof target[key] !== 'function') {
      return undefined;
    }

    try {
      return await resolveValue(target[key].apply(target, args || []));
    } catch (error) {
      return undefined;
    }
  }

  async function readPropertyOrCall(target, key, args) {
    if (!target) {
      return undefined;
    }

    const propertyValue = await readProperty(target, key);
    if (typeof propertyValue !== 'function' && typeof propertyValue !== 'undefined') {
      return propertyValue;
    }

    if (typeof propertyValue === 'function' && propertyValue && typeof propertyValue.then === 'function') {
      return await resolveValue(propertyValue);
    }

    if (hasMethod(target, key)) {
      return await callMethod(target, key, args);
    }

    return propertyValue;
  }

  function hasMethod(target, key) {
    if (!target) {
      return false;
    }

    try {
      return typeof target[key] === 'function';
    } catch (error) {
      return false;
    }
  }

  async function setProperty(target, key, value) {
    if (!target) {
      return false;
    }

    try {
      target[key] = value;
      return true;
    } catch (error) {
      return false;
    }
  }

  function numberToColumnName(input) {
    let current = input;
    let output = '';

    while (current > 0) {
      const remainder = (current - 1) % 26;
      output = String.fromCharCode(65 + remainder) + output;
      current = Math.floor((current - 1) / 26);
    }

    return output;
  }

  function buildA1Address(row, column, rowsCount, columnsCount) {
    if (typeof row !== 'number' || typeof column !== 'number') {
      return null;
    }

    const start = numberToColumnName(column) + String(row);
    if (
      typeof rowsCount !== 'number' ||
      typeof columnsCount !== 'number' ||
      (rowsCount === 1 && columnsCount === 1)
    ) {
      return start;
    }

    const end = numberToColumnName(column + columnsCount - 1) + String(row + rowsCount - 1);
    return start + ':' + end;
  }

  function getOfficeIframeElement() {
    const activeElement = document.activeElement;
    if (
      activeElement &&
      activeElement.tagName === 'IFRAME' &&
      activeElement.id === 'office-iframe'
    ) {
      return activeElement;
    }

    return document.getElementById('office-iframe');
  }

  function getFlowIframeElement() {
    const activeElement = document.activeElement;
    if (
      activeElement &&
      activeElement.tagName === 'IFRAME' &&
      activeElement.id === 'third-iframe'
    ) {
      return activeElement;
    }

    return document.getElementById('third-iframe');
  }

  function getRuntimeIframeElements() {
    const candidates = [];

    function pushCandidate(iframe) {
      if (!iframe || candidates.indexOf(iframe) !== -1) {
        return;
      }
      candidates.push(iframe);
    }

    pushCandidate(getOfficeIframeElement());
    pushCandidate(getFlowIframeElement());

    if (document && typeof document.querySelectorAll === 'function') {
      try {
        const iframeList = document.querySelectorAll('iframe');
        for (let index = 0; index < iframeList.length; index += 1) {
          pushCandidate(iframeList[index]);
        }
      } catch (error) {
        // ignore querySelectorAll issues in restricted runtimes
      }
    }

    return candidates;
  }

  function getIframeWindow(iframe) {
    if (!iframe) {
      return null;
    }

    try {
      return iframe.contentWindow || null;
    } catch (error) {
      return null;
    }
  }

  function getIframeDocument(iframe) {
    if (!iframe) {
      return null;
    }

    try {
      return iframe.contentDocument || null;
    } catch (error) {
      return null;
    }
  }

  function canAccessWindow(candidateWindow) {
    if (!candidateWindow) {
      return false;
    }

    try {
      void candidateWindow.location.href;
      return true;
    } catch (error) {
      return false;
    }
  }

  function getWindowRuntimeFlags(candidateWindow) {
    if (!candidateWindow || !canAccessWindow(candidateWindow)) {
      return {
        hasAPP: false,
        hasWPSOpenApi: false,
        hasWebOfficeSDK: false,
        hasWpsSDK: false,
        hasWPSInstance: false,
        hasKSO: false,
        hasFlowModel: false,
        hasFlowDesigner: false,
        hasFlowBeautify: false,
        hasSmartAiHelp: false,
      };
    }

    return {
      hasAPP: typeof candidateWindow.APP !== 'undefined',
      hasWPSOpenApi:
        typeof candidateWindow.WPSOpenApi !== 'undefined' &&
        !!(candidateWindow.WPSOpenApi && candidateWindow.WPSOpenApi.Application),
      hasWebOfficeSDK: typeof candidateWindow.WebOfficeSDK !== 'undefined',
      hasWpsSDK: typeof candidateWindow.wpsSDK !== 'undefined',
      hasWPSInstance: typeof candidateWindow.WPSInstance !== 'undefined',
      hasKSO: typeof candidateWindow.KSO !== 'undefined',
      hasFlowModel: typeof candidateWindow.Model !== 'undefined',
      hasFlowDesigner: typeof candidateWindow.Designer !== 'undefined',
      hasFlowBeautify: typeof candidateWindow.Beautify !== 'undefined',
      hasSmartAiHelp: typeof candidateWindow.smartAiHelpCon !== 'undefined',
    };
  }

  function detectRuntimeSource() {
    const candidates = [{ label: 'window', windowRef: global }];
    const runtimeIframes = getRuntimeIframeElements();

    for (let index = 0; index < runtimeIframes.length; index += 1) {
      const iframe = runtimeIframes[index];
      const iframeWindow = getIframeWindow(iframe);
      if (!iframeWindow) {
        continue;
      }
      candidates.push({
        label: iframe.id || `iframe-${index + 1}`,
        windowRef: iframeWindow,
      });
    }

    for (let index = 0; index < candidates.length; index += 1) {
      const candidate = candidates[index];
      const flags = getWindowRuntimeFlags(candidate.windowRef);

      if (
        flags.hasAPP ||
        flags.hasWPSOpenApi ||
        flags.hasWebOfficeSDK ||
        flags.hasWpsSDK ||
        flags.hasWPSInstance ||
        (flags.hasFlowModel && flags.hasFlowDesigner)
      ) {
        return {
          label: candidate.label,
          windowRef: candidate.windowRef,
          flags: flags,
        };
      }
    }

    return {
      label: null,
      windowRef: null,
      flags: getWindowRuntimeFlags(global),
    };
  }

  function getRuntimeFlags() {
    return detectRuntimeSource().flags;
  }

  function isRuntimeReady() {
    return !!detectRuntimeSource().label;
  }

  function normalizeWhitespace(value) {
    if (typeof value !== 'string') {
      return '';
    }

    return value.replace(/\s+/g, ' ').trim();
  }

  function delay(ms) {
    const timeout = typeof ms === 'number' && ms >= 0 ? ms : 0;
    return new Promise(function (resolve) {
      setTimeout(resolve, timeout);
    });
  }

  function queryFirstText(target, selectors) {
    if (!target || typeof target.querySelector !== 'function') {
      return '';
    }

    const selectorList = Array.isArray(selectors) ? selectors : [];
    for (let index = 0; index < selectorList.length; index += 1) {
      const selector = selectorList[index];
      try {
        const node = target.querySelector(selector);
        const text = normalizeWhitespace(node && node.textContent ? node.textContent : '');
        if (text) {
          return text;
        }
      } catch (error) {
        // ignore selector/runtime errors
      }
    }

    return '';
  }

  function extractCommentId(target, fallbackIndex) {
    if (!target) {
      return `comment-${fallbackIndex + 1}`;
    }

    const directId =
      (typeof target.getAttribute === 'function' && target.getAttribute('data-id')) ||
      (typeof target.getAttribute === 'function' && target.getAttribute('data-comment-id')) ||
      null;
    if (directId) {
      return safeString(directId);
    }

    const className = safeString(target.className) || '';
    const classMatch = className.match(/comment-item-(\d+)/i);
    if (classMatch) {
      return classMatch[1];
    }

    return className || `comment-${fallbackIndex + 1}`;
  }

  function parseCommentText(rawText, structuredContent) {
    const normalizedRaw = normalizeWhitespace(rawText);
    const normalizedContent = normalizeWhitespace(structuredContent);
    if (!normalizedRaw && !normalizedContent) {
      return {
        author: '',
        time: '',
        content: '',
      };
    }

    const content = normalizedContent || normalizedRaw;
    const sourceText = normalizedRaw || normalizedContent;
    const timePattern =
      /(今天\s*\d{1,2}:\d{2}|昨天\s*\d{1,2}:\d{2}|\d{4}[-/]\d{1,2}[-/]\d{1,2}(?:\s+\d{1,2}:\d{2})?)/;
    const timeMatch = sourceText.match(timePattern);
    const time = timeMatch ? normalizeWhitespace(timeMatch[1]) : '';
    const beforeTime = timeMatch ? sourceText.slice(0, timeMatch.index) : '';
    const afterTime = timeMatch
      ? sourceText.slice((timeMatch.index || 0) + timeMatch[0].length)
      : sourceText;
    const author = normalizeWhitespace(beforeTime.replace(/^[、与,:：\s]+/, ''));
    const contentFromRaw = normalizeWhitespace(afterTime.replace(/^[、,:：\s]+/, ''));

    return {
      author: author,
      time: time,
      content: normalizedContent || contentFromRaw || normalizedRaw,
    };
  }

  function escapeRegExp(value) {
    return typeof value === 'string' ? value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') : '';
  }

  function stripCommentBoilerplate(value, commentInfo) {
    let text = normalizeWhitespace(value);
    if (!text) {
      return '';
    }

    const info = commentInfo && typeof commentInfo === 'object' ? commentInfo : {};
    const removableParts = [
      typeof info.author === 'string' ? info.author : '',
      typeof info.time === 'string' ? info.time : '',
      typeof info.content === 'string' ? info.content : '',
      typeof info.rawText === 'string' ? info.rawText : '',
      '点击输入评论',
      '回复',
      '评论',
      '批注',
      '与',
    ].filter(Boolean);

    for (let index = 0; index < removableParts.length; index += 1) {
      const part = removableParts[index];
      if (!part) {
        continue;
      }
      text = normalizeWhitespace(text.replace(new RegExp(escapeRegExp(part), 'g'), ' '));
    }

    return text;
  }

  function queryAnchorPreview(item, commentInfo) {
    if (!item) {
      return '';
    }

    const modalScope =
      (typeof item.closest === 'function' &&
        (item.closest('.comment-modal') ||
          item.closest('.cr-modal') ||
          item.closest('.cr-wrap') ||
          item.closest('.cr-content'))) ||
      null;
    const scopes = [item, modalScope].filter(Boolean);
    const selectors = [
      '.comment-reference',
      '.reference-text',
      '.quote-text',
      '.target-text',
      '.anchor-text',
      '.anchor-preview',
      '.comment-preview',
      '.preview',
      '.quote',
      '.ref-content',
      '.comment-source',
      '.comment-modal-header',
      '.comment-modal-title',
      '.comment-target',
    ];

    for (let scopeIndex = 0; scopeIndex < scopes.length; scopeIndex += 1) {
      const scope = scopes[scopeIndex];
      const candidate = queryFirstText(scope, selectors);
      const normalized = stripCommentBoilerplate(candidate, commentInfo);
      if (normalized) {
        return normalized;
      }
    }

    const rawModalText = stripCommentBoilerplate(
      modalScope && modalScope.textContent ? modalScope.textContent : '',
      commentInfo
    );
    if (rawModalText) {
      return rawModalText.slice(0, 160);
    }

    return '';
  }

  function collectCommentEntries(items, seen, options) {
    const commentItems = Array.isArray(items) ? items : [];
    const dedupe = seen instanceof Set ? seen : new Set();
    const normalizedOptions = options && typeof options === 'object' ? options : {};
    const comments = [];

    for (let index = 0; index < commentItems.length; index += 1) {
      const item = commentItems[index];
      if (!item || typeof item.querySelector !== 'function') {
        continue;
      }

      const author = queryFirstText(item, [
        '.comment-item-name',
        '.name',
        '.author',
        '.comment-author',
        '.comment-info .name',
        '.comment-info',
      ]);
      const time = queryFirstText(item, [
        '.comment-item-time',
        '.time',
        '.comment-time',
        '.comment-info .time',
      ]);
      const content = queryFirstText(item, [
        '.content.comment-text',
        '.comment-text',
        '.content',
      ]);
      const rawText = normalizeWhitespace(item.textContent || '');

      if (!author && !time && !content && !rawText) {
        continue;
      }

      const parsed = parseCommentText(rawText, content);
      const resolvedAuthor =
        author &&
        ((time && author.indexOf(time) !== -1) ||
          /今天\s*\d{1,2}:\d{2}|昨天\s*\d{1,2}:\d{2}|\d{4}[-/]\d{1,2}[-/]\d{1,2}/.test(author))
          ? parsed.author
          : author || parsed.author;
      const resolvedTime = time || parsed.time;
      const resolvedContent =
        content ||
        parsed.content ||
        normalizeWhitespace(
          rawText
            .replace(resolvedAuthor, '')
            .replace(resolvedTime, '')
        );
      const id = extractCommentId(item, index);
      const dedupeKey = `${resolvedAuthor}::${resolvedTime}::${resolvedContent}`;
      if (dedupe.has(dedupeKey)) {
        continue;
      }
      dedupe.add(dedupeKey);
      const anchorPreview = queryAnchorPreview(item, {
        author: resolvedAuthor,
        time: resolvedTime,
        content: resolvedContent,
        rawText: rawText,
      });
      const activeAnchorText =
        typeof normalizedOptions.activeAnchorText === 'string'
          ? normalizeWhitespace(normalizedOptions.activeAnchorText)
          : '';

      comments.push(
        cleanObject({
          id: id,
          author: resolvedAuthor || undefined,
          time: resolvedTime || undefined,
          content: resolvedContent || undefined,
          anchorPreview: anchorPreview || undefined,
          anchorText:
            activeAnchorText &&
            activeAnchorText !== resolvedContent &&
            activeAnchorText !== rawText
              ? activeAnchorText
              : undefined,
          rawText: rawText || undefined,
          source: 'office-iframe-dom',
        })
      );
    }

    return comments;
  }

  function getCommentScrollContainers(officeDocument) {
    if (!officeDocument) {
      return [];
    }

    const candidates = [];
    const seen = new Set();

    function pushCandidate(target) {
      if (!target || seen.has(target)) {
        return;
      }
      const scrollHeight = typeof target.scrollHeight === 'number' ? target.scrollHeight : 0;
      const clientHeight = typeof target.clientHeight === 'number' ? target.clientHeight : 0;
      if (scrollHeight <= clientHeight + 40) {
        return;
      }
      seen.add(target);
      candidates.push(target);
    }

    pushCandidate(officeDocument.scrollingElement || null);
    pushCandidate(officeDocument.documentElement || null);
    pushCandidate(officeDocument.body || null);

    if (typeof officeDocument.querySelectorAll === 'function') {
      try {
        const allNodes = officeDocument.querySelectorAll('*');
        for (let index = 0; index < allNodes.length; index += 1) {
          pushCandidate(allNodes[index]);
        }
      } catch (error) {
        // ignore selector/runtime errors
      }
    }

    return candidates.sort(function (left, right) {
      const leftRange =
        (typeof left.scrollHeight === 'number' ? left.scrollHeight : 0) -
        (typeof left.clientHeight === 'number' ? left.clientHeight : 0);
      const rightRange =
        (typeof right.scrollHeight === 'number' ? right.scrollHeight : 0) -
        (typeof right.clientHeight === 'number' ? right.clientHeight : 0);
      return rightRange - leftRange;
    });
  }

  function normalizeRuntimeMode(value) {
    if (typeof value !== 'string') {
      return null;
    }

    const normalized = value.trim().toLowerCase();
    if (!normalized) {
      return null;
    }

    if (
      normalized === 'document' ||
      normalized === 'doc' ||
      normalized === 'word' ||
      normalized === 'writer'
    ) {
      return 'document';
    }

    if (
      normalized === 'spreadsheet' ||
      normalized === 'sheet' ||
      normalized === 'excel' ||
      normalized === 'et'
    ) {
      return 'spreadsheet';
    }

    if (
      normalized === 'flow' ||
      normalized === 'diagram' ||
      normalized === 'flowchart' ||
      normalized === 'processon' ||
      normalized === 'pom'
    ) {
      return 'flow';
    }

    return null;
  }

  async function detectConfiguredRuntimeMode(candidateWindow, app) {
    const officeTypeCandidates = [];

    if (candidateWindow && canAccessWindow(candidateWindow)) {
      officeTypeCandidates.push(candidateWindow.officeType);
      officeTypeCandidates.push(candidateWindow.__WPSENV__ && candidateWindow.__WPSENV__.officeType);
    }

    officeTypeCandidates.push(app ? await readProperty(app, 'officeType') : undefined);

    for (let index = 0; index < officeTypeCandidates.length; index += 1) {
      const runtimeMode = normalizeRuntimeMode(officeTypeCandidates[index]);
      if (runtimeMode) {
        return runtimeMode;
      }
    }

    return null;
  }

  function getGlobalsPresent(candidateWindow) {
    const targetWindow = candidateWindow && canAccessWindow(candidateWindow) ? candidateWindow : null;
    const globalCandidates = [
      'APP',
      'WPSOpenApi',
      'WebOfficeSDK',
      'wpsSDK',
      'WPSInstance',
      'KSO',
      'Model',
      'Designer',
      'Utils',
      'Schema',
      'Dock',
      'UI',
      'Server',
      'MessageSource',
      'Beautify',
      'smartAiHelpCon',
      'AIMITO',
      '__AIMITO__',
    ];

    if (!targetWindow) {
      return [];
    }

    return globalCandidates.filter(function (key) {
      return typeof targetWindow[key] !== 'undefined';
    });
  }

  function detectDocumentIdentity() {
    const parsedUrl = new URL(global.location.href);
    return cleanObject({
      href: parsedUrl.href,
      origin: parsedUrl.origin,
      pathname: parsedUrl.pathname,
      search: parsedUrl.search,
      title: document.title || null,
      documentId:
        parsedUrl.searchParams.get('id') ||
        parsedUrl.searchParams.get('docId') ||
        parsedUrl.searchParams.get('editId') ||
        parsedUrl.searchParams.get('fileId') ||
        null,
      editId: parsedUrl.searchParams.get('editId') || null,
      readyState: document.readyState,
    });
  }

  function summarizeIframe(iframe) {
    if (!iframe) {
      return null;
    }

    let accessible = false;
    let href = null;

    try {
      const candidateWindow = iframe.contentWindow || null;
      accessible = canAccessWindow(candidateWindow);
      href = accessible ? candidateWindow.location.href : null;
    } catch (error) {
      accessible = false;
    }

    return cleanObject({
      id: iframe.id || null,
      className: safeString(iframe.className),
      name: iframe.name || null,
      src: iframe.getAttribute('src') || null,
      accessible: accessible,
      href: href,
    });
  }

  function listFunctionKeys(target) {
    if (!target) {
      return [];
    }

    const seen = new Set();
    const output = [];
    let current = target;
    let depth = 0;

    while (current && depth < 3) {
      try {
        Object.getOwnPropertyNames(current).forEach(function (key) {
          if (key === 'constructor' || seen.has(key)) {
            return;
          }

          seen.add(key);
          try {
            if (typeof target[key] === 'function') {
              output.push(key);
            }
          } catch (error) {
            // ignore inaccessible getter
          }
        });
      } catch (error) {
        // ignore prototype enumeration errors
      }

      current = Object.getPrototypeOf(current);
      depth += 1;
    }

    return output.sort();
  }

  function listOwnKeys(target) {
    if (!target) {
      return [];
    }

    try {
      return Object.getOwnPropertyNames(target).sort();
    } catch (error) {
      return [];
    }
  }

  function filterInterestingKeys(keys, matcher, limit) {
    const pattern = matcher instanceof RegExp ? matcher : /.*/;
    const max = typeof limit === 'number' && limit > 0 ? limit : 50;
    const ignoredKeys = new Set([
      '__defineGetter__',
      '__defineSetter__',
      '__lookupGetter__',
      '__lookupSetter__',
      'hasOwnProperty',
      'isPrototypeOf',
      'propertyIsEnumerable',
      'toLocaleString',
      'toString',
      'valueOf',
    ]);
    return (Array.isArray(keys) ? keys : [])
      .filter(function (key) {
        return typeof key === 'string' && !ignoredKeys.has(key) && pattern.test(key);
      })
      .slice(0, max);
  }

  async function getEditorApplication() {
    const runtimeSource = detectRuntimeSource();
    const candidateWindow = runtimeSource.windowRef;

    if (!candidateWindow) {
      return null;
    }

    if (candidateWindow.WPSOpenApi && candidateWindow.WPSOpenApi.Application) {
      return candidateWindow.WPSOpenApi.Application;
    }

    if (candidateWindow.APP) {
      return candidateWindow.APP;
    }

    return null;
  }

  function getFlowEditorWindow() {
    const runtimeSource = detectRuntimeSource();
    if (runtimeSource && runtimeSource.windowRef && runtimeSource.flags) {
      if (runtimeSource.flags.hasFlowModel && runtimeSource.flags.hasFlowDesigner) {
        return runtimeSource.windowRef;
      }
    }

    const runtimeIframes = getRuntimeIframeElements();
    for (let index = 0; index < runtimeIframes.length; index += 1) {
      const iframeWindow = getIframeWindow(runtimeIframes[index]);
      const flags = getWindowRuntimeFlags(iframeWindow);
      if (flags.hasFlowModel && flags.hasFlowDesigner) {
        return iframeWindow;
      }
    }

    return null;
  }

  function getFlowModel() {
    const flowWindow = getFlowEditorWindow();
    return flowWindow && typeof flowWindow.Model !== 'undefined' ? flowWindow.Model : null;
  }

  function getFlowDesigner() {
    const flowWindow = getFlowEditorWindow();
    return flowWindow && typeof flowWindow.Designer !== 'undefined' ? flowWindow.Designer : null;
  }

  function getFlowUtils() {
    const flowWindow = getFlowEditorWindow();
    return flowWindow && typeof flowWindow.Utils !== 'undefined' ? flowWindow.Utils : null;
  }

  function getFlowSchema() {
    const flowWindow = getFlowEditorWindow();
    return flowWindow && typeof flowWindow.Schema !== 'undefined' ? flowWindow.Schema : null;
  }

  function getFlowMessageSource() {
    const flowWindow = getFlowEditorWindow();
    return flowWindow && typeof flowWindow.MessageSource !== 'undefined'
      ? flowWindow.MessageSource
      : null;
  }

  function getFlowBeautify() {
    const flowWindow = getFlowEditorWindow();
    return flowWindow && typeof flowWindow.Beautify !== 'undefined' ? flowWindow.Beautify : null;
  }

  async function detectRuntimeMode() {
    const runtimeSource = detectRuntimeSource();
    const candidateWindow = runtimeSource.windowRef || global;
    const app = await getEditorApplication();
    const configuredMode = await detectConfiguredRuntimeMode(candidateWindow, app);

    if (configuredMode) {
      return configuredMode;
    }

    if (runtimeSource.flags.hasFlowModel && runtimeSource.flags.hasFlowDesigner) {
      return 'flow';
    }

    if (app) {
      const activeDocument =
        (await readProperty(app, 'ActiveDocument')) || (await readProperty(app, 'Document')) || null;
      if (activeDocument) {
        return 'document';
      }

      const activeWorkbook =
        (await callMethod(app, 'getActiveBook')) ||
        (await readProperty(app, 'ActiveWorkbook')) ||
        (await readProperty(app, 'Workbook')) ||
        null;
      const activeSheet =
        (await callMethod(app, 'getActiveSheet')) || (await readProperty(app, 'ActiveSheet')) || null;

      if (activeWorkbook || activeSheet) {
        return 'spreadsheet';
      }
    }

    return null;
  }

  function ensureArray(value) {
    return Array.isArray(value) ? value : [];
  }

  function cloneSimple(value) {
    if (value === null || typeof value === 'undefined') {
      return null;
    }

    try {
      return JSON.parse(JSON.stringify(value));
    } catch (error) {
      return value;
    }
  }

  function normalizeFlowTextBlocks(text, existingTextBlocks) {
    const blocks = ensureArray(existingTextBlocks).length > 0
      ? cloneSimple(existingTextBlocks)
      : [{ position: { x: 0, y: 0, w: 0, h: 0 }, text: '' }];
    if (typeof text !== 'string') {
      return blocks;
    }

    if (!blocks[0] || typeof blocks[0] !== 'object') {
      blocks[0] = { text: text };
      return blocks;
    }

    blocks[0].text = text;
    return blocks;
  }

  function normalizeFlowDefinitionInput(definition) {
    const source = definition && typeof definition === 'object' ? definition : {};
    return {
      nodes: ensureArray(source.nodes || source.shapes || source.elements).filter(function (item) {
        return item && typeof item === 'object' && item.name !== 'linker';
      }),
      edges: ensureArray(source.edges || source.linkers).filter(function (item) {
        return item && typeof item === 'object';
      }),
      meta: source.meta && typeof source.meta === 'object' ? cloneSimple(source.meta) : null,
    };
  }

  function getFlowStoreCandidates(model, designer) {
    const candidates = [];
    const push = function (value) {
      if (value && candidates.indexOf(value) === -1) {
        candidates.push(value);
      }
    };

    if (model) {
      push(model.define);
      push(model.definitions);
      push(model.definition);
      push(model.flowDefinition);
      push(model.data);
      push(model.root);
    }

    if (designer) {
      push(designer.define);
      push(designer.definition);
      push(designer.flowDefinition);
      push(designer.model);
    }

    return candidates;
  }

  function extractFlowElementMap(definitionSource) {
    if (!definitionSource || typeof definitionSource !== 'object') {
      return null;
    }

    if (definitionSource.elements && typeof definitionSource.elements === 'object') {
      return definitionSource.elements;
    }

    if (definitionSource.defs && typeof definitionSource.defs === 'object') {
      return definitionSource.defs;
    }

    if (definitionSource.shapeMap && typeof definitionSource.shapeMap === 'object') {
      return definitionSource.shapeMap;
    }

    return null;
  }

  function extractFlowElementList(definitionSource) {
    if (!definitionSource || typeof definitionSource !== 'object') {
      return [];
    }

    if (Array.isArray(definitionSource.elements)) {
      return definitionSource.elements;
    }

    if (Array.isArray(definitionSource.shapes)) {
      return definitionSource.shapes;
    }

    if (Array.isArray(definitionSource.list)) {
      return definitionSource.list;
    }

    const elementMap = extractFlowElementMap(definitionSource);
    if (elementMap) {
      return Object.keys(elementMap).map(function (key) {
        return elementMap[key];
      });
    }

    return [];
  }

  function cloneFlowElements(elements) {
    return ensureArray(elements)
      .map(function (item) {
        return cloneSimple(item);
      })
      .filter(Boolean);
  }

  function summarizeFlowDefinition(definition) {
    const normalized = normalizeFlowDefinitionInput(definition);
    return {
      nodesCount: normalized.nodes.length,
      edgesCount: normalized.edges.length,
      totalCount: normalized.nodes.length + normalized.edges.length,
      nodeLabels: normalized.nodes
        .map(function (node) {
          if (!node) {
            return null;
          }

          if (typeof node.text === 'string' && node.text.trim()) {
            return node.text.trim();
          }

          const textBlocks = ensureArray(node.textBlock);
          if (textBlocks[0] && typeof textBlocks[0].text === 'string') {
            return textBlocks[0].text.trim();
          }

          return node.title || node.name || null;
        })
        .filter(Boolean)
        .slice(0, 20),
    };
  }

  function buildFlowId(prefix) {
    return `${prefix || 'flow'}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
  }

  function ensureFlowElementId(element, utils, prefix) {
    if (element && element.id) {
      return element.id;
    }

    let generated = null;
    try {
      if (utils && typeof utils.newId === 'function') {
        generated = utils.newId();
      }
    } catch (error) {
      generated = null;
    }

    if (!generated) {
      generated = buildFlowId(prefix);
    }

    if (element && typeof element === 'object') {
      element.id = generated;
    }

    return generated;
  }

  function getFlowShapeAnchorPoint(shape, preferredOrder, fallbackRatioX, fallbackRatioY) {
    const anchors = ensureArray(shape && shape.anchors);
    const props = shape && shape.props ? shape.props : {};
    const x = typeof props.x === 'number' ? props.x : 0;
    const y = typeof props.y === 'number' ? props.y : 0;
    const w = typeof props.w === 'number' ? props.w : 160;
    const h = typeof props.h === 'number' ? props.h : 60;

    if (anchors.length > 0) {
      for (let index = 0; index < anchors.length; index += 1) {
        const anchor = anchors[index];
        if (anchor && anchor.x === preferredOrder.x && anchor.y === preferredOrder.y) {
          return {
            x: x + w * anchor.x,
            y: y + h * anchor.y,
            angle: typeof anchor.angle === 'number' ? anchor.angle : preferredOrder.angle,
          };
        }
      }

      const anchor = anchors[0];
      if (anchor) {
        return {
          x: x + w * anchor.x,
          y: y + h * anchor.y,
          angle: typeof anchor.angle === 'number' ? anchor.angle : preferredOrder.angle,
        };
      }
    }

    return {
      x: x + w * fallbackRatioX,
      y: y + h * fallbackRatioY,
      angle: preferredOrder.angle,
    };
  }

  function createFlowNodeElement(nodeInput, nodeIndex, model, utils) {
    const source = nodeInput && typeof nodeInput === 'object' ? cloneSimple(nodeInput) : {};
    if (source.definition && typeof source.definition === 'object') {
      const rawDefinition = cloneSimple(source.definition);
      ensureFlowElementId(rawDefinition, utils, 'shape');
      if (typeof source.text === 'string') {
        rawDefinition.textBlock = normalizeFlowTextBlocks(source.text, rawDefinition.textBlock);
      }
      return rawDefinition;
    }

    const shapeName = source.shape || source.shapeName || source.name || 'roundRectangle';
    const x = typeof source.x === 'number' ? source.x : 80 + (nodeIndex % 3) * 240;
    const y = typeof source.y === 'number' ? source.y : 80 + Math.floor(nodeIndex / 3) * 160;
    let element = null;

    try {
      if (model && typeof model.create === 'function') {
        element = model.create(shapeName, x, y);
      }
    } catch (error) {
      element = null;
    }

    if (!element || typeof element !== 'object') {
      element = {
        id: null,
        name: shapeName,
        title: source.title || shapeName,
        props: {
          x: x,
          y: y,
          w: typeof source.w === 'number' ? source.w : 160,
          h: typeof source.h === 'number' ? source.h : 60,
          zindex: typeof source.zindex === 'number' ? source.zindex : nodeIndex + 1,
          angle: typeof source.angle === 'number' ? source.angle : 0,
        },
        anchors: [
          { x: 0.5, y: 0, angle: 4.71238898038469 },
          { x: 1, y: 0.5, angle: 0 },
          { x: 0.5, y: 1, angle: 1.5707963267948966 },
          { x: 0, y: 0.5, angle: 3.141592653589793 },
        ],
        textBlock: [{ text: '' }],
      };
    }

    ensureFlowElementId(element, utils, 'shape');
    element.name = shapeName;
    element.props = Object.assign({}, element.props || {}, source.props || {});
    if (typeof source.x === 'number') {
      element.props.x = source.x;
    }
    if (typeof source.y === 'number') {
      element.props.y = source.y;
    }
    if (typeof source.w === 'number') {
      element.props.w = source.w;
    }
    if (typeof source.h === 'number') {
      element.props.h = source.h;
    }
    if (typeof source.zindex === 'number') {
      element.props.zindex = source.zindex;
    }
    if (typeof source.angle === 'number') {
      element.props.angle = source.angle;
    }
    if (Array.isArray(source.anchors)) {
      element.anchors = cloneSimple(source.anchors);
    } else if (!Array.isArray(element.anchors) || element.anchors.length === 0) {
      element.anchors = [
        { x: 0.5, y: 0, angle: 4.71238898038469 },
        { x: 1, y: 0.5, angle: 0 },
        { x: 0.5, y: 1, angle: 1.5707963267948966 },
        { x: 0, y: 0.5, angle: 3.141592653589793 },
      ];
    }

    if (typeof source.text === 'string') {
      element.textBlock = normalizeFlowTextBlocks(source.text, element.textBlock);
    } else if (Array.isArray(source.textBlock)) {
      element.textBlock = cloneSimple(source.textBlock);
    } else {
      element.textBlock = normalizeFlowTextBlocks('', element.textBlock);
    }

    if (source.style && typeof source.style === 'object') {
      element.shapeStyle = Object.assign({}, element.shapeStyle || {}, cloneSimple(source.style));
    }

    if (source.lineStyle && typeof source.lineStyle === 'object') {
      element.lineStyle = Object.assign({}, element.lineStyle || {}, cloneSimple(source.lineStyle));
    }

    return element;
  }

  function createFlowLinkerElement(edgeInput, edgeIndex, nodeMap, utils) {
    const source = edgeInput && typeof edgeInput === 'object' ? cloneSimple(edgeInput) : {};
    if (source.definition && typeof source.definition === 'object') {
      const rawDefinition = cloneSimple(source.definition);
      ensureFlowElementId(rawDefinition, utils, 'linker');
      return rawDefinition;
    }

    const fromId =
      source.fromId ||
      (source.from && typeof source.from === 'object' ? source.from.id : source.from) ||
      source.sourceId ||
      source.source;
    const toId =
      source.toId ||
      (source.to && typeof source.to === 'object' ? source.to.id : source.to) ||
      source.targetId ||
      source.target;
    const fromNode = fromId ? nodeMap[fromId] : null;
    const toNode = toId ? nodeMap[toId] : null;
    const fromPoint =
      source.from && typeof source.from === 'object'
        ? Object.assign({}, source.from)
        : getFlowShapeAnchorPoint(fromNode, { x: 1, y: 0.5, angle: 0 }, 1, 0.5);
    const toPoint =
      source.to && typeof source.to === 'object'
        ? Object.assign({}, source.to)
        : getFlowShapeAnchorPoint(toNode, { x: 0, y: 0.5, angle: 3.141592653589793 }, 0, 0.5);

    return {
      id: ensureFlowElementId({}, utils, 'linker'),
      name: 'linker',
      linkerType: source.linkerType || 'broken',
      from: Object.assign({}, fromPoint, { id: fromNode ? fromNode.id : fromId || null }),
      to: Object.assign({}, toPoint, { id: toNode ? toNode.id : toId || null }),
      points: Array.isArray(source.points) ? cloneSimple(source.points) : [],
      props: Object.assign(
        {
          zindex: typeof source.zindex === 'number' ? source.zindex : 1000 + edgeIndex,
        },
        source.props || {}
      ),
      text:
        typeof source.text === 'string'
          ? source.text
          : typeof source.label === 'string'
            ? source.label
            : '',
      lineStyle: Object.assign({}, source.lineStyle || {}),
    };
  }

  function readFlowDefinition() {
    const model = getFlowModel();
    const designer = getFlowDesigner();
    const sources = getFlowStoreCandidates(model, designer);

    for (let index = 0; index < sources.length; index += 1) {
      const source = sources[index];
      if (!source || typeof source !== 'object') {
        continue;
      }

      const elements = extractFlowElementList(source);
      if (elements.length === 0) {
        continue;
      }

      const clonedElements = cloneFlowElements(elements);
      const nodes = clonedElements.filter(function (item) {
        return item && item.name !== 'linker';
      });
      const edges = clonedElements.filter(function (item) {
        return item && item.name === 'linker';
      });

      return {
        source: index === 0 ? 'model-primary' : `flow-store-${index + 1}`,
        elements: clonedElements,
        nodes: nodes,
        edges: edges,
        summary: summarizeFlowDefinition({
          nodes: nodes,
          edges: edges,
        }),
      };
    }

    return {
      source: 'unavailable',
      elements: [],
      nodes: [],
      edges: [],
      summary: summarizeFlowDefinition({ nodes: [], edges: [] }),
    };
  }

  async function beautifyFlow(options) {
    const designer = getFlowDesigner();
    const beautify = getFlowBeautify();
    const model = getFlowModel();
    const args = options && typeof options === 'object' ? options : {};
    const attempts = [];

    if (designer && typeof designer.beautify === 'function') {
      try {
        await resolveValue(designer.beautify(args));
        return {
          supported: true,
          strategy: 'Designer.beautify',
        };
      } catch (error) {
        attempts.push({
          strategy: 'Designer.beautify',
          error: error && error.message ? error.message : String(error),
        });
      }
    }

    if (beautify && typeof beautify.beautify === 'function') {
      try {
        await resolveValue(beautify.beautify(args));
        return {
          supported: true,
          strategy: 'Beautify.beautify',
        };
      } catch (error) {
        attempts.push({
          strategy: 'Beautify.beautify',
          error: error && error.message ? error.message : String(error),
        });
      }
    }

    if (model && typeof model.updateWithBeautify === 'function') {
      try {
        await resolveValue(model.updateWithBeautify([], null, args.theme || null));
        return {
          supported: true,
          strategy: 'Model.updateWithBeautify',
        };
      } catch (error) {
        attempts.push({
          strategy: 'Model.updateWithBeautify',
          error: error && error.message ? error.message : String(error),
        });
      }
    }

    return {
      supported: false,
      reason: attempts.length > 0 ? 'flow-beautify-execution-failed' : 'flow-beautify-api-not-detected',
      attempts: attempts,
    };
  }

  async function clearFlowCanvas() {
    const model = getFlowModel();
    if (!model) {
      return {
        supported: false,
        reason: 'flow-model-unavailable',
      };
    }

    const current = readFlowDefinition();
    if (!Array.isArray(current.elements) || current.elements.length === 0) {
      return {
        supported: true,
        removedCount: 0,
        writeStrategy: 'Model.remove',
      };
    }

    if (typeof model.remove === 'function') {
      await resolveValue(model.remove(current.elements, true));
      return {
        supported: true,
        removedCount: current.elements.length,
        writeStrategy: 'Model.remove',
      };
    }

    return {
      supported: false,
      reason: 'flow-remove-api-not-detected',
    };
  }

  async function addFlowElements(definition, options) {
    const model = getFlowModel();
    const designer = getFlowDesigner();
    const utils = getFlowUtils();

    if (!model) {
      return {
        supported: false,
        reason: 'flow-model-unavailable',
      };
    }

    const normalized = normalizeFlowDefinitionInput(definition);
    const args = options && typeof options === 'object' ? options : {};
    const nodeMap = {};
    const elements = [];

    normalized.nodes.forEach(function (node, index) {
      const element = createFlowNodeElement(node, index, model, utils);
      const aliases = [
        element.id,
        node.id,
        node.key,
        node.nameKey,
      ].filter(Boolean);

      aliases.forEach(function (alias) {
        nodeMap[alias] = element;
      });

      elements.push(element);
    });

    normalized.edges.forEach(function (edge, index) {
      const linker = createFlowLinkerElement(edge, index, nodeMap, utils);
      elements.push(linker);
    });

    if (elements.length === 0) {
      return {
        supported: false,
        reason: 'flow-definition-empty',
      };
    }

    if (typeof model.addMulti === 'function') {
      await resolveValue(model.addMulti(elements, !!args.silent, args.origin || null));
    } else if (typeof model.add === 'function') {
      for (let index = 0; index < elements.length; index += 1) {
        await resolveValue(model.add(elements[index]));
      }
    } else {
      return {
        supported: false,
        reason: 'flow-add-api-not-detected',
      };
    }

    if (designer && typeof designer.drawShape === 'function') {
      try {
        await resolveValue(designer.drawShape(elements));
      } catch (error) {
        // ignore draw refresh failures and rely on model state
      }
    }

    return {
      supported: true,
      writeStrategy: typeof model.addMulti === 'function' ? 'Model.addMulti' : 'Model.add',
      elementsCount: elements.length,
      nodesCount: normalized.nodes.length,
      edgesCount: normalized.edges.length,
    };
  }

  async function inspectFlowRuntime() {
    const flowWindow = getFlowEditorWindow();
    const model = getFlowModel();
    const designer = getFlowDesigner();
    const utils = getFlowUtils();
    const schema = getFlowSchema();
    const messageSource = getFlowMessageSource();
    const beautify = getFlowBeautify();
    const smartAiHelp = flowWindow ? flowWindow.smartAiHelpCon || null : null;
    const aiMito = flowWindow ? flowWindow.AIMITO || flowWindow.__AIMITO__ || null : null;
    const editorGlobalConfig = flowWindow ? flowWindow.editorGlobalConfig || null : null;

    return cleanObject({
      runtimeSource: flowWindow ? 'flow-iframe' : null,
      globalsPresent: flowWindow ? getGlobalsPresent(flowWindow) : [],
      flowGlobalsPresent: flowWindow
        ? [
            'Model',
            'Designer',
            'Utils',
            'Schema',
            'Dock',
            'UI',
            'Server',
            'MessageSource',
            'Beautify',
            'smartAiHelpCon',
            'AIMITO',
            '__AIMITO__',
          ].filter(function (key) {
            return typeof flowWindow[key] !== 'undefined';
          })
        : [],
      modelMethods: listFunctionKeys(model),
      designerMethods: listFunctionKeys(designer),
      utilsMethods: listFunctionKeys(utils),
      schemaMethods: listFunctionKeys(schema),
      messageSourceMethods: listFunctionKeys(messageSource),
      beautifyMethods: listFunctionKeys(beautify),
      smartAiHelpMethods: listFunctionKeys(smartAiHelp),
      aiMitoMethods: listFunctionKeys(aiMito),
      editorGlobalConfig: editorGlobalConfig
        ? cleanObject({
            showSmartGraph: editorGlobalConfig.showSmartGraph,
          })
        : null,
      definitionSummary: summarizeFlowDefinition(readFlowDefinition()),
    });
  }

  async function listFlowCapabilities() {
    const model = getFlowModel();
    const designer = getFlowDesigner();
    const currentDefinition = readFlowDefinition();
    const inspect = await inspectFlowRuntime();

    return {
      mode: 'flow',
      hasModel: !!model,
      hasDesigner: !!designer,
      canReadDefinition: !!model,
      canApplyDefinition: !!(model && (typeof model.addMulti === 'function' || typeof model.add === 'function')),
      canClearCanvas: !!(model && typeof model.remove === 'function'),
      canBeautify: !!(
        (designer && typeof designer.beautify === 'function') ||
        (model && typeof model.updateWithBeautify === 'function') ||
        (getFlowBeautify() && typeof getFlowBeautify().beautify === 'function')
      ),
      hasSmartAiEntry: !!(
        inspect &&
        ((Array.isArray(inspect.smartAiHelpMethods) && inspect.smartAiHelpMethods.length > 0) ||
          (inspect.editorGlobalConfig && inspect.editorGlobalConfig.showSmartGraph === true))
      ),
      currentDefinition: currentDefinition.summary,
    };
  }

  async function getDocumentApplication() {
    const runtimeMode = await detectRuntimeMode();
    if (runtimeMode !== 'document') {
      return null;
    }

    const app = await getEditorApplication();
    if (!app) {
      return null;
    }

    return ((await readProperty(app, 'ActiveDocument')) || (await readProperty(app, 'Document')))
      ? app
      : null;
  }

  async function getActiveDocument(app) {
    if (!app) {
      return null;
    }

    return (
      (await readPropertyOrCall(app, 'ActiveDocument')) ||
      (await readPropertyOrCall(app, 'Document')) ||
      null
    );
  }

  async function getActiveDocumentContent(activeDocument) {
    if (!activeDocument) {
      return null;
    }

    return (await readPropertyOrCall(activeDocument, 'Content')) || null;
  }

  async function getCurrentDocumentRange(activeDocument) {
    if (!activeDocument) {
      return null;
    }

    return (
      (await readPropertyOrCall(activeDocument, 'Range')) ||
      (await callMethod(activeDocument, 'GetDocumentRange')) ||
      null
    );
  }

  function escapeHtml(input) {
    return String(input)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/\"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function buildPasteHtml(text) {
    return escapeHtml(text).replace(/\r\n|\r|\n/g, '<br/>');
  }

  async function readDocumentText(app) {
    const documentApp = app || (await getDocumentApplication());
    const activeDocument = await getActiveDocument(documentApp);

    if (!activeDocument) {
      return null;
    }

    const content = (await getActiveDocumentContent(activeDocument)) || activeDocument;
    const text =
      (await readPropertyOrCall(content, 'Text')) ||
      (await readPropertyOrCall(activeDocument, 'Text')) ||
      null;

    return text === null || typeof text === 'undefined' ? null : safeString(text);
  }

  async function getDocumentSelectionTarget(app) {
    const documentApp = app || (await getDocumentApplication());
    if (!documentApp) {
      return null;
    }

    const activeDocument = await getActiveDocument(documentApp);

    return (
      (await readPropertyOrCall(documentApp, 'Selection')) ||
      (await callMethod(documentApp, 'getSelection')) ||
      (await readPropertyOrCall(activeDocument, 'Selection')) ||
      null
    );
  }

  async function getDocumentSelection(app) {
    const selection = await getDocumentSelectionTarget(app);
    if (!selection) {
      return null;
    }

    const text = (await readPropertyOrCall(selection, 'Text')) || '';
    const range =
      (await readPropertyOrCall(selection, 'Range')) ||
      (await callMethod(selection, 'GetRange')) ||
      null;
    const rawType =
      (await readPropertyOrCall(selection, 'Type')) ||
      (await readPropertyOrCall(selection, 'SelectionType')) ||
      null;
    const normalizedType = typeof rawType === 'string' && rawType.trim() ? rawType.trim() : null;
    const hasText = typeof text === 'string' && text.length > 0;
    const hasRange = !!range;
    const rangeCount =
      (await readPropertyOrCall(selection, 'RangeCount')) ||
      (hasRange ? 1 : hasText ? 1 : 0);
    const isCollapsed =
      typeof selection.isCollapsed === 'boolean'
        ? selection.isCollapsed
        : hasText
          ? false
          : hasRange
            ? true
            : undefined;
    const type =
      normalizedType ||
      (hasText ? 'Range' : hasRange ? 'Caret' : 'None');

    return cleanObject({
      text: safeString(text),
      type: type,
      isCollapsed: isCollapsed,
      rangeCount: typeof rangeCount === 'number' ? rangeCount : undefined,
      hasRange: hasRange,
    });
  }

  async function detectDocumentWriteTarget(app, options) {
    const documentApp = app || (await getDocumentApplication());
    const normalizedOptions = options && typeof options === 'object' ? options : {};
    const activeDocument = await getActiveDocument(documentApp);
    const selection = await getDocumentSelectionTarget(documentApp);
    const selectionInfo = await getDocumentSelection(documentApp);
    const selectionRange = selection ? (await readPropertyOrCall(selection, 'Range')) || null : null;
    const documentRange = await getCurrentDocumentRange(activeDocument);
    const documentContent = await getActiveDocumentContent(activeDocument);
    const selectionIsUsable =
      !!(
        selectionInfo &&
        (
          selectionInfo.hasRange === true ||
          (typeof selectionInfo.rangeCount === 'number' && selectionInfo.rangeCount > 0) ||
          (typeof selectionInfo.type === 'string' &&
            selectionInfo.type.toLowerCase() !== 'none')
        )
      );
    const candidates = [
      {
        strategy: 'Selection.TypeText',
        target: selection,
        method: 'TypeText',
        supportsInsert: true,
        supportsReplace: true,
      },
      {
        strategy: 'Selection.Range.TypeText',
        target: selectionRange,
        method: 'TypeText',
        supportsInsert: true,
        supportsReplace: true,
      },
      {
        strategy: 'Selection.Range.PasteHtml',
        target: selectionIsUsable ? selectionRange : null,
        method: 'PasteHtml',
        supportsInsert: true,
        supportsReplace: true,
        valueKind: 'html',
      },
      {
        strategy: 'Selection.Range.InsertAfter',
        target: selectionIsUsable ? selectionRange : null,
        method: 'InsertAfter',
        supportsInsert: true,
        supportsReplace: false,
      },
      {
        strategy: 'Selection.Range.SetText',
        target: selectionIsUsable ? selectionRange : null,
        method: 'SetText',
        supportsInsert: false,
        supportsReplace: true,
      },
      {
        strategy: 'Selection.InsertAfter',
        target: selectionIsUsable ? selection : null,
        method: 'InsertAfter',
        supportsInsert: true,
        supportsReplace: false,
      },
      {
        strategy: 'Selection.SetText',
        target: selectionIsUsable ? selection : null,
        method: 'SetText',
        supportsInsert: false,
        supportsReplace: true,
      },
      {
        strategy: 'ActiveDocument.Range.PasteHtml',
        target: documentRange,
        method: 'PasteHtml',
        supportsInsert: true,
        supportsReplace: true,
        valueKind: 'html',
      },
      {
        strategy: 'ActiveDocument.Content.PasteHtml',
        target: documentContent,
        method: 'PasteHtml',
        supportsInsert: true,
        supportsReplace: true,
        valueKind: 'html',
      },
      {
        strategy: 'ActiveDocument.Content.InsertAfter',
        target: documentContent,
        method: 'InsertAfter',
        supportsInsert: true,
        supportsReplace: false,
      },
    ];

    for (let index = 0; index < candidates.length; index += 1) {
      const candidate = candidates[index];
      if (!candidate.target) {
        continue;
      }

      if (
        normalizedOptions.preferredValueKind &&
        candidate.valueKind !== normalizedOptions.preferredValueKind
      ) {
        continue;
      }

      if (normalizedOptions.requireReplace === true && candidate.supportsReplace !== true) {
        continue;
      }

      if (normalizedOptions.requireInsert === true && candidate.supportsInsert !== true) {
        continue;
      }

      if (candidate.method && hasMethod(candidate.target, candidate.method)) {
        return candidate;
      }
    }

    return null;
  }

  async function inspectDocumentRuntime(app) {
    const documentApp = app || (await getDocumentApplication());
    const selection = await getDocumentSelectionTarget(documentApp);
    const activeDocument = await getActiveDocument(documentApp);
    const selectionRange = selection ? (await readPropertyOrCall(selection, 'Range')) || null : null;
    const documentContent = await getActiveDocumentContent(activeDocument);
    const writeTarget = await detectDocumentWriteTarget(documentApp);

    return cleanObject({
      hasApplication: !!documentApp,
      writeTarget: writeTarget
        ? cleanObject({
            strategy: writeTarget.strategy,
            method: writeTarget.method || null,
            property: writeTarget.property || null,
            valueKind: writeTarget.valueKind || 'plainText',
            supportsInsert: !!writeTarget.supportsInsert,
            supportsReplace: !!writeTarget.supportsReplace,
          })
        : null,
      appMethods: listFunctionKeys(documentApp),
      selectionMethods: listFunctionKeys(selection),
      selectionRangeMethods: listFunctionKeys(selectionRange),
      activeDocumentMethods: listFunctionKeys(activeDocument),
      documentContentMethods: listFunctionKeys(documentContent),
    });
  }

  async function inspectDocumentCommentRuntime(app) {
    const documentApp = app || (await getDocumentApplication());
    const activeDocument = await getActiveDocument(documentApp);
    const officeIframe = getOfficeIframeElement();
    const officeDocument = getIframeDocument(officeIframe);
    const ownKeys = activeDocument ? Object.getOwnPropertyNames(activeDocument) : [];
    const commentKeys = ownKeys.filter(function (key) {
      return /(comment|comments|review|revision|track|suggest)/i.test(key);
    });

    const commentDomHints = [];
    if (officeDocument && officeDocument.querySelectorAll) {
      const selectors = [
        '.comment-modal',
        '.comment-item',
        '.content.comment-text',
        '.cr-list',
        '.comment-panel-container',
      ];
      for (let index = 0; index < selectors.length; index += 1) {
        const selector = selectors[index];
        try {
          const count = officeDocument.querySelectorAll(selector).length;
          if (count > 0) {
            commentDomHints.push({ selector: selector, count: count });
          }
        } catch (error) {
          // ignore invalid selector/runtime access
        }
      }
    }

    return cleanObject({
      hasApplication: !!documentApp,
      hasOfficeIframe: !!officeIframe,
      activeDocumentCommentKeys: commentKeys,
      hasCommentApi:
        commentKeys.length > 0 ||
        (activeDocument &&
          (hasMethod(activeDocument, 'GetComments') ||
            hasMethod(activeDocument, 'Comments') ||
            hasMethod(activeDocument, 'HasComments'))),
      commentDomHints: commentDomHints,
    });
  }

  async function readVisibleDocumentComments() {
    const officeIframe = getOfficeIframeElement();
    const officeDocument = getIframeDocument(officeIframe);
    const documentApp = await getDocumentApplication();
    const selectionInfo = await getDocumentSelection(documentApp);
    const activeAnchorText =
      selectionInfo && typeof selectionInfo.text === 'string' ? selectionInfo.text : '';

    if (!officeDocument || !officeDocument.querySelectorAll) {
      return [];
    }

    const items = Array.from(officeDocument.querySelectorAll('.comment-item'));
    return collectCommentEntries(items, new Set(), {
      activeAnchorText: activeAnchorText,
    });
  }

  async function collectDocumentComments(options) {
    const officeIframe = getOfficeIframeElement();
    const officeDocument = getIframeDocument(officeIframe);
    const documentApp = await getDocumentApplication();
    const selectionInfo = await getDocumentSelection(documentApp);
    const activeAnchorText =
      selectionInfo && typeof selectionInfo.text === 'string' ? selectionInfo.text : '';

    if (!officeDocument || !officeDocument.querySelectorAll) {
      return {
        comments: [],
        scan: {
          attempted: false,
          scannedContainers: 0,
          steps: 0,
        },
      };
    }

    const config = options && typeof options === 'object' ? options : {};
    const settleMs =
      typeof config.settleMs === 'number' && config.settleMs >= 0 ? config.settleMs : 48;
    const maxSteps =
      typeof config.maxSteps === 'number' && config.maxSteps > 0 ? Math.floor(config.maxSteps) : 40;
    const stepRatio =
      typeof config.stepRatio === 'number' && config.stepRatio > 0 ? config.stepRatio : 0.8;
    const containers = getCommentScrollContainers(officeDocument);
    const seen = new Set();
    let comments = collectCommentEntries(
      Array.from(officeDocument.querySelectorAll('.comment-item')),
      seen,
      { activeAnchorText: activeAnchorText }
    );
    let steps = 0;

    for (let index = 0; index < containers.length; index += 1) {
      const container = containers[index];
      const originalTop = typeof container.scrollTop === 'number' ? container.scrollTop : 0;
      const clientHeight = typeof container.clientHeight === 'number' ? container.clientHeight : 0;
      const scrollHeight = typeof container.scrollHeight === 'number' ? container.scrollHeight : 0;
      const maxScrollTop = Math.max(0, scrollHeight - clientHeight);
      if (maxScrollTop <= 0 || clientHeight <= 0) {
        continue;
      }

      const stepSize = Math.max(120, Math.floor(clientHeight * stepRatio));

      for (let top = 0; top <= maxScrollTop && steps < maxSteps; top += stepSize) {
        if (typeof container.scrollTo === 'function') {
          try {
            container.scrollTo(0, top);
          } catch (error) {
            container.scrollTop = top;
          }
        } else {
          container.scrollTop = top;
        }
        await delay(settleMs);
        comments = comments.concat(
          collectCommentEntries(Array.from(officeDocument.querySelectorAll('.comment-item')), seen, {
            activeAnchorText: activeAnchorText,
          })
        );
        steps += 1;
      }

      if (steps < maxSteps && maxScrollTop > 0) {
        if (typeof container.scrollTo === 'function') {
          try {
            container.scrollTo(0, maxScrollTop);
          } catch (error) {
            container.scrollTop = maxScrollTop;
          }
        } else {
          container.scrollTop = maxScrollTop;
        }
        await delay(settleMs);
        comments = comments.concat(
          collectCommentEntries(Array.from(officeDocument.querySelectorAll('.comment-item')), seen, {
            activeAnchorText: activeAnchorText,
          })
        );
        steps += 1;
      }

      if (typeof container.scrollTo === 'function') {
        try {
          container.scrollTo(0, originalTop);
        } catch (error) {
          container.scrollTop = originalTop;
        }
      } else {
        container.scrollTop = originalTop;
      }
      await delay(0);
    }

    return {
      comments: comments,
      scan: {
        attempted: containers.length > 0,
        scannedContainers: containers.length,
        steps: steps,
      },
    };
  }

  async function resolveDocumentFormatTarget(candidates) {
    for (let index = 0; index < candidates.length; index += 1) {
      const candidate = candidates[index];
      if (!candidate || !candidate.target) {
        continue;
      }

      const directValue = candidate.reader
        ? await candidate.reader(candidate.target)
        : await readPropertyOrCall(candidate.target, candidate.property);
      if (directValue) {
        return {
          source: candidate.source,
          target: directValue,
        };
      }
    }

    return null;
  }

  function supportsAnySetter(target, methods, properties) {
    if (!target) {
      return false;
    }

    const methodList = Array.isArray(methods) ? methods : [];
    const propertyList = Array.isArray(properties) ? properties : [];

    for (let index = 0; index < methodList.length; index += 1) {
      if (hasMethod(target, methodList[index])) {
        return true;
      }
    }

    for (let index = 0; index < propertyList.length; index += 1) {
      try {
        if (typeof target[propertyList[index]] !== 'undefined') {
          return true;
        }
      } catch (error) {
        // ignore inaccessible getter
      }
    }

    return false;
  }

  async function inspectDocumentFormatRuntime(app) {
    const runtimeSource = detectRuntimeSource();
    const runtimeWindow = runtimeSource.windowRef || null;
    const documentApp = app || (await getDocumentApplication());
    const selection = await getDocumentSelectionTarget(documentApp);
    const activeDocument = await getActiveDocument(documentApp);
    const selectionRange = selection ? (await readPropertyOrCall(selection, 'Range')) || null : null;
    const activeDocumentContent = await getActiveDocumentContent(activeDocument);
    const keywordPattern = /(command|editor|toolbar|style|format|paragraph|font|align|indent|line|exec)/i;
    const sdkObjects = [
      { name: 'WebOfficeSDK', target: runtimeWindow ? runtimeWindow.WebOfficeSDK : null },
      { name: 'wpsSDK', target: runtimeWindow ? runtimeWindow.wpsSDK : null },
      { name: 'WPSInstance', target: runtimeWindow ? runtimeWindow.WPSInstance : null },
      { name: 'KSO', target: runtimeWindow ? runtimeWindow.KSO : null },
    ]
      .filter(function (entry) {
        return !!entry.target;
      })
      .map(function (entry) {
        return cleanObject({
          name: entry.name,
          ownKeys: filterInterestingKeys(listOwnKeys(entry.target), keywordPattern, 40),
          methods: filterInterestingKeys(listFunctionKeys(entry.target), keywordPattern, 40),
        });
      });

    const fontTarget = await resolveDocumentFormatTarget([
      {
        source: 'Selection.Font',
        target: selection,
        property: 'Font',
      },
      {
        source: 'Selection.getFont()',
        target: selection,
        reader(target) {
          return callMethod(target, 'getFont');
        },
      },
      {
        source: 'Selection.Range.Font',
        target: selectionRange,
        property: 'Font',
      },
      {
        source: 'Selection.Range.getFont()',
        target: selectionRange,
        reader(target) {
          return callMethod(target, 'getFont');
        },
      },
      {
        source: 'ActiveDocument.Content.Font',
        target: activeDocumentContent,
        property: 'Font',
      },
    ]);

    const paragraphFormatTarget = await resolveDocumentFormatTarget([
      {
        source: 'Selection.ParagraphFormat',
        target: selection,
        property: 'ParagraphFormat',
      },
      {
        source: 'Selection.Range.ParagraphFormat',
        target: selectionRange,
        property: 'ParagraphFormat',
      },
      {
        source: 'ActiveDocument.Content.ParagraphFormat',
        target: activeDocumentContent,
        property: 'ParagraphFormat',
      },
    ]);

    const styleTarget = await resolveDocumentFormatTarget([
      {
        source: 'Selection.Style',
        target: selection,
        property: 'Style',
      },
      {
        source: 'Selection.Range.Style',
        target: selectionRange,
        property: 'Style',
      },
      {
        source: 'ActiveDocument.Style',
        target: activeDocument,
        property: 'Style',
      },
    ]);

    const stylesCollectionTarget = await resolveDocumentFormatTarget([
      {
        source: 'ActiveDocument.Styles',
        target: activeDocument,
        property: 'Styles',
      },
      {
        source: 'ActiveDocument.getStyles()',
        target: activeDocument,
        reader(target) {
          return callMethod(target, 'getStyles');
        },
      },
    ]);

    return cleanObject({
      hasApplication: !!documentApp,
      runtimeSource: runtimeSource.label || null,
      runtimeGlobalsPresent: runtimeWindow ? getGlobalsPresent(runtimeWindow) : [],
      windowCommandHints: runtimeWindow
        ? filterInterestingKeys(listOwnKeys(runtimeWindow), keywordPattern, 60)
        : [],
      sdkObjects: sdkObjects,
      selectionSource: selection ? 'Selection' : null,
      selectionRangeSource: selectionRange ? 'Selection.Range' : null,
      selectionCommandHints: filterInterestingKeys(listFunctionKeys(selection), keywordPattern, 40),
      selectionRangeCommandHints: filterInterestingKeys(
        listFunctionKeys(selectionRange),
        keywordPattern,
        40
      ),
      activeDocumentCommandHints: filterInterestingKeys(
        listFunctionKeys(activeDocument),
        keywordPattern,
        40
      ),
      fontTarget: fontTarget
        ? cleanObject({
            source: fontTarget.source,
            methods: listFunctionKeys(fontTarget.target),
            canSetBold: supportsAnySetter(fontTarget.target, ['setBold'], ['Bold']),
            canSetItalic: supportsAnySetter(fontTarget.target, ['setItalic'], ['Italic']),
            canSetUnderline: supportsAnySetter(fontTarget.target, ['setUnderline'], ['Underline']),
            canSetStrikethrough: supportsAnySetter(fontTarget.target, ['setStrikethrough'], ['Strikethrough']),
            canSetSize: supportsAnySetter(fontTarget.target, ['setSize'], ['Size']),
            canSetName: supportsAnySetter(fontTarget.target, ['setName'], ['Name']),
            canSetColor: supportsAnySetter(fontTarget.target, ['setColor'], ['Color']),
          })
        : null,
      paragraphFormatTarget: paragraphFormatTarget
        ? cleanObject({
            source: paragraphFormatTarget.source,
            methods: listFunctionKeys(paragraphFormatTarget.target),
            canSetAlignment: supportsAnySetter(
              paragraphFormatTarget.target,
              ['setAlignment'],
              ['Alignment']
            ),
            canSetFirstLineIndent: supportsAnySetter(
              paragraphFormatTarget.target,
              ['setFirstLineIndent'],
              ['FirstLineIndent']
            ),
            canSetLeftIndent: supportsAnySetter(
              paragraphFormatTarget.target,
              ['setLeftIndent'],
              ['LeftIndent']
            ),
            canSetRightIndent: supportsAnySetter(
              paragraphFormatTarget.target,
              ['setRightIndent'],
              ['RightIndent']
            ),
            canSetLineSpacing: supportsAnySetter(
              paragraphFormatTarget.target,
              ['setLineSpacing', 'setLineSpacingRule'],
              ['LineSpacing', 'LineSpacingRule']
            ),
          })
        : null,
      styleTarget: styleTarget
        ? cleanObject({
            source: styleTarget.source,
            methods: listFunctionKeys(styleTarget.target),
          })
        : null,
      stylesCollectionTarget: stylesCollectionTarget
        ? cleanObject({
            source: stylesCollectionTarget.source,
            methods: listFunctionKeys(stylesCollectionTarget.target),
          })
        : null,
    });
  }

  async function listDocumentCapabilities() {
    const app = await getDocumentApplication();
    const bodyText = await readDocumentText(app);
    const selection = await getDocumentSelection(app);
    const writeTarget = await detectDocumentWriteTarget(app);
    const commentRuntime = await inspectDocumentCommentRuntime(app);

    return {
      mode: 'document',
      hasApplication: !!app,
      canReadBodyText: typeof bodyText === 'string',
      canReadSelection: !!(selection && typeof selection.text === 'string'),
      canReadComments: !!(
        commentRuntime &&
        (commentRuntime.hasCommentApi === true ||
          (Array.isArray(commentRuntime.commentDomHints) && commentRuntime.commentDomHints.length > 0))
      ),
      canInsertText: !!(writeTarget && writeTarget.supportsInsert),
      canReplaceSelection: !!(writeTarget && writeTarget.supportsReplace),
    };
  }

  async function insertDocumentText(text, app) {
    try {
      const documentApp = app || (await getDocumentApplication());
      const writeTarget = await detectDocumentWriteTarget(documentApp);

      if (!writeTarget || !writeTarget.supportsInsert) {
        return {
          supported: false,
          reason: 'document-write-api-not-detected',
        };
      }

      const writeValue = writeTarget.valueKind === 'html' ? buildPasteHtml(text) : text;

      if (writeTarget.method) {
        await callMethod(writeTarget.target, writeTarget.method, [writeValue]);
      } else if (writeTarget.property) {
        await setProperty(writeTarget.target, writeTarget.property, writeValue);
      }

      return {
        supported: true,
        writeStrategy: writeTarget.strategy,
      };
    } catch (error) {
      return {
        supported: false,
        reason: 'document-write-api-threw',
        details: error && error.message ? error.message : String(error),
      };
    }
  }

  async function replaceDocumentSelection(text, app) {
    try {
      const documentApp = app || (await getDocumentApplication());
      const writeTarget = await detectDocumentWriteTarget(documentApp);

      if (!writeTarget || !writeTarget.supportsReplace) {
        return {
          supported: false,
          reason: 'document-write-api-not-detected',
        };
      }

      const writeValue = writeTarget.valueKind === 'html' ? buildPasteHtml(text) : text;

      if (writeTarget.method) {
        await callMethod(writeTarget.target, writeTarget.method, [writeValue]);
      } else if (writeTarget.property) {
        await setProperty(writeTarget.target, writeTarget.property, writeValue);
      }

      return {
        supported: true,
        writeStrategy: writeTarget.strategy,
      };
    } catch (error) {
      return {
        supported: false,
        reason: 'document-write-api-threw',
        details: error && error.message ? error.message : String(error),
      };
    }
  }

  async function insertDocumentHtml(html, app) {
    try {
      const documentApp = app || (await getDocumentApplication());
      const writeTarget = await detectDocumentWriteTarget(documentApp, {
        preferredValueKind: 'html',
        requireInsert: true,
      });

      if (!writeTarget || !writeTarget.supportsInsert) {
        return {
          supported: false,
          reason: 'document-html-write-api-not-detected',
        };
      }

      if (writeTarget.method) {
        await callMethod(writeTarget.target, writeTarget.method, [html]);
      } else if (writeTarget.property) {
        await setProperty(writeTarget.target, writeTarget.property, html);
      }

      return {
        supported: true,
        writeStrategy: writeTarget.strategy,
      };
    } catch (error) {
      return {
        supported: false,
        reason: 'document-html-write-api-threw',
        details: error && error.message ? error.message : String(error),
      };
    }
  }

  async function replaceDocumentSelectionHtml(html, app) {
    try {
      const documentApp = app || (await getDocumentApplication());
      const writeTarget = await detectDocumentWriteTarget(documentApp, {
        preferredValueKind: 'html',
        requireReplace: true,
      });

      if (!writeTarget || !writeTarget.supportsReplace) {
        return {
          supported: false,
          reason: 'document-html-write-api-not-detected',
        };
      }

      if (writeTarget.method) {
        await callMethod(writeTarget.target, writeTarget.method, [html]);
      } else if (writeTarget.property) {
        await setProperty(writeTarget.target, writeTarget.property, html);
      }

      return {
        supported: true,
        writeStrategy: writeTarget.strategy,
      };
    } catch (error) {
      return {
        supported: false,
        reason: 'document-html-write-api-threw',
        details: error && error.message ? error.message : String(error),
      };
    }
  }

  async function getActiveWorkbook(app) {
    if (!app) {
      return null;
    }

    return (
      (await callMethod(app, 'getActiveBook')) ||
      (await readPropertyOrCall(app, 'ActiveWorkbook')) ||
      (await readPropertyOrCall(app, 'Workbook')) ||
      null
    );
  }

  async function getActiveSheet(app) {
    if (!app) {
      return null;
    }

    return (
      (await callMethod(app, 'getActiveSheet')) ||
      (await readPropertyOrCall(app, 'ActiveSheet')) ||
      null
    );
  }

  async function getWorkbookInfo(app) {
    const workbook = await getActiveWorkbook(app);
    const activeSheet = await getActiveSheet(app);
    return cleanObject({
      workbookName: workbook ? await readProperty(workbook, 'Name') : undefined,
      activeSheetName: activeSheet ? await readProperty(activeSheet, 'Name') : undefined,
      activeSheetIndex: activeSheet ? await readProperty(activeSheet, 'Index') : undefined,
    });
  }

  async function getSelectionRange(app) {
    if (!app) {
      return null;
    }

    return (
      (await callMethod(app, 'getSelectionRange')) ||
      (await readPropertyOrCall(app, 'Selection')) ||
      null
    );
  }

  async function getActiveCell(app) {
    if (!app) {
      return null;
    }

    return (await readPropertyOrCall(app, 'ActiveCell')) || (await getSelectionRange(app)) || null;
  }

  async function getRangeByAddress(app, address) {
    const sheet = await getActiveSheet(app);
    if (!sheet || !address) {
      return null;
    }

    return (
      (await callMethod(sheet, 'getRange', [address])) ||
      (await callMethod(sheet, 'Range', [address])) ||
      (await readPropertyOrCall(sheet, 'Range', [address])) ||
      null
    );
  }

  async function getRangeByCell(app, cell) {
    return getRangeByAddress(app, cell);
  }

  async function getUsedRange(app) {
    const sheet = await getActiveSheet(app);
    if (!sheet) {
      return null;
    }

    return (
      (await readPropertyOrCall(sheet, 'UsedRange')) ||
      (await callMethod(sheet, 'UsedRange')) ||
      null
    );
  }

  async function findText(app, input) {
    const usedRange = await getUsedRange(app);
    if (!usedRange || !input) {
      return null;
    }

    return (
      (await callMethod(usedRange, 'Find', [input])) ||
      (await callMethod(usedRange, 'find', [input])) ||
      null
    );
  }

  async function readRangeMatrix(range) {
    if (!range) {
      return null;
    }

    const value =
      (await callMethod(range, 'getValue2')) ||
      (await readProperty(range, 'Value2')) ||
      (await callMethod(range, 'getValue')) ||
      (await readProperty(range, 'Value')) ||
      null;
    return typeof value === 'undefined' ? null : value;
  }

  async function writeCellValue(range, rawValue) {
    const numericValue = typeof rawValue === 'number' ? rawValue : Number(rawValue);
    const normalizedValue =
      typeof rawValue === 'number' || !Number.isNaN(numericValue) ? numericValue : String(rawValue);

    if (hasMethod(range, 'setValue2')) {
      await callMethod(range, 'setValue2', [normalizedValue]);
      return { normalizedValue: normalizedValue, writeStrategy: 'setValue2' };
    }
    if (hasMethod(range, 'setValue')) {
      await callMethod(range, 'setValue', [normalizedValue]);
      return { normalizedValue: normalizedValue, writeStrategy: 'setValue' };
    }
    if (await setProperty(range, 'Value2', normalizedValue)) {
      return { normalizedValue: normalizedValue, writeStrategy: 'Value2' };
    }
    if (await setProperty(range, 'Value', normalizedValue)) {
      return { normalizedValue: normalizedValue, writeStrategy: 'Value' };
    }
    if (hasMethod(range, 'setText')) {
      await callMethod(range, 'setText', [String(normalizedValue)]);
      return { normalizedValue: normalizedValue, writeStrategy: 'setText' };
    }

    return null;
  }

  async function writeRangeMatrix(range, values) {
    if (!range) {
      return null;
    }

    if (hasMethod(range, 'setValues')) {
      await callMethod(range, 'setValues', [values]);
      return { writeStrategy: 'setValues', values: values };
    }

    const existingValues = await readProperty(range, 'Values');
    if (Array.isArray(existingValues) && (await setProperty(range, 'Values', values))) {
      return { writeStrategy: 'Values', values: values };
    }

    return null;
  }

  async function getRangeFormula(range) {
    return (await callMethod(range, 'getFormula')) || (await readProperty(range, 'Formula')) || null;
  }

  async function setRangeFormula(range, formula) {
    if (hasMethod(range, 'setFormula')) {
      await callMethod(range, 'setFormula', [formula]);
      return 'setFormula';
    }
    if (await setProperty(range, 'Formula', formula)) {
      return 'Formula';
    }
    return null;
  }

  async function getFontObject(range) {
    return (await callMethod(range, 'getFont')) || (await readProperty(range, 'Font')) || null;
  }

  async function getInteriorObject(range) {
    return (
      (await callMethod(range, 'getInterior')) ||
      (await readProperty(range, 'Interior')) ||
      null
    );
  }

  async function setRangeFont(range, input) {
    const font = await getFontObject(range);
    if (!font) {
      return false;
    }

    const mappings = [
      ['bold', 'Bold'],
      ['italic', 'Italic'],
      ['underline', 'Underline'],
      ['strikethrough', 'Strikethrough'],
      ['size', 'Size'],
      ['name', 'Name'],
      ['color', 'Color'],
    ];

    for (let index = 0; index < mappings.length; index += 1) {
      const pair = mappings[index];
      if (typeof input[pair[0]] === 'undefined') {
        continue;
      }
      const setterName = 'set' + pair[1];
      if (hasMethod(font, setterName)) {
        await callMethod(font, setterName, [input[pair[0]]]);
      } else {
        await setProperty(font, pair[1], input[pair[0]]);
      }
    }

    return true;
  }

  async function setRangeFill(range, input) {
    const interior = await getInteriorObject(range);
    if (!interior) {
      return false;
    }

    if (hasMethod(interior, 'setColor')) {
      await callMethod(interior, 'setColor', [input]);
      return true;
    }

    if (await setProperty(interior, 'Color', input)) {
      return true;
    }

    return false;
  }

  async function setRangeNumberFormat(range, format) {
    if (hasMethod(range, 'setNumberFormatLocal')) {
      await callMethod(range, 'setNumberFormatLocal', [format]);
      return 'setNumberFormatLocal';
    }
    if (hasMethod(range, 'setNumberFormat')) {
      await callMethod(range, 'setNumberFormat', [format]);
      return 'setNumberFormat';
    }
    if (await setProperty(range, 'NumberFormat', format)) {
      return 'NumberFormat';
    }
    return null;
  }

  async function setRangeWrapText(range, wrapText) {
    if (hasMethod(range, 'setWrapText')) {
      await callMethod(range, 'setWrapText', [wrapText]);
      return 'setWrapText';
    }
    if (await setProperty(range, 'WrapText', wrapText)) {
      return 'WrapText';
    }
    return null;
  }

  async function writeWithFallback(target, methods, properties, value) {
    const methodList = Array.isArray(methods) ? methods : [];
    const propertyList = Array.isArray(properties) ? properties : [];

    for (let index = 0; index < methodList.length; index += 1) {
      const methodName = methodList[index];
      if (!hasMethod(target, methodName)) {
        continue;
      }
      await callMethod(target, methodName, [value]);
      return methodName;
    }

    for (let index = 0; index < propertyList.length; index += 1) {
      const propertyName = propertyList[index];
      if (await setProperty(target, propertyName, value)) {
        return propertyName;
      }
    }

    return null;
  }

  async function setRangeAlignment(range, options) {
    if (!range || !options || typeof options !== 'object') {
      return null;
    }

    const mappings = [
      {
        input: 'horizontal',
        methods: ['setHorizontalAlignment'],
        properties: ['HorizontalAlignment'],
      },
      {
        input: 'vertical',
        methods: ['setVerticalAlignment'],
        properties: ['VerticalAlignment'],
      },
      {
        input: 'wrapText',
        methods: ['setWrapText'],
        properties: ['WrapText'],
      },
      {
        input: 'shrinkToFit',
        methods: ['setShrinkToFit'],
        properties: ['ShrinkToFit'],
      },
      {
        input: 'indent',
        methods: ['setIndentLevel', 'setIndent'],
        properties: ['IndentLevel', 'Indent'],
      },
      {
        input: 'textRotation',
        methods: ['setOrientation', 'setTextRotation'],
        properties: ['Orientation', 'TextRotation'],
      },
    ];

    let appliedCount = 0;

    for (let index = 0; index < mappings.length; index += 1) {
      const mapping = mappings[index];
      if (typeof options[mapping.input] === 'undefined') {
        continue;
      }

      const strategy = await writeWithFallback(
        range,
        mapping.methods,
        mapping.properties,
        options[mapping.input]
      );

      if (!strategy) {
        return null;
      }

      appliedCount += 1;
    }

    return appliedCount > 0 ? 'range-alignment-properties' : null;
  }

  function resolveBorderEdges(options) {
    if (!options || typeof options !== 'object') {
      return null;
    }

    if (options.edges && typeof options.edges === 'object') {
      const edgeKeys = [
        'top',
        'bottom',
        'left',
        'right',
        'insideHorizontal',
        'insideVertical',
      ];
      const output = {};

      edgeKeys.forEach(function (key) {
        if (options.edges[key] === true) {
          output[key] = true;
        }
      });

      return Object.keys(output).length > 0 ? output : null;
    }

    switch (options.preset) {
      case 'outer':
        return { top: true, bottom: true, left: true, right: true };
      case 'inner':
        return { insideHorizontal: true, insideVertical: true };
      case 'horizontal':
        return { insideHorizontal: true };
      case 'vertical':
        return { insideVertical: true };
      case 'all':
        return {
          top: true,
          bottom: true,
          left: true,
          right: true,
          insideHorizontal: true,
          insideVertical: true,
        };
      default:
        return null;
    }
  }

  async function applyBorderStyle(target, options) {
    if (!target || !options || typeof options !== 'object') {
      return false;
    }

    let appliedCount = 0;
    const properties = [
      {
        input: 'style',
        methods: ['setLineStyle'],
        properties: ['LineStyle'],
      },
      {
        input: 'weight',
        methods: ['setWeight'],
        properties: ['Weight'],
      },
      {
        input: 'color',
        methods: ['setColor'],
        properties: ['Color'],
      },
    ];

    for (let index = 0; index < properties.length; index += 1) {
      const entry = properties[index];
      if (typeof options[entry.input] === 'undefined') {
        continue;
      }

      const strategy = await writeWithFallback(
        target,
        entry.methods,
        entry.properties,
        options[entry.input]
      );

      if (!strategy) {
        return false;
      }

      appliedCount += 1;
    }

    return appliedCount > 0;
  }

  function normalizeBorderLineStyle(style) {
    if (typeof style === 'string' && style) {
      return style;
    }

    switch (style) {
      case 1:
        return 'solid';
      case 2:
        return 'dashed';
      case 3:
        return 'dotted';
      case 4:
        return 'double';
      default:
        return null;
    }
  }

  function normalizeBorderWeight(weight) {
    if (typeof weight === 'number' && Number.isFinite(weight)) {
      return weight;
    }

    switch (weight) {
      case 'thin':
        return 1;
      case 'medium':
        return 2;
      case 'thick':
        return 3;
      default:
        return null;
    }
  }

  function normalizeBorderOptions(options) {
    const source = options && typeof options === 'object' ? options : {};
    const hasExplicitStyle =
      typeof source.style !== 'undefined' ||
      typeof source.weight !== 'undefined' ||
      typeof source.color !== 'undefined';

    const normalized = Object.assign({}, source);
    if (!hasExplicitStyle && (source.preset || source.edges)) {
      normalized.style = 'solid';
      normalized.color = '#D9D9D9';
    }

    return normalized;
  }

  async function callBorderMethod(target, methodName, argsList) {
    if (!hasMethod(target, methodName)) {
      return null;
    }

    for (let index = 0; index < argsList.length; index += 1) {
      const args = argsList[index];
      const result = await callMethod(target, methodName, args);
      if (typeof result !== 'undefined') {
        return methodName + '(' + args.length + ')';
      }
    }

    return null;
  }

  async function applyRangeSetBorder(range, options, edges) {
    if (!hasMethod(range, 'SetBorder') || !edges) {
      return null;
    }

    const lineStyle = normalizeBorderLineStyle(options.style);
    const color = typeof options.color === 'string' && options.color ? options.color : null;
    const callArgs = function (category) {
      const variants = [];
      if (lineStyle && color) {
        variants.push([category, lineStyle, color]);
      }
      if (lineStyle) {
        variants.push([category, lineStyle]);
      }
      variants.push([category]);
      return variants;
    };

    const categories = [];
    if (edges.top && edges.bottom && edges.left && edges.right) {
      categories.push('outside');
    } else {
      if (edges.left) {
        categories.push('left');
      }
      if (edges.top) {
        categories.push('top');
      }
      if (edges.bottom) {
        categories.push('bottom');
      }
      if (edges.right) {
        categories.push('right');
      }
    }

    if (edges.insideHorizontal && edges.insideVertical) {
      categories.push('inside');
    }

    if (!categories.length) {
      return null;
    }

    let appliedCount = 0;
    for (let index = 0; index < categories.length; index += 1) {
      const strategy = await callBorderMethod(range, 'SetBorder', callArgs(categories[index]));
      if (!strategy) {
        return null;
      }
      appliedCount += 1;
    }

    return appliedCount > 0 ? 'Range.SetBorder' : null;
  }

  async function applyRangeBorderAround(range, options, edges) {
    if (!hasMethod(range, 'BorderAround') || !edges) {
      return null;
    }

    const isOuterOnly =
      edges.top === true &&
      edges.bottom === true &&
      edges.left === true &&
      edges.right === true &&
      edges.insideHorizontal !== true &&
      edges.insideVertical !== true;

    if (!isOuterOnly) {
      return null;
    }

    const lineStyle = options.style;
    const weight = normalizeBorderWeight(options.weight);
    const color = typeof options.color === 'string' && options.color ? options.color : null;
    const argsList = [[]];

    if (typeof lineStyle !== 'undefined') {
      argsList.push([lineStyle]);
    }
    if (typeof lineStyle !== 'undefined' && weight !== null) {
      argsList.push([lineStyle, weight]);
    }
    if (typeof lineStyle !== 'undefined' && weight !== null && color) {
      argsList.push([lineStyle, weight, color]);
    }

    const strategy = await callBorderMethod(range, 'BorderAround', argsList.reverse());
    return strategy ? 'Range.BorderAround' : null;
  }

  async function setRangeBorder(range, options) {
    if (!range || !options || typeof options !== 'object') {
      return null;
    }

    const normalizedOptions = normalizeBorderOptions(options);
    const edges = resolveBorderEdges(normalizedOptions);

    const setBorderStrategy = await applyRangeSetBorder(range, normalizedOptions, edges);
    if (setBorderStrategy) {
      return setBorderStrategy;
    }

    const borderAroundStrategy = await applyRangeBorderAround(range, normalizedOptions, edges);
    if (borderAroundStrategy) {
      return borderAroundStrategy;
    }

    const borders =
      (await readProperty(range, 'Borders')) || (await callMethod(range, 'getBorders')) || null;

    if (!borders) {
      return null;
    }

    const edgeIndexMap = {
      left: 7,
      top: 8,
      bottom: 9,
      right: 10,
      insideVertical: 11,
      insideHorizontal: 12,
    };

    if (edges) {
      const edgeNames = Object.keys(edges);
      if (!edgeNames.length) {
        return null;
      }

      if (hasMethod(borders, 'Item')) {
        for (let index = 0; index < edgeNames.length; index += 1) {
          const edgeName = edgeNames[index];
          const border = await callMethod(borders, 'Item', [edgeIndexMap[edgeName]]);
          if (!border) {
            return null;
          }
          if (!(await applyBorderStyle(border, normalizedOptions))) {
            return null;
          }
        }
        return 'Range.Borders';
      }
    }

    return (await applyBorderStyle(borders, normalizedOptions)) ? 'Range.Borders' : null;
  }

  async function insertRows(range, count, position, options) {
    const normalizedCount = Number.isFinite(count) ? Math.floor(count) : 0;
    if (!range || normalizedCount < 1) {
      return null;
    }

    const entireRow = (await readProperty(range, 'EntireRow')) || range;
    const normalizedPosition = position === 'after' ? 'after' : 'before';
    let insertTarget = entireRow;

    if (normalizedPosition === 'after') {
      insertTarget =
        (await callMethod(entireRow, 'Offset', [1, 0])) ||
        (await callMethod(range, 'Offset', [1, 0])) ||
        entireRow;
    }

    const methodName = hasMethod(insertTarget, 'Insert')
      ? 'Insert'
      : hasMethod(insertTarget, 'insert')
        ? 'insert'
        : null;

    if (!methodName) {
      return null;
    }

    for (let index = 0; index < normalizedCount; index += 1) {
      await callMethod(insertTarget, methodName);
    }

    return {
      writeStrategy: (entireRow === range ? 'Range' : 'EntireRow') + '.' + methodName,
      count: normalizedCount,
      position: normalizedPosition,
      copyFormatFrom:
        options && typeof options.copyFormatFrom === 'string' ? options.copyFormatFrom : 'none',
    };
  }

  async function sortRange(range, options) {
    const sorts =
      options && Array.isArray(options.sorts)
        ? options.sorts.filter(function (item) {
            return !!item && typeof item === 'object';
          })
        : [];

    if (!range || !sorts.length) {
      return null;
    }

    const header = options && typeof options.header !== 'undefined' ? options.header : undefined;

    if (hasMethod(range, 'Sort')) {
      await callMethod(range, 'Sort', [options]);
      return cleanObject({
        writeStrategy: 'Range.Sort',
        header: header,
        sorts: sorts,
      });
    }

    if (hasMethod(range, 'sort')) {
      await callMethod(range, 'sort', [options]);
      return cleanObject({
        writeStrategy: 'range.sort',
        header: header,
        sorts: sorts,
      });
    }

    const currentRegion = (await readProperty(range, 'CurrentRegion')) || null;
    if (currentRegion && hasMethod(currentRegion, 'Sort')) {
      await callMethod(currentRegion, 'Sort', [options]);
      return cleanObject({
        writeStrategy: 'CurrentRegion.Sort',
        header: header,
        sorts: sorts,
      });
    }

    const sortObject = (await readProperty(range, 'Sort')) || null;
    if (sortObject && hasMethod(sortObject, 'Apply')) {
      await callMethod(sortObject, 'Apply');
      return cleanObject({
        writeStrategy: 'Sort.Apply',
        header: header,
        sorts: sorts,
      });
    }

    return null;
  }

  async function mergeRange(range) {
    if (hasMethod(range, 'merge')) {
      await callMethod(range, 'merge');
      return 'merge';
    }
    if (hasMethod(range, 'Merge')) {
      await callMethod(range, 'Merge');
      return 'Merge';
    }
    return null;
  }

  async function unmergeRange(range) {
    if (hasMethod(range, 'unMerge')) {
      await callMethod(range, 'unMerge');
      return 'unMerge';
    }
    if (hasMethod(range, 'UnMerge')) {
      await callMethod(range, 'UnMerge');
      return 'UnMerge';
    }
    return null;
  }

  async function clearRangeContents(range) {
    if (hasMethod(range, 'clearContents')) {
      await callMethod(range, 'clearContents');
      return 'clearContents';
    }
    if (hasMethod(range, 'ClearContents')) {
      await callMethod(range, 'ClearContents');
      return 'ClearContents';
    }
    return null;
  }

  async function setRangeRowHeight(range, height) {
    if (hasMethod(range, 'setRowHeight')) {
      await callMethod(range, 'setRowHeight', [height]);
      return 'setRowHeight';
    }
    if (await setProperty(range, 'RowHeight', height)) {
      return 'RowHeight';
    }
    return null;
  }

  async function setRangeColumnWidth(range, width) {
    if (hasMethod(range, 'setColumnWidth')) {
      await callMethod(range, 'setColumnWidth', [width]);
      return 'setColumnWidth';
    }
    if (await setProperty(range, 'ColumnWidth', width)) {
      return 'ColumnWidth';
    }
    return null;
  }

  function summarizeDomSelection() {
    try {
      const selection = global.getSelection ? global.getSelection() : null;
      if (!selection) {
        return null;
      }

      return cleanObject({
        type: selection.type || null,
        isCollapsed: !!selection.isCollapsed,
        rangeCount: selection.rangeCount || 0,
        text: selection.toString ? selection.toString() : '',
      });
    } catch (error) {
      return {
        error: error && error.message ? error.message : String(error),
      };
    }
  }

  async function summarizeRange(range) {
    if (!range) {
      return null;
    }

    const text = (await callMethod(range, 'getText')) || (await readProperty(range, 'Text')) || null;
    const formula = await getRangeFormula(range);
    const value2 =
      (await callMethod(range, 'getActiveCellValue')) ||
      (await callMethod(range, 'getValue2')) ||
      (await readProperty(range, 'Value2'));
    const row = (await callMethod(range, 'getRow')) || (await readProperty(range, 'Row'));
    const column =
      (await callMethod(range, 'getColumn')) || (await readProperty(range, 'Column'));

    let rowsCount;
    let columnsCount;

    try {
      const rows =
        (await callMethod(range, 'getRows')) || (await resolveValue(range.Rows)) || undefined;
      rowsCount = (await callMethod(rows, 'getCount')) || (await readProperty(rows, 'Count'));
    } catch (error) {
      rowsCount = undefined;
    }

    try {
      const columns =
        (await callMethod(range, 'getColumns')) || (await resolveValue(range.Columns)) || undefined;
      columnsCount =
        (await callMethod(columns, 'getCount')) || (await readProperty(columns, 'Count'));
    } catch (error) {
      columnsCount = undefined;
    }

    const explicitAddress =
      (await callMethod(range, 'getAddress')) ||
      (await callMethod(range, 'getAddressLocal')) ||
      null;
    const address =
      typeof explicitAddress === 'string' && explicitAddress.indexOf('function') !== 0
        ? explicitAddress
        : buildA1Address(row, column, rowsCount, columnsCount);

    return cleanObject({
      address: safeString(address),
      text: safeString(text),
      formula: safeString(formula),
      value2: typeof value2 === 'undefined' ? null : value2,
      row: typeof row === 'number' ? row : undefined,
      column: typeof column === 'number' ? column : undefined,
      rowsCount: typeof rowsCount === 'number' ? rowsCount : undefined,
      columnsCount: typeof columnsCount === 'number' ? columnsCount : undefined,
    });
  }

  async function summarizeRuntimeSnapshot() {
    const runtimeSource = detectRuntimeSource();
    const flags = runtimeSource.flags;
    const runtimeMode = await detectRuntimeMode();
    const app = await getEditorApplication();
    const activeSheet = await getActiveSheet(app);
    const activeWorkbook = await getActiveWorkbook(app);
    const officeIframe = getOfficeIframeElement();

    return cleanObject({
      timestamp: new Date().toISOString(),
      location: detectDocumentIdentity(),
      runtimeMode: runtimeMode,
      runtimeFlags: flags,
      activeElement: cleanObject({
        tagName: document.activeElement ? document.activeElement.tagName : null,
        id: document.activeElement ? document.activeElement.id || null : null,
        className: document.activeElement ? safeString(document.activeElement.className) : null,
        role:
          document.activeElement && document.activeElement.getAttribute
            ? document.activeElement.getAttribute('role')
            : null,
      }),
      editor: cleanObject({
        appSource: flags.hasWPSOpenApi ? 'WPSOpenApi.Application' : flags.hasAPP ? 'APP' : null,
        runtimeSource: runtimeSource.label,
        runtimeMode: runtimeMode,
        activeWorkbookName: activeWorkbook ? await readProperty(activeWorkbook, 'Name') : undefined,
        activeSheetName: activeSheet ? await readProperty(activeSheet, 'Name') : undefined,
        activeSheetIndex: activeSheet ? await readProperty(activeSheet, 'Index') : undefined,
      }),
      domSelection: summarizeDomSelection(),
      officeIframe: summarizeIframe(officeIframe),
    });
  }

  global.__webeditRuntimeAdapter = {
    safeString: safeString,
    cleanObject: cleanObject,
    resolveValue: resolveValue,
    readProperty: readProperty,
    callMethod: callMethod,
    readPropertyOrCall: readPropertyOrCall,
    hasMethod: hasMethod,
    setProperty: setProperty,
    detectRuntimeSource: detectRuntimeSource,
    detectRuntimeMode: detectRuntimeMode,
    getRuntimeFlags: getRuntimeFlags,
    isRuntimeReady: isRuntimeReady,
    getGlobalsPresent: getGlobalsPresent,
    detectDocumentIdentity: detectDocumentIdentity,
    getEditorApplication: getEditorApplication,
    getFlowEditorWindow: getFlowEditorWindow,
    getFlowModel: getFlowModel,
    getFlowDesigner: getFlowDesigner,
    getFlowUtils: getFlowUtils,
    getFlowSchema: getFlowSchema,
    getFlowMessageSource: getFlowMessageSource,
    getDocumentApplication: getDocumentApplication,
    getActiveWorkbook: getActiveWorkbook,
    getActiveSheet: getActiveSheet,
    getWorkbookInfo: getWorkbookInfo,
    getSelectionRange: getSelectionRange,
    readDocumentText: readDocumentText,
    getDocumentSelection: getDocumentSelection,
    inspectDocumentRuntime: inspectDocumentRuntime,
    inspectDocumentFormatRuntime: inspectDocumentFormatRuntime,
    inspectDocumentCommentRuntime: inspectDocumentCommentRuntime,
    readVisibleDocumentComments: readVisibleDocumentComments,
    collectDocumentComments: collectDocumentComments,
    listDocumentCapabilities: listDocumentCapabilities,
    inspectFlowRuntime: inspectFlowRuntime,
    listFlowCapabilities: listFlowCapabilities,
    readFlowDefinition: readFlowDefinition,
    beautifyFlow: beautifyFlow,
    clearFlowCanvas: clearFlowCanvas,
    addFlowElements: addFlowElements,
    insertDocumentText: insertDocumentText,
    replaceDocumentSelection: replaceDocumentSelection,
    insertDocumentHtml: insertDocumentHtml,
    replaceDocumentSelectionHtml: replaceDocumentSelectionHtml,
    getActiveCell: getActiveCell,
    getRangeByAddress: getRangeByAddress,
    getRangeByCell: getRangeByCell,
    getUsedRange: getUsedRange,
    findText: findText,
    readRangeMatrix: readRangeMatrix,
    writeCellValue: writeCellValue,
    writeRangeMatrix: writeRangeMatrix,
    getRangeFormula: getRangeFormula,
    setRangeFormula: setRangeFormula,
    setRangeFont: setRangeFont,
    setRangeFill: setRangeFill,
    setRangeNumberFormat: setRangeNumberFormat,
    setRangeWrapText: setRangeWrapText,
    setRangeAlignment: setRangeAlignment,
    setRangeBorder: setRangeBorder,
    mergeRange: mergeRange,
    unmergeRange: unmergeRange,
    clearRangeContents: clearRangeContents,
    setRangeRowHeight: setRangeRowHeight,
    setRangeColumnWidth: setRangeColumnWidth,
    insertRows: insertRows,
    sortRange: sortRange,
    summarizeRange: summarizeRange,
    summarizeRuntimeSnapshot: summarizeRuntimeSnapshot,
    listFunctionKeys: listFunctionKeys,
    getOfficeIframeElement: getOfficeIframeElement,
  };
})(window);
