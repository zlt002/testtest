(function (global) {
  'use strict';

  if (global.__webeditContextTools) {
    return;
  }

  function getDefaultAdapter() {
    return global.__webeditRuntimeAdapter || null;
  }

  function getDefaultHelpers() {
    return global.__webeditResultHelpers || null;
  }

  function getDefaultErrorCodes() {
    return {
      INVALID_ARGUMENT: 'INVALID_ARGUMENT',
      RUNTIME_NOT_READY: 'RUNTIME_NOT_READY',
      APP_UNAVAILABLE: 'APP_UNAVAILABLE',
      SHEET_UNAVAILABLE: 'SHEET_UNAVAILABLE',
      RANGE_UNAVAILABLE: 'RANGE_UNAVAILABLE',
      WORKBOOK_UNAVAILABLE: 'WORKBOOK_UNAVAILABLE',
      INTERNAL_ERROR: 'INTERNAL_ERROR',
    };
  }

  function resolveDeps(deps) {
    const source = deps && typeof deps === 'object' ? deps : {};
    const helpers = source.helpers || getDefaultHelpers();
    const adapter = source.adapter || getDefaultAdapter();
    const registerTool = source.registerTool;

    if (!helpers) {
      throw new Error('WebEdit result helpers are not available');
    }

    if (!adapter) {
      throw new Error('WebEdit runtime adapter is not available');
    }

    if (typeof registerTool !== 'function') {
      throw new Error('registerTool is required');
    }

    return {
      adapter: adapter,
      helpers: helpers,
      errorCodes: Object.assign({}, getDefaultErrorCodes(), source.errorCodes || {}),
      registerTool: registerTool,
    };
  }

  async function getApp(adapter) {
    if (!adapter || typeof adapter.getEditorApplication !== 'function') {
      return null;
    }

    return await adapter.getEditorApplication();
  }

  async function getWorkbook(adapter, app) {
    if (adapter && typeof adapter.getActiveWorkbook === 'function') {
      const workbook = await adapter.getActiveWorkbook(app);
      if (workbook) {
        return workbook;
      }
    }

    if (!adapter || typeof adapter.readProperty !== 'function') {
      return null;
    }

    return (
      (await adapter.readProperty(app, 'ActiveWorkbook')) ||
      (await adapter.readProperty(app, 'Workbook')) ||
      null
    );
  }

  async function summarizeSheet(adapter, sheet) {
    if (!sheet) {
      return null;
    }

    const readProperty = adapter.readProperty;
    const callMethod = adapter.callMethod;
    const data = {
      name:
        (await callMethod(sheet, 'getName')) ||
        (await readProperty(sheet, 'Name')) ||
        null,
      index:
        (await callMethod(sheet, 'getIndex')) ||
        (await readProperty(sheet, 'Index')) ||
        null,
      visible:
        (await callMethod(sheet, 'getVisible')) ||
        (await readProperty(sheet, 'Visible')) ||
        undefined,
    };

    return adapter.cleanObject ? adapter.cleanObject(data) : data;
  }

  async function listSheetSummaries(adapter, workbook) {
    if (!workbook) {
      return [];
    }

    const callMethod = adapter.callMethod;
    const readProperty = adapter.readProperty;
    const worksheets =
      (await callMethod(workbook, 'getWorksheets')) ||
      (await readProperty(workbook, 'Worksheets')) ||
      null;

    if (!worksheets) {
      return [];
    }

    const results = [];
    for (let index = 1; index <= 200; index += 1) {
      const sheet =
        (await callMethod(worksheets, 'item', [index])) ||
        (await callMethod(worksheets, 'Item', [index])) ||
        null;

      if (!sheet) {
        if (index > 32) {
          break;
        }
        continue;
      }

      results.push(await summarizeSheet(adapter, sheet));
    }

    return results;
  }

  async function ensureRuntime(adapter, errorCodes) {
    if (!adapter || typeof adapter.isRuntimeReady !== 'function' || !adapter.isRuntimeReady()) {
      const error = new Error('WebEdit spreadsheet runtime is not ready');
      error.code = errorCodes.RUNTIME_NOT_READY;
      throw error;
    }
  }

  async function ensureApp(adapter, errorCodes) {
    const app = await getApp(adapter);
    if (app) {
      return app;
    }

    const error = new Error('Spreadsheet application is not available');
    error.code = errorCodes.APP_UNAVAILABLE;
    throw error;
  }

  async function ensureActiveSheet(adapter, app, errorCodes) {
    const sheet =
      (adapter && typeof adapter.getActiveSheet === 'function'
        ? await adapter.getActiveSheet(app)
        : null) || null;

    if (sheet) {
      return sheet;
    }

    const error = new Error('Active sheet is not available');
    error.code = errorCodes.SHEET_UNAVAILABLE;
    throw error;
  }

  async function ensureRange(range, code, message) {
    if (range) {
      return range;
    }

    const error = new Error(message);
    error.code = code;
    throw error;
  }

  function wrapTool(deps, handler) {
    return async function (input) {
      const args = deps.helpers.normalizeArgs(input);

      try {
        return await handler(args);
      } catch (error) {
        return deps.helpers.fail(error, {
          code: error && error.code ? error.code : deps.errorCodes.INTERNAL_ERROR,
        });
      }
    };
  }

  function registerContextTools(deps) {
    const resolved = resolveDeps(deps);
    const adapter = resolved.adapter;
    const helpers = resolved.helpers;
    const errorCodes = resolved.errorCodes;
    const registerTool = resolved.registerTool;

    registerTool(
      'get_context',
      '返回当前 WebEdit spreadsheet 运行时、文档和活动工作表的上下文。',
      {
        type: 'object',
        properties: {},
        additionalProperties: false,
      },
      wrapTool(resolved, async function () {
        const runtimeSnapshot =
          typeof adapter.summarizeRuntimeSnapshot === 'function'
            ? await adapter.summarizeRuntimeSnapshot()
            : null;
        const app = await getApp(adapter);
        const workbook = await getWorkbook(adapter, app);
        const activeSheet = app ? await adapter.getActiveSheet(app) : null;
        const selection = app ? await adapter.getSelectionRange(app) : null;

        return helpers.ok(
          helpers.pickDefined({
            runtimeReady:
              typeof adapter.isRuntimeReady === 'function' ? adapter.isRuntimeReady() : false,
            document:
              typeof adapter.detectDocumentIdentity === 'function'
                ? adapter.detectDocumentIdentity()
                : undefined,
            runtimeFlags:
              typeof adapter.getRuntimeFlags === 'function'
                ? adapter.getRuntimeFlags()
                : undefined,
            snapshot: runtimeSnapshot,
            workbook: workbook
              ? helpers.pickDefined({
                  name: await adapter.readProperty(workbook, 'Name'),
                })
              : null,
            activeSheet: await summarizeSheet(adapter, activeSheet),
            selection:
              typeof adapter.summarizeRange === 'function'
                ? await adapter.summarizeRange(selection)
                : null,
          })
        );
      })
    );

    registerTool(
      'get_active_sheet',
      '返回当前活动工作表摘要和活动单元格信息。',
      {
        type: 'object',
        properties: {},
        additionalProperties: false,
      },
      wrapTool(resolved, async function () {
        await ensureRuntime(adapter, errorCodes);
        const app = await ensureApp(adapter, errorCodes);
        const sheet = await ensureActiveSheet(adapter, app, errorCodes);
        const activeCell =
          typeof adapter.getActiveCell === 'function' ? await adapter.getActiveCell(app) : null;

        return helpers.ok({
          sheet: await summarizeSheet(adapter, sheet),
          activeCell:
            typeof adapter.summarizeRange === 'function'
              ? await adapter.summarizeRange(activeCell)
              : null,
        });
      })
    );

    registerTool(
      'get_selection',
      '返回当前选区、活动单元格和 DOM 选区摘要。',
      {
        type: 'object',
        properties: {},
        additionalProperties: false,
      },
      wrapTool(resolved, async function () {
        await ensureRuntime(adapter, errorCodes);
        const app = await ensureApp(adapter, errorCodes);
        const selection =
          typeof adapter.getSelectionRange === 'function'
            ? await adapter.getSelectionRange(app)
            : null;
        const activeCell =
          typeof adapter.getActiveCell === 'function' ? await adapter.getActiveCell(app) : null;

        return helpers.ok({
          selection:
            typeof adapter.summarizeRange === 'function'
              ? await adapter.summarizeRange(selection)
              : null,
          activeCell:
            typeof adapter.summarizeRange === 'function'
              ? await adapter.summarizeRange(activeCell)
              : null,
          domSelection:
            typeof adapter.summarizeDomSelection === 'function'
              ? adapter.summarizeDomSelection()
              : null,
        });
      })
    );

    registerTool(
      'get_used_range',
      '返回活动工作表的已使用范围摘要。',
      {
        type: 'object',
        properties: {},
        additionalProperties: false,
      },
      wrapTool(resolved, async function () {
        await ensureRuntime(adapter, errorCodes);
        const app = await ensureApp(adapter, errorCodes);
        const usedRange =
          typeof adapter.getUsedRange === 'function' ? await adapter.getUsedRange(app) : null;

        await ensureRange(
          usedRange,
          errorCodes.RANGE_UNAVAILABLE,
          'Used range is not available on the active sheet'
        );

        return helpers.ok({
          usedRange:
            typeof adapter.summarizeRange === 'function'
              ? await adapter.summarizeRange(usedRange)
              : null,
        });
      })
    );

    registerTool(
      'get_workbook_info',
      '返回当前工作簿、工作表列表和活动工作表的摘要。',
      {
        type: 'object',
        properties: {
          includeSheets: {
            type: 'boolean',
            description: '是否尽力枚举工作表列表，默认 true。',
          },
        },
        additionalProperties: false,
      },
      wrapTool(resolved, async function (args) {
        await ensureRuntime(adapter, errorCodes);
        const app = await ensureApp(adapter, errorCodes);
        const workbook = await getWorkbook(adapter, app);

        if (!workbook) {
          const error = new Error('Active workbook is not available');
          error.code = errorCodes.WORKBOOK_UNAVAILABLE;
          throw error;
        }

        const includeSheets = args.includeSheets !== false;
        const activeSheet =
          typeof adapter.getActiveSheet === 'function' ? await adapter.getActiveSheet(app) : null;
        const workbookInfo =
          typeof adapter.getWorkbookInfo === 'function'
            ? await adapter.getWorkbookInfo(app)
            : null;

        return helpers.ok({
          workbook: helpers.pickDefined({
            name: await adapter.readProperty(workbook, 'Name'),
            info: workbookInfo,
          }),
          activeSheet: await summarizeSheet(adapter, activeSheet),
          sheets: includeSheets ? await listSheetSummaries(adapter, workbook) : undefined,
        });
      })
    );
  }

  global.__webeditContextTools = {
    registerContextTools: registerContextTools,
  };
})(window);
