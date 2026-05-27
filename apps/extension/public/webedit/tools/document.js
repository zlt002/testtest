(function (global) {
  'use strict';

  if (global.__webeditDocumentTools) {
    return;
  }

  const DEFAULT_ERROR_CODES = {
    DOCUMENT_RUNTIME_NOT_READY: 'document_runtime_not_ready',
    DOCUMENT_MODE_NOT_DETECTED: 'document_mode_not_detected',
    DOCUMENT_SELECTION_UNAVAILABLE: 'document_selection_unavailable',
    DOCUMENT_TEXT_UNAVAILABLE: 'document_text_unavailable',
    DOCUMENT_WRITE_NOT_SUPPORTED: 'document_write_not_supported',
    DOCUMENT_WRITE_VERIFY_FAILED: 'document_write_verify_failed',
    INVALID_ARGUMENT: 'invalid_argument',
    TOOL_EXECUTION_FAILED: 'tool_execution_failed',
  };

  function resolveDeps(deps) {
    const source = deps && typeof deps === 'object' ? deps : {};
    const adapter = source.adapter || global.__webeditRuntimeAdapter || null;
    const helpers = source.helpers || global.__webeditResultHelpers || null;
    const registerTool = source.registerTool;

    if (!adapter) {
      throw new Error('WebEdit runtime adapter is not available');
    }

    if (!helpers) {
      throw new Error('WebEdit result helpers are not available');
    }

    if (typeof registerTool !== 'function') {
      throw new Error('registerTool is required');
    }

    return {
      adapter: adapter,
      helpers: helpers,
      registerTool: registerTool,
      errorCodes: Object.assign({}, DEFAULT_ERROR_CODES, source.errorCodes || {}),
    };
  }

  function isPromiseLike(value) {
    return !!value && typeof value.then === 'function';
  }

  async function resolveValue(value) {
    return isPromiseLike(value) ? await value : value;
  }

  function toNonEmptyString(value) {
    if (typeof value !== 'string') {
      return null;
    }

    const normalized = value.replace(/\u00a0/g, ' ').trim();
    return normalized ? normalized : null;
  }

  function pickDefined(source) {
    const input = source && typeof source === 'object' ? source : {};
    const output = {};

    Object.keys(input).forEach(function (key) {
      if (typeof input[key] !== 'undefined') {
        output[key] = input[key];
      }
    });

    return output;
  }

  function getDocumentIdentity(adapter) {
    if (adapter && typeof adapter.detectDocumentIdentity === 'function') {
      return adapter.detectDocumentIdentity() || {};
    }

    const location = global.location || {};
    return pickDefined({
      href: location.href || null,
      origin: location.origin || null,
      pathname: location.pathname || null,
      search: location.search || null,
      title: global.document && global.document.title ? global.document.title : null,
    });
  }

  async function detectDocumentMode(adapter) {
    if (adapter && typeof adapter.detectRuntimeMode === 'function') {
      const mode = await resolveValue(adapter.detectRuntimeMode());
      if (typeof mode === 'string' && mode) {
        return mode;
      }
    }

    const identity = getDocumentIdentity(adapter);
    const pathname =
      identity && typeof identity.pathname === 'string' ? identity.pathname.toLowerCase() : '';
    const href = identity && typeof identity.href === 'string' ? identity.href.toLowerCase() : '';

    if (pathname.indexOf('/document-cloud') !== -1 || href.indexOf('/document-cloud') !== -1) {
      return 'document';
    }

    return 'unknown';
  }

  async function getDocumentCapabilities(adapter, mode) {
    let declared = null;

    if (adapter && typeof adapter.listDocumentCapabilities === 'function') {
      declared = await resolveValue(adapter.listDocumentCapabilities());
    } else if (adapter && typeof adapter.getDocumentCapabilities === 'function') {
      declared = await resolveValue(adapter.getDocumentCapabilities());
    }

    const canReadSelection =
      !!(declared && declared.canReadSelection) ||
      typeof (adapter && adapter.getDocumentSelection) === 'function' ||
      typeof (adapter && adapter.summarizeDomSelection) === 'function' ||
      typeof global.getSelection === 'function';
    const canReadText =
      !!(declared && declared.canReadText) ||
      typeof (adapter && adapter.readDocumentText) === 'function' ||
      hasReadableDocumentBody();

    return {
      canReadText: mode === 'document' ? canReadText : false,
      canReadSelection: mode === 'document' ? canReadSelection : false,
      canReadComments:
        mode === 'document'
          ? !!(declared && declared.canReadComments) ||
            typeof (adapter && adapter.readVisibleDocumentComments) === 'function'
          : false,
      canInsertText: !!(declared && declared.canInsertText),
      canReplaceSelection: !!(declared && declared.canReplaceSelection),
    };
  }

  function hasReadableDocumentBody() {
    const documentRef = global.document;
    if (!documentRef) {
      return false;
    }

    const body = documentRef.body || null;
    return !!(
      body &&
      (toNonEmptyString(body.innerText) || toNonEmptyString(body.textContent))
    );
  }

  function buildModeError(helpers, errorCodes, mode) {
    return helpers.fail(new Error('Current runtime is not a document runtime'), {
      code: errorCodes.DOCUMENT_MODE_NOT_DETECTED,
      meta: { mode: mode },
    });
  }

  function buildRuntimeNotReadyError(helpers, errorCodes) {
    return helpers.fail(new Error('Document runtime is not ready'), {
      code: errorCodes.DOCUMENT_RUNTIME_NOT_READY,
    });
  }

  function ensureRuntimeReady(adapter, helpers, errorCodes) {
    if (adapter && typeof adapter.isRuntimeReady === 'function' && adapter.isRuntimeReady() !== true) {
      return buildRuntimeNotReadyError(helpers, errorCodes);
    }

    return null;
  }

  function ensureDocumentMode(helpers, errorCodes, mode) {
    if (mode === 'document') {
      return null;
    }

    return buildModeError(helpers, errorCodes, mode);
  }

  async function readSelectionFromAdapter(adapter) {
    let runtimeSelection = null;
    if (adapter && typeof adapter.getDocumentSelection === 'function') {
      const selection = await resolveValue(adapter.getDocumentSelection());
      if (selection) {
        runtimeSelection = normalizeSelection(selection, 'runtime-selection');
      }
    }

    let domSelection = null;
    if (adapter && typeof adapter.summarizeDomSelection === 'function') {
      const selection = await resolveValue(adapter.summarizeDomSelection());
      if (selection) {
        domSelection = normalizeSelection(selection, 'dom-selection');
      }
    }

    if (!domSelection && typeof global.getSelection === 'function') {
      try {
        const selection = global.getSelection();
        if (selection) {
          domSelection = normalizeSelection(
            {
              type: selection.type || null,
              isCollapsed: !!selection.isCollapsed,
              rangeCount: selection.rangeCount || 0,
              text: selection.toString ? selection.toString() : '',
            },
            'dom-selection'
          );
        }
      } catch (error) {
        return {
          source: 'dom-selection',
          error: error && error.message ? error.message : String(error),
        };
      }
    }

    if (runtimeSelection && domSelection) {
      const runtimeHasText =
        typeof runtimeSelection.text === 'string' && runtimeSelection.text.length > 0;
      const domHasText = typeof domSelection.text === 'string' && domSelection.text.length > 0;
      const preferDomSelection = domHasText && !runtimeHasText;

      return pickDefined({
        text: runtimeHasText ? runtimeSelection.text : domSelection.text,
        isCollapsed: preferDomSelection
          ? domSelection.isCollapsed
          : typeof runtimeSelection.isCollapsed === 'boolean'
            ? runtimeSelection.isCollapsed
            : domSelection.isCollapsed,
        rangeCount: preferDomSelection
          ? domSelection.rangeCount
          : typeof runtimeSelection.rangeCount === 'number'
            ? runtimeSelection.rangeCount
            : domSelection.rangeCount,
        type: preferDomSelection
          ? domSelection.type || runtimeSelection.type
          : runtimeSelection.type || domSelection.type,
        source: preferDomSelection
          ? domSelection.source || runtimeSelection.source
          : runtimeSelection.source || domSelection.source,
      });
    }

    return runtimeSelection || domSelection || null;
  }

  function normalizeSelection(selection, fallbackSource) {
    if (!selection || typeof selection !== 'object') {
      return null;
    }

    const text = toNonEmptyString(selection.text || selection.selectionText || '');
    return pickDefined({
      text: text || '',
      isCollapsed:
        typeof selection.isCollapsed === 'boolean'
          ? selection.isCollapsed
          : text
            ? false
            : undefined,
      rangeCount:
        typeof selection.rangeCount === 'number' ? selection.rangeCount : undefined,
      type: typeof selection.type === 'string' ? selection.type : undefined,
      source:
        typeof selection.source === 'string' && selection.source
          ? selection.source
          : fallbackSource,
      error: typeof selection.error === 'string' ? selection.error : undefined,
    });
  }

  function hasUsableDocumentSelection(selection) {
    if (!selection || typeof selection !== 'object') {
      return false;
    }

    if (typeof selection.rangeCount === 'number' && selection.rangeCount > 0) {
      return true;
    }

    if (typeof selection.type === 'string') {
      const normalizedType = selection.type.trim().toLowerCase();
      if (normalizedType && normalizedType !== 'none') {
        return true;
      }
    }

    return !!(
      typeof selection.text === 'string' &&
      selection.text.length > 0
    );
  }

  function countOccurrences(text, fragment) {
    if (
      typeof text !== 'string' ||
      typeof fragment !== 'string' ||
      !text ||
      !fragment
    ) {
      return 0;
    }

    let count = 0;
    let startIndex = 0;

    while (startIndex <= text.length) {
      const matchIndex = text.indexOf(fragment, startIndex);
      if (matchIndex === -1) {
        break;
      }

      count += 1;
      startIndex = matchIndex + fragment.length;
    }

    return count;
  }

  function canVerifyReplaceWrite(beforeSelection, beforeDocumentText, afterDocumentText, insertedText) {
    if (
      !beforeSelection ||
      typeof beforeSelection.text !== 'string' ||
      !beforeSelection.text ||
      !beforeDocumentText ||
      typeof beforeDocumentText.text !== 'string' ||
      !beforeDocumentText.text ||
      !afterDocumentText ||
      typeof afterDocumentText.text !== 'string' ||
      !afterDocumentText.text
    ) {
      return false;
    }

    const selectedText = beforeSelection.text;
    const beforeText = beforeDocumentText.text;
    const afterText = afterDocumentText.text;
    const expectedText = beforeText.replace(selectedText, insertedText);

    if (expectedText !== beforeText && afterText === expectedText) {
      return true;
    }

    if (afterText.indexOf(insertedText) === -1) {
      return false;
    }

    return countOccurrences(afterText, selectedText) < countOccurrences(beforeText, selectedText);
  }

  function canVerifyDeleteWrite(beforeSelection, beforeDocumentText, afterDocumentText) {
    if (
      !beforeDocumentText ||
      typeof beforeDocumentText.text !== 'string' ||
      !beforeDocumentText.text ||
      !afterDocumentText ||
      typeof afterDocumentText.text !== 'string'
    ) {
      return false;
    }

    const beforeText = beforeDocumentText.text;
    const afterText = afterDocumentText.text;

    if (afterText === beforeText || afterText.length >= beforeText.length) {
      return false;
    }

    if (
      beforeSelection &&
      typeof beforeSelection.text === 'string' &&
      beforeSelection.text
    ) {
      const selectedText = beforeSelection.text;
      const expectedText = beforeText.replace(selectedText, '');

      if (expectedText !== beforeText && afterText === expectedText) {
        return true;
      }

      return countOccurrences(afterText, selectedText) < countOccurrences(beforeText, selectedText);
    }

    return true;
  }

  function canVerifyInsertWrite(
    beforeSelection,
    afterSelection,
    beforeDocumentText,
    afterDocumentText,
    insertedText
  ) {
    const selectionChanged =
      JSON.stringify(beforeSelection || null) !== JSON.stringify(afterSelection || null);
    const documentTextChanged =
      JSON.stringify(beforeDocumentText || null) !== JSON.stringify(afterDocumentText || null);
    const selectionContainsText =
      !!(
        afterSelection &&
        typeof afterSelection.text === 'string' &&
        afterSelection.text.indexOf(insertedText) !== -1
      );
    const documentContainsText =
      !!(
        afterDocumentText &&
        typeof afterDocumentText.text === 'string' &&
        afterDocumentText.text.indexOf(insertedText) !== -1
      );

    return selectionChanged || documentTextChanged || selectionContainsText || documentContainsText;
  }

  async function readDocumentText(adapter) {
    if (adapter && typeof adapter.readDocumentText === 'function') {
      const runtimeText = await resolveValue(adapter.readDocumentText());
      const normalized = normalizeDocumentText(runtimeText, 'runtime-document-text');
      if (normalized) {
        return normalized;
      }
    }

    const documentRef = global.document;
    if (!documentRef) {
      return null;
    }

    const body = documentRef.body || null;
    if (!body) {
      return null;
    }

    const text = toNonEmptyString(body.innerText) || toNonEmptyString(body.textContent);
    if (!text) {
      return null;
    }

    return {
      text: text,
      source: 'document-body',
    };
  }

  function normalizeDocumentText(value, fallbackSource) {
    if (!value) {
      return null;
    }

    if (typeof value === 'string') {
      const text = toNonEmptyString(value);
      return text
        ? {
            text: text,
            source: fallbackSource,
          }
        : null;
    }

    if (typeof value === 'object') {
      const text = toNonEmptyString(value.text || value.documentText || value.content || '');
      if (!text) {
        return null;
      }

      return pickDefined({
        text: text,
        source:
          typeof value.source === 'string' && value.source ? value.source : fallbackSource,
        selectionAware:
          typeof value.selectionAware === 'boolean' ? value.selectionAware : undefined,
      });
    }

    return null;
  }

  function normalizeTextInput(args, options) {
    const input = args && typeof args === 'object' ? args : {};
    const allowEmpty = !!(options && options.allowEmpty === true);
    const rawText = typeof input.text === 'string' ? input.text.replace(/\u00a0/g, ' ') : null;
    const text = rawText === '' && allowEmpty ? '' : toNonEmptyString(rawText);

    if ((allowEmpty && rawText === null) || (!allowEmpty && !text)) {
      const error = new Error('text is required');
      error.code = DEFAULT_ERROR_CODES.INVALID_ARGUMENT;
      throw error;
    }

    return text;
  }

  function normalizeHtmlInput(args) {
    const input = args && typeof args === 'object' ? args : {};
    const html = typeof input.html === 'string' ? input.html.trim() : '';

    if (!html) {
      const error = new Error('html is required');
      error.code = DEFAULT_ERROR_CODES.INVALID_ARGUMENT;
      throw error;
    }

    return html;
  }

  function htmlToPlainText(html) {
    if (typeof html !== 'string' || !html) {
      return '';
    }

    return html
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/p>/gi, '\n')
      .replace(/<[^>]+>/g, '')
      .replace(/&nbsp;/gi, ' ')
      .replace(/&lt;/gi, '<')
      .replace(/&gt;/gi, '>')
      .replace(/&amp;/gi, '&')
      .replace(/\n{2,}/g, '\n')
      .trim();
  }

  async function performWrite(args, resolved, kind) {
    const adapter = resolved.adapter;
    const helpers = resolved.helpers;
    const errorCodes = resolved.errorCodes;
    let capabilityKey = kind === 'insert' ? 'canInsertText' : 'canReplaceSelection';
    let methodName = null;
    let mode = 'unknown';

    try {
      const runtimeError = ensureRuntimeReady(adapter, helpers, errorCodes);
      if (runtimeError) {
        return runtimeError;
      }
      mode = await detectDocumentMode(adapter);
      const modeError = ensureDocumentMode(helpers, errorCodes, mode);

      if (modeError) {
        return modeError;
      }

      const capabilities = await getDocumentCapabilities(adapter, mode);
      const text = normalizeTextInput(args, {
        allowEmpty: kind === 'replace',
      });
      const isDelete = kind === 'replace' && text === '';
      const beforeSelection = await readSelectionFromAdapter(adapter);
      const beforeDocumentText = await readDocumentText(adapter);
      if (kind === 'insert' && !hasUsableDocumentSelection(beforeSelection)) {
        return helpers.fail(new Error('Document cursor is unavailable'), {
          code: errorCodes.DOCUMENT_SELECTION_UNAVAILABLE,
          meta: {
            mode: mode,
            capability: capabilityKey,
          },
        });
      }

      if (
        kind === 'replace' &&
        !(
          hasUsableDocumentSelection(beforeSelection) &&
          (
            isDelete ||
            (
              beforeSelection &&
              typeof beforeSelection.text === 'string' &&
              beforeSelection.text.length > 0
            )
          )
        )
      ) {
        return helpers.fail(new Error('Document selection is unavailable'), {
          code: errorCodes.DOCUMENT_SELECTION_UNAVAILABLE,
          meta: {
            mode: mode,
            capability: capabilityKey,
          },
        });
      }

      const methodCandidates =
        kind === 'insert'
          ? ['insertTextAtCursor', 'insertDocumentText']
          : ['replaceSelectionText', 'replaceDocumentSelection'];
      methodName = methodCandidates.find(function (candidate) {
        return typeof adapter[candidate] === 'function';
      });

      if (!capabilities[capabilityKey] || !methodName) {
        return helpers.fail(new Error('Document write is not supported in the current runtime'), {
          code: errorCodes.DOCUMENT_WRITE_NOT_SUPPORTED,
          meta: {
            mode: mode,
            capability: capabilityKey,
          },
        });
      }

      const writeResult = await resolveValue(adapter[methodName](text));
      if (!writeResult || writeResult.supported === false) {
        return helpers.fail(new Error('Document write is not supported in the current runtime'), {
          code: errorCodes.DOCUMENT_WRITE_NOT_SUPPORTED,
          meta: {
            mode: mode,
            capability: capabilityKey,
            writeMethod: methodName,
            writeResult: writeResult || null,
          },
        });
      }

      const afterSelection = await readSelectionFromAdapter(adapter);
      const afterDocumentText = await readDocumentText(adapter);
      const selectionChanged =
        JSON.stringify(beforeSelection || null) !== JSON.stringify(afterSelection || null);
      const documentTextChanged =
        JSON.stringify(beforeDocumentText || null) !== JSON.stringify(afterDocumentText || null);
      const selectionContainsText =
        !!(
          afterSelection &&
          typeof afterSelection.text === 'string' &&
          afterSelection.text.indexOf(text) !== -1
        );
      const documentContainsText =
        !!(
          afterDocumentText &&
          typeof afterDocumentText.text === 'string' &&
          afterDocumentText.text.indexOf(text) !== -1
        );
      const replaceVerified =
        kind === 'replace'
          ? (isDelete
              ? canVerifyDeleteWrite(beforeSelection, beforeDocumentText, afterDocumentText)
              : canVerifyReplaceWrite(
                  beforeSelection,
                  beforeDocumentText,
                  afterDocumentText,
                  text
                ))
          : false;

      const writeVerified =
        kind === 'replace'
          ? replaceVerified
          : selectionChanged || documentTextChanged || selectionContainsText || documentContainsText;

      if (!writeVerified) {
        return helpers.fail(new Error('Document write could not be verified'), {
          code: errorCodes.DOCUMENT_WRITE_VERIFY_FAILED,
          meta: {
            mode: mode,
            capability: capabilityKey,
            writeMethod: methodName,
            writeResult: writeResult,
          },
        });
      }

      return helpers.ok({
        mode: mode,
        beforeSelection: beforeSelection,
        afterSelection: afterSelection,
        beforeDocumentText: beforeDocumentText,
        afterDocumentText: afterDocumentText,
        writeResult: writeResult,
        writeMethod: methodName,
      });
    } catch (error) {
      return helpers.fail(error, {
        code: errorCodes.TOOL_EXECUTION_FAILED,
        meta: {
          mode: mode,
          capability: capabilityKey,
          writeMethod: methodName,
        },
      });
    }
  }

  async function performRichReplace(args, resolved) {
    const adapter = resolved.adapter;
    const helpers = resolved.helpers;
    const errorCodes = resolved.errorCodes;
    let capabilityKey = 'canReplaceSelection';
    let methodName = null;
    let mode = 'unknown';
    let operation = 'replace-selection';

    try {
      const runtimeError = ensureRuntimeReady(adapter, helpers, errorCodes);
      if (runtimeError) {
        return runtimeError;
      }

      mode = await detectDocumentMode(adapter);
      const modeError = ensureDocumentMode(helpers, errorCodes, mode);
      if (modeError) {
        return modeError;
      }

      const capabilities = await getDocumentCapabilities(adapter, mode);
      const html = normalizeHtmlInput(args);
      const plainText = htmlToPlainText(html);
      const beforeSelection = await readSelectionFromAdapter(adapter);
      const beforeDocumentText = await readDocumentText(adapter);
      const hasSelection = hasUsableDocumentSelection(beforeSelection);
      const hasSelectedText =
        !!(
          hasSelection &&
          beforeSelection &&
          typeof beforeSelection.text === 'string' &&
          beforeSelection.text.length > 0
        );

      if (hasSelectedText) {
        capabilityKey = 'canReplaceSelection';
        operation = 'replace-selection';
        methodName =
          typeof adapter.replaceDocumentSelectionHtml === 'function'
            ? 'replaceDocumentSelectionHtml'
            : null;
      } else if (hasSelection) {
        capabilityKey = 'canInsertText';
        operation = 'insert-at-cursor';
        methodName =
          typeof adapter.insertDocumentHtml === 'function'
            ? 'insertDocumentHtml'
            : typeof adapter.replaceDocumentSelectionHtml === 'function'
              ? 'replaceDocumentSelectionHtml'
              : null;
      } else {
        capabilityKey = 'canReplaceSelection';
        operation = 'document-fallback';
        methodName =
          typeof adapter.replaceDocumentSelectionHtml === 'function'
            ? 'replaceDocumentSelectionHtml'
            : typeof adapter.insertDocumentHtml === 'function'
              ? 'insertDocumentHtml'
              : null;
      }

      const richWriteSupported =
        (capabilityKey === 'canReplaceSelection' && capabilities.canReplaceSelection) ||
        (capabilityKey === 'canInsertText' && capabilities.canInsertText) ||
        (operation === 'document-fallback' &&
          (capabilities.canReplaceSelection || capabilities.canInsertText));

      if (!richWriteSupported || !methodName) {
        return helpers.fail(new Error('Document rich text write is not supported in the current runtime'), {
          code: errorCodes.DOCUMENT_WRITE_NOT_SUPPORTED,
          meta: {
            mode: mode,
            capability: capabilityKey,
            operation: operation,
          },
        });
      }

      const writeResult = await resolveValue(adapter[methodName](html));
      if (!writeResult || writeResult.supported === false) {
        return helpers.fail(new Error('Document rich text write is not supported in the current runtime'), {
          code: errorCodes.DOCUMENT_WRITE_NOT_SUPPORTED,
          meta: {
            mode: mode,
            capability: capabilityKey,
            operation: operation,
            writeMethod: methodName,
            writeResult: writeResult || null,
          },
        });
      }

      const afterSelection = await readSelectionFromAdapter(adapter);
      const afterDocumentText = await readDocumentText(adapter);
      const replaceVerified =
        plainText && operation === 'replace-selection'
          ? canVerifyReplaceWrite(beforeSelection, beforeDocumentText, afterDocumentText, plainText)
          : false;
      const insertVerified = plainText
        ? canVerifyInsertWrite(
            beforeSelection,
            afterSelection,
            beforeDocumentText,
            afterDocumentText,
            plainText
          )
        : false;
      const writeVerified =
        operation === 'replace-selection'
          ? replaceVerified
          : insertVerified;

      if (!writeVerified) {
        return helpers.fail(new Error('Document rich text write could not be verified'), {
          code: errorCodes.DOCUMENT_WRITE_VERIFY_FAILED,
          meta: {
            mode: mode,
            capability: capabilityKey,
            operation: operation,
            writeMethod: methodName,
            writeResult: writeResult,
          },
        });
      }

      return helpers.ok({
        mode: mode,
        beforeSelection: beforeSelection,
        afterSelection: afterSelection,
        beforeDocumentText: beforeDocumentText,
        afterDocumentText: afterDocumentText,
        writeResult: writeResult,
        writeMethod: methodName,
        operation: operation,
        plainText: plainText,
      });
    } catch (error) {
      return helpers.fail(error, {
        code: errorCodes.TOOL_EXECUTION_FAILED,
        meta: {
          mode: mode,
          capability: capabilityKey,
          operation: operation,
          writeMethod: methodName,
        },
      });
    }
  }

  function registerDocumentTools(deps) {
    const resolved = resolveDeps(deps);
    const adapter = resolved.adapter;
    const helpers = resolved.helpers;
    const errorCodes = resolved.errorCodes;
    const registerTool = resolved.registerTool;

    registerTool(
      'webedit_get_document_context',
      '返回当前文档 runtime 的上下文、文档标识和能力探测结果。',
      {
        type: 'object',
        properties: {},
        additionalProperties: false,
      },
      async function () {
        const runtimeError = ensureRuntimeReady(adapter, helpers, errorCodes);
        if (runtimeError) {
          return runtimeError;
        }
        const mode = await detectDocumentMode(adapter);
        const modeError = ensureDocumentMode(helpers, errorCodes, mode);

        if (modeError) {
          return modeError;
        }

        return helpers.ok({
          runtimeReady:
            typeof adapter.isRuntimeReady === 'function' ? adapter.isRuntimeReady() : false,
          mode: mode,
          document: getDocumentIdentity(adapter),
          runtimeFlags:
            typeof adapter.getRuntimeFlags === 'function' ? adapter.getRuntimeFlags() : undefined,
          capabilities: await getDocumentCapabilities(adapter, mode),
        });
      }
    );

    registerTool(
      'webedit_get_document_selection',
      '返回当前文档选区或光标上下文。',
      {
        type: 'object',
        properties: {},
        additionalProperties: false,
      },
      async function () {
        const runtimeError = ensureRuntimeReady(adapter, helpers, errorCodes);
        if (runtimeError) {
          return runtimeError;
        }
        const mode = await detectDocumentMode(adapter);
        const modeError = ensureDocumentMode(helpers, errorCodes, mode);

        if (modeError) {
          return modeError;
        }

        const selection = await readSelectionFromAdapter(adapter);
        if (!selection) {
          return helpers.fail(new Error('Document selection is unavailable'), {
            code: errorCodes.DOCUMENT_SELECTION_UNAVAILABLE,
            meta: { mode: mode },
          });
        }

        return helpers.ok({
          mode: mode,
          selection: selection,
        });
      }
    );

    registerTool(
      'webedit_read_document_text',
      '读取当前文档正文文本，并标注文本来源。',
      {
        type: 'object',
        properties: {},
        additionalProperties: false,
      },
      async function () {
        const runtimeError = ensureRuntimeReady(adapter, helpers, errorCodes);
        if (runtimeError) {
          return runtimeError;
        }
        const mode = await detectDocumentMode(adapter);
        const modeError = ensureDocumentMode(helpers, errorCodes, mode);

        if (modeError) {
          return modeError;
        }

        const documentText = await readDocumentText(adapter);
        if (!documentText) {
          return helpers.fail(new Error('Document text is unavailable'), {
            code: errorCodes.DOCUMENT_TEXT_UNAVAILABLE,
            meta: { mode: mode },
          });
        }

        return helpers.ok({
          mode: mode,
          documentText: documentText,
        });
      }
    );

    registerTool(
      'webedit_debug_document_api',
      '返回当前文档 runtime 的写入能力与格式化能力探测结果，以及 Selection/Range/Document/Content 的方法表。',
      {
        type: 'object',
        properties: {},
        additionalProperties: false,
      },
      async function () {
        const runtimeError = ensureRuntimeReady(adapter, helpers, errorCodes);
        if (runtimeError) {
          return runtimeError;
        }
        const mode = await detectDocumentMode(adapter);
        const modeError = ensureDocumentMode(helpers, errorCodes, mode);

        if (modeError) {
          return modeError;
        }

        const capabilities = await getDocumentCapabilities(adapter, mode);
        const apiProbe =
          typeof adapter.inspectDocumentRuntime === 'function'
            ? await resolveValue(adapter.inspectDocumentRuntime())
            : null;
        const formatApiProbe =
          typeof adapter.inspectDocumentFormatRuntime === 'function'
            ? await resolveValue(adapter.inspectDocumentFormatRuntime())
            : null;

        return helpers.ok({
          mode: mode,
          document: getDocumentIdentity(adapter),
          runtimeFlags:
            typeof adapter.getRuntimeFlags === 'function' ? adapter.getRuntimeFlags() : undefined,
          capabilities: capabilities,
          apiProbe: apiProbe,
          formatApiProbe: formatApiProbe,
          commentApiProbe:
            typeof adapter.inspectDocumentCommentRuntime === 'function'
              ? await resolveValue(adapter.inspectDocumentCommentRuntime())
              : null,
        });
      }
    );

    registerTool(
      'webedit_get_visible_comments',
      '读取当前文档页面里已展示的评论内容，适合将评论上下文提供给 AI 做 PRD 调整。',
      {
        type: 'object',
        properties: {},
        additionalProperties: false,
      },
      async function () {
        const runtimeError = ensureRuntimeReady(adapter, helpers, errorCodes);
        if (runtimeError) {
          return runtimeError;
        }
        const mode = await detectDocumentMode(adapter);
        const modeError = ensureDocumentMode(helpers, errorCodes, mode);

        if (modeError) {
          return modeError;
        }

        const capabilities = await getDocumentCapabilities(adapter, mode);
        if (!capabilities.canReadComments || typeof adapter.readVisibleDocumentComments !== 'function') {
          return helpers.fail(new Error('Document comments are unavailable'), {
            code: errorCodes.DOCUMENT_TEXT_UNAVAILABLE,
            meta: {
              mode: mode,
              capability: 'canReadComments',
            },
          });
        }

        const comments = await resolveValue(adapter.readVisibleDocumentComments());
        return helpers.ok({
          mode: mode,
          comments: Array.isArray(comments) ? comments : [],
          count: Array.isArray(comments) ? comments.length : 0,
        });
      }
    );

    registerTool(
      'webedit_collect_document_comments',
      '通过自动滚动文档区域采集评论，适合评论按滚动位置懒加载的文档页。',
      {
        type: 'object',
        properties: {
          maxSteps: {
            type: 'number',
            description: '最多滚动采集的步数，默认 40。',
          },
          settleMs: {
            type: 'number',
            description: '每次滚动后的等待毫秒数，默认 48。',
          },
        },
        additionalProperties: false,
      },
      async function (args) {
        const runtimeError = ensureRuntimeReady(adapter, helpers, errorCodes);
        if (runtimeError) {
          return runtimeError;
        }
        const mode = await detectDocumentMode(adapter);
        const modeError = ensureDocumentMode(helpers, errorCodes, mode);

        if (modeError) {
          return modeError;
        }

        const capabilities = await getDocumentCapabilities(adapter, mode);
        if (!capabilities.canReadComments) {
          return helpers.fail(new Error('Document comments are unavailable'), {
            code: errorCodes.DOCUMENT_TEXT_UNAVAILABLE,
            meta: {
              mode: mode,
              capability: 'canReadComments',
            },
          });
        }

        const input = args && typeof args === 'object' ? args : {};
        const result =
          typeof adapter.collectDocumentComments === 'function'
            ? await resolveValue(
                adapter.collectDocumentComments({
                  maxSteps:
                    typeof input.maxSteps === 'number' ? input.maxSteps : undefined,
                  settleMs:
                    typeof input.settleMs === 'number' ? input.settleMs : undefined,
                })
              )
            : {
                comments:
                  typeof adapter.readVisibleDocumentComments === 'function'
                    ? await resolveValue(adapter.readVisibleDocumentComments())
                    : [],
                scan: {
                  attempted: false,
                  scannedContainers: 0,
                  steps: 0,
                },
              };

        const comments =
          result && Array.isArray(result.comments)
            ? result.comments
            : Array.isArray(result)
              ? result
              : [];
        const scan =
          result && result.scan && typeof result.scan === 'object'
            ? result.scan
            : {
                attempted: false,
                scannedContainers: 0,
                steps: 0,
              };

        return helpers.ok({
          mode: mode,
          comments: comments,
          count: comments.length,
          scan: scan,
        });
      }
    );

    registerTool(
      'webedit_insert_text_at_cursor',
      '在当前光标处插入文本；只有显式探测到写能力时才会执行。',
      {
        type: 'object',
        properties: {
          text: {
            type: 'string',
            description: '需要插入到光标位置的文本。',
          },
        },
        required: ['text'],
        additionalProperties: false,
      },
      async function (args) {
        return await performWrite(args, resolved, 'insert');
      }
    );

    registerTool(
      'webedit_replace_selection_text',
      '替换当前文档选区文本；只有显式探测到写能力时才会执行。',
      {
        type: 'object',
        properties: {
          text: {
            type: 'string',
            description: '用于替换当前选区的文本。',
          },
        },
        required: ['text'],
        additionalProperties: false,
      },
      async function (args) {
        return await performWrite(args, resolved, 'replace');
      }
    );

    registerTool(
      'webedit_replace_selection_rich_text',
      '用 HTML 富文本写入当前文档，优先替换选区，其次在光标插入，必要时回退到文档级写入。',
      {
        type: 'object',
        properties: {
          html: {
            type: 'string',
            description: '用于写入文档的 HTML 富文本片段。',
          },
        },
        required: ['html'],
        additionalProperties: false,
      },
      async function (args) {
        return await performRichReplace(args, resolved);
      }
    );
  }

  global.__webeditDocumentTools = {
    registerDocumentTools: registerDocumentTools,
  };
})(window);
