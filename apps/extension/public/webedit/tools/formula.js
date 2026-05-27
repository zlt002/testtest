(function (global) {
  'use strict';

  if (global.__webeditFormulaTools) {
    return;
  }

  const DEFAULT_ERROR_CODES = {
    RUNTIME_NOT_READY: 'runtime_not_ready',
    RANGE_NOT_FOUND: 'range_not_found',
    INVALID_ARGUMENT: 'invalid_argument',
    WRITE_NOT_SUPPORTED: 'write_not_supported',
    TOOL_EXECUTION_FAILED: 'tool_execution_failed',
  };

  function getErrorCodes(errorCodes) {
    return Object.assign({}, DEFAULT_ERROR_CODES, errorCodes || {});
  }

  function isPromiseLike(value) {
    return !!value && typeof value.then === 'function';
  }

  async function resolveValue(value) {
    return isPromiseLike(value) ? await value : value;
  }

  async function callMethod(target, key, args) {
    if (!target || typeof target[key] !== 'function') {
      return undefined;
    }
    return await resolveValue(target[key].apply(target, args || []));
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

  function createHelperSet(helpers) {
    const safeHelpers = helpers || {};
    return {
      ok:
        typeof safeHelpers.ok === 'function'
          ? safeHelpers.ok.bind(safeHelpers)
          : function (operation, target, data) {
              return {
                success: true,
                operation: operation,
                target: target || null,
                data: data || {},
                error: null,
              };
            },
      fail:
        typeof safeHelpers.fail === 'function'
          ? safeHelpers.fail.bind(safeHelpers)
          : function (operation, target, code, message, details) {
              return {
                success: false,
                operation: operation,
                target: target || null,
                data: {},
                error: {
                  code: code,
                  message: message,
                  details: details || {},
                },
              };
            },
      toToolResult:
        typeof safeHelpers.toToolResult === 'function'
          ? safeHelpers.toToolResult.bind(safeHelpers)
          : function (payload) {
              return {
                content: [
                  {
                    type: 'text',
                    text: JSON.stringify(payload, null, 2),
                  },
                ],
              };
            },
    };
  }

  async function getEditorApplication(adapter) {
    if (adapter && typeof adapter.getEditorApplication === 'function') {
      return await adapter.getEditorApplication();
    }
    return global.APP || (global.WPSOpenApi && global.WPSOpenApi.Application) || null;
  }

  async function getActiveSheet(adapter, app) {
    if (adapter && typeof adapter.getActiveSheet === 'function') {
      return await adapter.getActiveSheet(app);
    }
    return (
      (await callMethod(app, 'getActiveSheet')) ||
      (await readProperty(app, 'ActiveSheet')) ||
      null
    );
  }

  async function getRangeByAddress(adapter, app, address) {
    if (adapter && typeof adapter.getRangeByAddress === 'function') {
      const adapterRange = await adapter.getRangeByAddress(app, address);
      if (adapterRange) {
        return adapterRange;
      }
    }
    const sheet = await getActiveSheet(adapter, app);
    if (!sheet) {
      return null;
    }
    return (
      (await callMethod(sheet, 'getRange', [address])) ||
      (await callMethod(sheet, 'Range', [address])) ||
      null
    );
  }

  async function getRangeFormula(adapter, range) {
    if (adapter && typeof adapter.getRangeFormula === 'function') {
      const formula = await adapter.getRangeFormula(range);
      if (typeof formula !== 'undefined') {
        return formula;
      }
    }
    return (await callMethod(range, 'getFormula')) || (await readProperty(range, 'Formula')) || null;
  }

  async function setRangeFormula(adapter, range, formula) {
    if (adapter && typeof adapter.setRangeFormula === 'function') {
      const result = await adapter.setRangeFormula(range, formula);
      if (result !== false) {
        return result || 'adapter.setRangeFormula';
      }
    }
    if (typeof range.setFormula === 'function') {
      await resolveValue(range.setFormula(formula));
      return 'setFormula';
    }
    if (await setProperty(range, 'Formula', formula)) {
      return 'Formula';
    }
    return null;
  }

  async function summarizeRange(adapter, range) {
    if (!range) {
      return null;
    }
    if (adapter && typeof adapter.summarizeRange === 'function') {
      const summary = await adapter.summarizeRange(range);
      if (summary) {
        return summary;
      }
    }
    const address =
      (await callMethod(range, 'getAddress')) ||
      (await callMethod(range, 'getAddressLocal')) ||
      (await readProperty(range, 'Address')) ||
      (await readProperty(range, 'AddressLocal')) ||
      null;
    return {
      address: address == null ? null : String(address),
      formula: await getRangeFormula(adapter, range),
      text: (await callMethod(range, 'getText')) || (await readProperty(range, 'Text')) || null,
    };
  }

  function createResponder(helpers, errorCodes) {
    const helperSet = createHelperSet(helpers);
    const codes = getErrorCodes(errorCodes);

    return {
      codes: codes,
      ok: function (operation, target, data) {
        return helperSet.toToolResult(helperSet.ok(operation, target, data));
      },
      fail: function (operation, target, code, message, details) {
        return helperSet.toToolResult(helperSet.fail(operation, target, code, message, details));
      },
    };
  }

  function registerFormulaTools(registerTool, deps) {
    const adapter = deps && deps.adapter;
    const responder = createResponder(deps && deps.helpers, deps && deps.errorCodes);

    registerTool(
      'webedit_get_formula',
      '读取指定单元格或区域的公式。',
      {
        type: 'object',
        properties: {
          range: { type: 'string', description: '单元格或区域地址，如 K12 或 A1:B2。' },
        },
        required: ['range'],
        additionalProperties: false,
      },
      async function (args) {
        const address = args && typeof args.range === 'string' ? args.range.trim() : '';
        if (!address) {
          return responder.fail(
            'webedit_get_formula',
            { range: args && args.range },
            responder.codes.INVALID_ARGUMENT,
            'range is required'
          );
        }

        try {
          const app = await getEditorApplication(adapter);
          if (!app) {
            return responder.fail(
              'webedit_get_formula',
              { range: address },
              responder.codes.RUNTIME_NOT_READY,
              'Editor runtime is not ready'
            );
          }

          const range = await getRangeByAddress(adapter, app, address);
          if (!range) {
            return responder.fail(
              'webedit_get_formula',
              { range: address },
              responder.codes.RANGE_NOT_FOUND,
              'Unable to resolve target range'
            );
          }

          return responder.ok('webedit_get_formula', { range: address }, {
            range: address,
            formula: await getRangeFormula(adapter, range),
            rangeSummary: await summarizeRange(adapter, range),
          });
        } catch (error) {
          return responder.fail(
            'webedit_get_formula',
            { range: address },
            responder.codes.TOOL_EXECUTION_FAILED,
            error && error.message ? error.message : String(error)
          );
        }
      }
    );

    registerTool(
      'webedit_set_formula',
      '向指定单元格写入公式。',
      {
        type: 'object',
        properties: {
          cell: { type: 'string', description: '目标单元格地址，如 K12。' },
          formula: { type: 'string', description: '公式文本，如 =SUM(A1:A5)。' },
        },
        required: ['cell', 'formula'],
        additionalProperties: false,
      },
      async function (args) {
        const cell = args && typeof args.cell === 'string' ? args.cell.trim() : '';
        const formula = args && typeof args.formula === 'string' ? args.formula.trim() : '';

        if (!cell || !formula) {
          return responder.fail(
            'webedit_set_formula',
            { cell: args && args.cell },
            responder.codes.INVALID_ARGUMENT,
            'cell and formula are required'
          );
        }

        try {
          const app = await getEditorApplication(adapter);
          if (!app) {
            return responder.fail(
              'webedit_set_formula',
              { cell: cell },
              responder.codes.RUNTIME_NOT_READY,
              'Editor runtime is not ready'
            );
          }

          const range = await getRangeByAddress(adapter, app, cell);
          if (!range) {
            return responder.fail(
              'webedit_set_formula',
              { cell: cell },
              responder.codes.RANGE_NOT_FOUND,
              'Unable to resolve target range'
            );
          }

          const strategy = await setRangeFormula(adapter, range, formula);
          if (!strategy) {
            return responder.fail(
              'webedit_set_formula',
              { cell: cell },
              responder.codes.WRITE_NOT_SUPPORTED,
              'Target range does not expose formula write APIs'
            );
          }

          return responder.ok('webedit_set_formula', { cell: cell }, {
            cell: cell,
            formula: formula,
            writeStrategy: strategy,
            after: await summarizeRange(adapter, range),
          });
        } catch (error) {
          return responder.fail(
            'webedit_set_formula',
            { cell: cell },
            responder.codes.TOOL_EXECUTION_FAILED,
            error && error.message ? error.message : String(error)
          );
        }
      }
    );
  }

  global.__webeditFormulaTools = {
    registerFormulaTools: registerFormulaTools,
  };
})(window);
