(function (global) {
  'use strict';

  if (global.__webeditCellTools) {
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

  function cleanObject(value) {
    const result = {};
    Object.keys(value || {}).forEach(function (key) {
      if (typeof value[key] !== 'undefined') {
        result[key] = value[key];
      }
    });
    return result;
  }

  function createHelperSet(helpers) {
    const safeHelpers = helpers || {};

    function ok(operation, target, data) {
      if (typeof safeHelpers.ok === 'function') {
        return safeHelpers.ok(operation, target, data);
      }
      return {
        success: true,
        operation: operation,
        target: target || null,
        data: data || {},
        error: null,
      };
    }

    function fail(operation, target, code, message, details) {
      if (typeof safeHelpers.fail === 'function') {
        return safeHelpers.fail(operation, target, code, message, details);
      }
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
    }

    function toToolResult(payload) {
      if (typeof safeHelpers.toToolResult === 'function') {
        return safeHelpers.toToolResult(payload);
      }
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(payload, null, 2),
          },
        ],
      };
    }

    return { ok: ok, fail: fail, toToolResult: toToolResult };
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

  async function getRangeByCell(adapter, app, cell) {
    if (adapter && typeof adapter.getRangeByCell === 'function') {
      const adapterRange = await adapter.getRangeByCell(app, cell);
      if (adapterRange) {
        return adapterRange;
      }
    }
    return await getRangeByAddress(adapter, app, cell);
  }

  async function summarizeRange(adapter, range) {
    if (!range) {
      return null;
    }

    let matrixValues;
    if (adapter && typeof adapter.readRangeMatrix === 'function') {
      matrixValues = await adapter.readRangeMatrix(range);
    }

    if (adapter && typeof adapter.summarizeRange === 'function') {
      const summary = await adapter.summarizeRange(range);
      if (summary) {
        return cleanObject(
          Object.assign({}, summary, {
            values: typeof matrixValues === 'undefined' ? undefined : matrixValues,
          })
        );
      }
    }

    const address =
      (await callMethod(range, 'getAddress')) ||
      (await callMethod(range, 'getAddressLocal')) ||
      (await readProperty(range, 'Address')) ||
      (await readProperty(range, 'AddressLocal')) ||
      null;
    const text = (await callMethod(range, 'getText')) || (await readProperty(range, 'Text')) || null;
    const formula =
      (await callMethod(range, 'getFormula')) || (await readProperty(range, 'Formula')) || null;
    const value2 =
      (await callMethod(range, 'getValue2')) ||
      (await callMethod(range, 'getValue')) ||
      (await readProperty(range, 'Value2')) ||
      (await readProperty(range, 'Value'));
    return cleanObject({
      address: address == null ? null : String(address),
      text: text == null ? null : String(text),
      formula: formula == null ? null : String(formula),
      value2: typeof value2 === 'undefined' ? null : value2,
      values: typeof matrixValues === 'undefined' ? null : matrixValues,
    });
  }

  function normalizeScalarValue(value) {
    if (value === null || typeof value === 'undefined') {
      return '';
    }
    if (typeof value === 'number' || typeof value === 'boolean') {
      return value;
    }
    if (value instanceof Date) {
      return value.toISOString();
    }
    return String(value);
  }

  function normalizeMatrix(values) {
    if (!Array.isArray(values) || values.length === 0) {
      return null;
    }
    return values.map(function (row) {
      if (!Array.isArray(row)) {
        return [normalizeScalarValue(row)];
      }
      return row.map(normalizeScalarValue);
    });
  }

  function getMatrixShape(values) {
    if (!Array.isArray(values) || values.length === 0) {
      return null;
    }

    let maxColumns = 0;
    for (let index = 0; index < values.length; index += 1) {
      const row = values[index];
      const columns = Array.isArray(row) ? row.length : 1;
      if (columns > maxColumns) {
        maxColumns = columns;
      }
    }

    return {
      rowsCount: values.length,
      columnsCount: maxColumns,
    };
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

  function buildCellAddress(row, column) {
    if (typeof row !== 'number' || typeof column !== 'number') {
      return null;
    }

    return numberToColumnName(column) + String(row);
  }

  function isSingleCellShape(shape) {
    return !!shape && shape.rowsCount === 1 && shape.columnsCount === 1;
  }

  async function writeSingleValue(range, value) {
    const normalizedValue = normalizeScalarValue(value);
    if (typeof range.setValue2 === 'function') {
      await resolveValue(range.setValue2(normalizedValue));
      return 'setValue2';
    }
    if (typeof range.setValue === 'function') {
      await resolveValue(range.setValue(normalizedValue));
      return 'setValue';
    }
    if (await setProperty(range, 'Value2', normalizedValue)) {
      return 'Value2';
    }
    if (await setProperty(range, 'Value', normalizedValue)) {
      return 'Value';
    }
    if (typeof range.setText === 'function') {
      await resolveValue(range.setText(String(normalizedValue)));
      return 'setText';
    }
    return null;
  }

  async function writeMatrixValue(range, values) {
    if (typeof range.setValues === 'function') {
      await resolveValue(range.setValues(values));
      return 'setValues';
    }
    return null;
  }

  async function writeMatrixByCells(adapter, app, startRow, startColumn, values) {
    const results = [];

    for (let rowOffset = 0; rowOffset < values.length; rowOffset += 1) {
      const rowValues = Array.isArray(values[rowOffset]) ? values[rowOffset] : [values[rowOffset]];

      for (let columnOffset = 0; columnOffset < rowValues.length; columnOffset += 1) {
        const cell = buildCellAddress(startRow + rowOffset, startColumn + columnOffset);
        const range = await getRangeByCell(adapter, app, cell);

        if (!range) {
          return {
            ok: false,
            error: {
              code: 'range_not_found',
              message: 'Unable to resolve target range',
              details: {
                cell: cell,
                rowOffset: rowOffset,
                columnOffset: columnOffset,
              },
            },
          };
        }

        const before = await summarizeRange(adapter, range);
        const writeStrategy = await writeSingleValue(range, rowValues[columnOffset]);
        if (!writeStrategy) {
          return {
            ok: false,
            error: {
              code: 'write_not_supported',
              message: 'Target range does not expose writable APIs',
              details: {
                cell: cell,
                rowOffset: rowOffset,
                columnOffset: columnOffset,
              },
            },
          };
        }

        results.push({
          cell: cell,
          value: normalizeScalarValue(rowValues[columnOffset]),
          writeStrategy: writeStrategy,
          before: before,
          after: await summarizeRange(adapter, range),
        });
      }
    }

    return {
      ok: true,
      writeStrategy: 'cell-by-cell',
      results: results,
    };
  }

  function createResponder(helpers, errorCodes) {
    const helperSet = createHelperSet(helpers);
    const codes = getErrorCodes(errorCodes);

    function ok(operation, target, data) {
      return helperSet.toToolResult(helperSet.ok(operation, target, data));
    }

    function fail(operation, target, code, message, details) {
      return helperSet.toToolResult(helperSet.fail(operation, target, code, message, details));
    }

    function invalid(operation, target, message, details) {
      return fail(operation, target, codes.INVALID_ARGUMENT, message, details);
    }

    return {
      ok: ok,
      fail: fail,
      invalid: invalid,
      codes: codes,
    };
  }

  function registerCellTools(registerTool, deps) {
    const adapter = deps && deps.adapter;
    const responder = createResponder(deps && deps.helpers, deps && deps.errorCodes);

    registerTool(
      'webedit_read_cell',
      '读取当前活动工作表中指定单元格的值。',
      {
        type: 'object',
        properties: {
          cell: { type: 'string', description: '单元格地址，如 A1 或 J12。' },
        },
        required: ['cell'],
        additionalProperties: false,
      },
      async function (args) {
        const cell = args && typeof args.cell === 'string' ? args.cell.trim() : '';
        if (!cell) {
          return responder.invalid('webedit_read_cell', { cell: args && args.cell }, 'cell is required');
        }

        try {
          const app = await getEditorApplication(adapter);
          if (!app) {
            return responder.fail(
              'webedit_read_cell',
              { cell: cell },
              responder.codes.RUNTIME_NOT_READY,
              'Editor runtime is not ready'
            );
          }

          const range = await getRangeByCell(adapter, app, cell);
          if (!range) {
            return responder.fail(
              'webedit_read_cell',
              { cell: cell },
              responder.codes.RANGE_NOT_FOUND,
              'Unable to resolve target range'
            );
          }

          return responder.ok('webedit_read_cell', { cell: cell }, {
            cell: cell,
            range: await summarizeRange(adapter, range),
          });
        } catch (error) {
          return responder.fail(
            'webedit_read_cell',
            { cell: cell },
            responder.codes.TOOL_EXECUTION_FAILED,
            error && error.message ? error.message : String(error)
          );
        }
      }
    );

    registerTool(
      'webedit_read_range',
      '读取当前活动工作表中指定区域的内容。',
      {
        type: 'object',
        properties: {
          range: { type: 'string', description: '区域地址，如 A1:C3。' },
        },
        required: ['range'],
        additionalProperties: false,
      },
      async function (args) {
        const address = args && typeof args.range === 'string' ? args.range.trim() : '';
        if (!address) {
          return responder.invalid('webedit_read_range', { range: args && args.range }, 'range is required');
        }

        try {
          const app = await getEditorApplication(adapter);
          if (!app) {
            return responder.fail(
              'webedit_read_range',
              { range: address },
              responder.codes.RUNTIME_NOT_READY,
              'Editor runtime is not ready'
            );
          }

          const range = await getRangeByAddress(adapter, app, address);
          if (!range) {
            return responder.fail(
              'webedit_read_range',
              { range: address },
              responder.codes.RANGE_NOT_FOUND,
              'Unable to resolve target range'
            );
          }

          const summary = await summarizeRange(adapter, range);
          return responder.ok('webedit_read_range', { range: address }, {
            range: address,
            values: summary && Object.prototype.hasOwnProperty.call(summary, 'values') ? summary.values : null,
            summary: summary,
          });
        } catch (error) {
          return responder.fail(
            'webedit_read_range',
            { range: address },
            responder.codes.TOOL_EXECUTION_FAILED,
            error && error.message ? error.message : String(error)
          );
        }
      }
    );

    registerTool(
      'webedit_write_cell',
      '向当前活动工作表中的指定单元格写入值。',
      {
        type: 'object',
        properties: {
          cell: { type: 'string', description: '单元格地址，如 A1 或 J12。' },
          value: { description: '要写入的值。' },
        },
        required: ['cell', 'value'],
        additionalProperties: false,
      },
      async function (args) {
        const cell = args && typeof args.cell === 'string' ? args.cell.trim() : '';
        if (!cell) {
          return responder.invalid('webedit_write_cell', { cell: args && args.cell }, 'cell is required');
        }

        try {
          const app = await getEditorApplication(adapter);
          if (!app) {
            return responder.fail(
              'webedit_write_cell',
              { cell: cell },
              responder.codes.RUNTIME_NOT_READY,
              'Editor runtime is not ready'
            );
          }

          const range = await getRangeByCell(adapter, app, cell);
          if (!range) {
            return responder.fail(
              'webedit_write_cell',
              { cell: cell },
              responder.codes.RANGE_NOT_FOUND,
              'Unable to resolve target range'
            );
          }

          const before = await summarizeRange(adapter, range);
          const writeStrategy = await writeSingleValue(range, args.value);
          if (!writeStrategy) {
            return responder.fail(
              'webedit_write_cell',
              { cell: cell },
              responder.codes.WRITE_NOT_SUPPORTED,
              'Target range does not expose writable APIs'
            );
          }

          return responder.ok('webedit_write_cell', { cell: cell }, {
            cell: cell,
            value: normalizeScalarValue(args.value),
            writeStrategy: writeStrategy,
            before: before,
            after: await summarizeRange(adapter, range),
          });
        } catch (error) {
          return responder.fail(
            'webedit_write_cell',
            { cell: cell },
            responder.codes.TOOL_EXECUTION_FAILED,
            error && error.message ? error.message : String(error)
          );
        }
      }
    );

    registerTool(
      'webedit_write_range',
      '向当前活动工作表中的指定区域批量写入二维数据。',
      {
        type: 'object',
        properties: {
          range: { type: 'string', description: '区域地址，如 A1:B2。' },
          values: {
            type: 'array',
            description: '二维数组形式的值。',
            items: {
              type: 'array',
              items: {},
            },
          },
        },
        required: ['range', 'values'],
        additionalProperties: false,
      },
      async function (args) {
        const address = args && typeof args.range === 'string' ? args.range.trim() : '';
        const values = normalizeMatrix(args && args.values);

        if (!address) {
          return responder.invalid('webedit_write_range', { range: args && args.range }, 'range is required');
        }
        if (!values) {
          return responder.invalid(
            'webedit_write_range',
            { range: address },
            'values must be a non-empty array'
          );
        }

        try {
          const app = await getEditorApplication(adapter);
          if (!app) {
            return responder.fail(
              'webedit_write_range',
              { range: address },
              responder.codes.RUNTIME_NOT_READY,
              'Editor runtime is not ready'
            );
          }

          const range = await getRangeByAddress(adapter, app, address);
          if (!range) {
            return responder.fail(
              'webedit_write_range',
              { range: address },
              responder.codes.RANGE_NOT_FOUND,
              'Unable to resolve target range'
            );
          }

          const before = await summarizeRange(adapter, range);
          const matrixShape = getMatrixShape(values);
          const expectedRowsCount =
            before && typeof before.rowsCount === 'number' ? before.rowsCount : null;
          const expectedColumnsCount =
            before && typeof before.columnsCount === 'number' ? before.columnsCount : null;

          if (
            matrixShape &&
            expectedRowsCount &&
            expectedColumnsCount &&
            (matrixShape.rowsCount !== expectedRowsCount ||
              matrixShape.columnsCount !== expectedColumnsCount)
          ) {
            return responder.invalid(
              'webedit_write_range',
              { range: address },
              'values shape does not match target range dimensions',
              {
                expectedRowsCount: expectedRowsCount,
                expectedColumnsCount: expectedColumnsCount,
                actualRowsCount: matrixShape.rowsCount,
                actualColumnsCount: matrixShape.columnsCount,
              }
            );
          }

          let writeStrategy;
          let cellResults;

          if (isSingleCellShape(matrixShape)) {
            writeStrategy = await writeSingleValue(range, values[0][0]);
            if (!writeStrategy) {
              return responder.fail(
                'webedit_write_range',
                { range: address },
                responder.codes.WRITE_NOT_SUPPORTED,
                'Target range does not expose writable APIs for single-cell writes'
              );
            }
          } else {
            const directWriteStrategy = await writeMatrixValue(range, values);

            if (directWriteStrategy) {
              writeStrategy = directWriteStrategy;
            } else {
              const startRow = before && typeof before.row === 'number' ? before.row : null;
              const startColumn = before && typeof before.column === 'number' ? before.column : null;

              if (startRow == null || startColumn == null) {
                return responder.fail(
                  'webedit_write_range',
                  { range: address },
                  responder.codes.WRITE_NOT_SUPPORTED,
                  'Target range does not expose reliable matrix write APIs or anchor coordinates'
                );
              }

              const fallbackResult = await writeMatrixByCells(
                adapter,
                app,
                startRow,
                startColumn,
                values
              );

              if (!fallbackResult.ok) {
                return responder.fail(
                  'webedit_write_range',
                  { range: address },
                  fallbackResult.error.code || responder.codes.WRITE_NOT_SUPPORTED,
                  fallbackResult.error.message || 'Matrix fallback write failed',
                  fallbackResult.error.details
                );
              }

              writeStrategy = fallbackResult.writeStrategy;
              cellResults = fallbackResult.results;
            }
          }

          return responder.ok('webedit_write_range', { range: address }, {
            range: address,
            values: values,
            writeStrategy: writeStrategy,
            before: before,
            after: await summarizeRange(adapter, range),
            cellResults: cellResults,
          });
        } catch (error) {
          return responder.fail(
            'webedit_write_range',
            { range: address },
            responder.codes.TOOL_EXECUTION_FAILED,
            error && error.message ? error.message : String(error)
          );
        }
      }
    );

    registerTool(
      'webedit_batch_write',
      '按单元格映射批量写入多个值。',
      {
        type: 'object',
        properties: {
          data: {
            type: 'object',
            description: '形如 { "A1": "标题", "B1": 123 } 的映射。',
            additionalProperties: true,
          },
        },
        required: ['data'],
        additionalProperties: false,
      },
      async function (args) {
        const data = args && args.data;
        const entries = data && typeof data === 'object' && !Array.isArray(data) ? Object.entries(data) : [];

        if (!entries.length) {
          return responder.invalid('webedit_batch_write', { data: data }, 'data must be a non-empty object');
        }

        try {
          const app = await getEditorApplication(adapter);
          if (!app) {
            return responder.fail(
              'webedit_batch_write',
              { count: entries.length },
              responder.codes.RUNTIME_NOT_READY,
              'Editor runtime is not ready'
            );
          }

          const results = [];
          for (let index = 0; index < entries.length; index += 1) {
            const item = entries[index];
            const cell = String(item[0]).trim();
            const value = item[1];
            const range = await getRangeByCell(adapter, app, cell);

            if (!range) {
              return responder.fail(
                'webedit_batch_write',
                { cell: cell },
                responder.codes.RANGE_NOT_FOUND,
                'Unable to resolve target range',
                { failedIndex: index }
              );
            }

            const before = await summarizeRange(adapter, range);
            const writeStrategy = await writeSingleValue(range, value);
            if (!writeStrategy) {
              return responder.fail(
                'webedit_batch_write',
                { cell: cell },
                responder.codes.WRITE_NOT_SUPPORTED,
                'Target range does not expose writable APIs',
                { failedIndex: index }
              );
            }

            results.push({
              cell: cell,
              value: normalizeScalarValue(value),
              writeStrategy: writeStrategy,
              before: before,
              after: await summarizeRange(adapter, range),
            });
          }

          return responder.ok('webedit_batch_write', { count: entries.length }, {
            count: entries.length,
            results: results,
          });
        } catch (error) {
          return responder.fail(
            'webedit_batch_write',
            { count: entries.length },
            responder.codes.TOOL_EXECUTION_FAILED,
            error && error.message ? error.message : String(error)
          );
        }
      }
    );
  }

  global.__webeditCellTools = {
    registerCellTools: registerCellTools,
  };
})(window);
