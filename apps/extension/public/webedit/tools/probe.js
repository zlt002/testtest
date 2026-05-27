(function (global) {
  'use strict';

  if (global.__webeditProbeTools) {
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
      RANGE_UNAVAILABLE: 'RANGE_UNAVAILABLE',
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

  function buildActiveElementSummary() {
    const element = document.activeElement;
    if (!element) {
      return null;
    }

    return {
      tagName: element.tagName || null,
      id: element.id || null,
      className: element.className ? String(element.className) : null,
      role: element.getAttribute ? element.getAttribute('role') : null,
    };
  }

  async function resolveProbeRange(adapter, app, cell) {
    const normalizedCell =
      typeof cell === 'string' && cell.trim() ? cell.trim().toUpperCase() : null;

    if (normalizedCell && typeof adapter.getRangeByAddress === 'function') {
      return {
        requestedCell: normalizedCell,
        range: await adapter.getRangeByAddress(app, normalizedCell),
      };
    }

    if (typeof adapter.getActiveCell === 'function') {
      return {
        requestedCell: null,
        range: await adapter.getActiveCell(app),
      };
    }

    return {
      requestedCell: normalizedCell,
      range: null,
    };
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

  function registerProbeTools(deps) {
    const resolved = resolveDeps(deps);
    const adapter = resolved.adapter;
    const helpers = resolved.helpers;
    const errorCodes = resolved.errorCodes;
    const registerTool = resolved.registerTool;

    registerTool(
      'debug_runtime',
      '返回当前 WebEdit spreadsheet 运行时探测结果与调试信息。',
      {
        type: 'object',
        properties: {},
        additionalProperties: false,
      },
      wrapTool(resolved, async function () {
        const runtimeSource =
          typeof adapter.detectRuntimeSource === 'function' ? adapter.detectRuntimeSource() : null;
        const runtimeWindow = runtimeSource ? runtimeSource.windowRef : null;
        const snapshot =
          typeof adapter.summarizeRuntimeSnapshot === 'function'
            ? await adapter.summarizeRuntimeSnapshot()
            : null;
        const app =
          typeof adapter.getEditorApplication === 'function'
            ? await adapter.getEditorApplication()
            : null;
        const activeSheet =
          app && typeof adapter.getActiveSheet === 'function'
            ? await adapter.getActiveSheet(app)
            : null;
        const selection =
          app && typeof adapter.getSelectionRange === 'function'
            ? await adapter.getSelectionRange(app)
            : null;

        return helpers.ok({
          runtimeReady:
            typeof adapter.isRuntimeReady === 'function' ? adapter.isRuntimeReady() : false,
          runtimeSource: runtimeSource
            ? {
                label: runtimeSource.label || null,
                flags: runtimeSource.flags || null,
              }
            : null,
          globalsPresent:
            typeof adapter.getGlobalsPresent === 'function'
              ? adapter.getGlobalsPresent(runtimeWindow || global)
              : [],
          activeElement: buildActiveElementSummary(),
          appMethods:
            typeof adapter.listFunctionKeys === 'function' ? adapter.listFunctionKeys(app) : [],
          sheetMethods:
            typeof adapter.listFunctionKeys === 'function'
              ? adapter.listFunctionKeys(activeSheet)
              : [],
          selectionSummary:
            typeof adapter.summarizeRange === 'function'
              ? await adapter.summarizeRange(selection)
              : null,
          snapshot: snapshot,
        });
      })
    );

    registerTool(
      'probe_range_api',
      '探测活动单元格或指定单元格的 Range API 暴露情况，用于 spreadsheet runtime 调试。',
      {
        type: 'object',
        properties: {
          cell: {
            type: 'string',
            description: '可选，指定要探测的单元格地址，例如 A1。',
          },
        },
        additionalProperties: false,
      },
      wrapTool(resolved, async function (args) {
        if (typeof adapter.isRuntimeReady === 'function' && !adapter.isRuntimeReady()) {
          const error = new Error('WebEdit spreadsheet runtime is not ready');
          error.code = errorCodes.RUNTIME_NOT_READY;
          throw error;
        }

        const app =
          typeof adapter.getEditorApplication === 'function'
            ? await adapter.getEditorApplication()
            : null;
        if (!app) {
          const error = new Error('Spreadsheet application is not available');
          error.code = errorCodes.APP_UNAVAILABLE;
          throw error;
        }

        const activeSheet =
          typeof adapter.getActiveSheet === 'function' ? await adapter.getActiveSheet(app) : null;
        const selection =
          typeof adapter.getSelectionRange === 'function'
            ? await adapter.getSelectionRange(app)
            : null;
        const probeTarget = await resolveProbeRange(adapter, app, args.cell);

        if (!probeTarget.range) {
          const error = new Error('Target range is not available');
          error.code = errorCodes.RANGE_UNAVAILABLE;
          throw error;
        }

        return helpers.ok({
          requestedCell: probeTarget.requestedCell,
          appMethods:
            typeof adapter.listFunctionKeys === 'function' ? adapter.listFunctionKeys(app) : [],
          sheetMethods:
            typeof adapter.listFunctionKeys === 'function'
              ? adapter.listFunctionKeys(activeSheet)
              : [],
          selectionMethods:
            typeof adapter.listFunctionKeys === 'function'
              ? adapter.listFunctionKeys(selection)
              : [],
          rangeMethods:
            typeof adapter.listFunctionKeys === 'function'
              ? adapter.listFunctionKeys(probeTarget.range)
              : [],
          selectionSummary:
            typeof adapter.summarizeRange === 'function'
              ? await adapter.summarizeRange(selection)
              : null,
          targetRange:
            typeof adapter.summarizeRange === 'function'
              ? await adapter.summarizeRange(probeTarget.range)
              : null,
        });
      })
    );
  }

  global.__webeditProbeTools = {
    registerProbeTools: registerProbeTools,
  };
})(window);
