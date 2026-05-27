(function (global) {
  'use strict';

  if (global.__webeditStructureTools) {
    return;
  }

  async function resolveRange(adapter, app, args) {
    return adapter.getRangeByAddress(app, args && args.range ? args.range : null);
  }

  function registerStructureTools(registerTool, deps) {
    const adapter = deps.adapter;
    const helpers = deps.helpers;
    const errorCodes = deps.errorCodes;

    registerTool(
      'webedit_insert_rows',
      '在指定行前后插入空行。',
      {
        type: 'object',
        properties: {
          range: { type: 'string', description: '整行地址，如 9:9' },
          count: { type: 'number', description: '插入行数，默认 1' },
          position: { type: 'string', description: '插入位置：before 或 after' },
          copyFormatFrom: { type: 'string', description: '复制格式来源：above、below 或 none' },
        },
        required: ['range'],
        additionalProperties: false,
      },
      async function (args) {
        const app = await adapter.getEditorApplication();
        const range = await resolveRange(adapter, app, args);
        if (!range) {
          return helpers.toToolResult(
            helpers.fail('webedit_insert_rows', { range: args && args.range }, errorCodes.RANGE_NOT_FOUND, 'Unable to resolve target range')
          );
        }

        const before = await adapter.summarizeRange(range);
        const count = typeof args.count === 'number' ? args.count : 1;
        const position = args.position || 'before';
        const copyFormatFrom = args.copyFormatFrom || 'none';
        const result = await adapter.insertRows(range, count, position, args || {});
        if (!result) {
          return helpers.toToolResult(
            helpers.fail('webedit_insert_rows', { range: args.range }, errorCodes.WRITE_NOT_SUPPORTED, 'Target range does not expose row insertion APIs')
          );
        }

        return helpers.toToolResult(
          helpers.ok('webedit_insert_rows', { range: args.range }, {
            range: args.range,
            count: count,
            position: position,
            copyFormatFrom: copyFormatFrom,
            writeStrategy: result.writeStrategy || result,
            before: before,
            after: await adapter.summarizeRange(range),
          })
        );
      }
    );

    registerTool(
      'webedit_merge_cells',
      '合并指定区域。',
      {
        type: 'object',
        properties: {
          range: { type: 'string', description: '区域地址，如 A1:B1' },
        },
        required: ['range'],
        additionalProperties: false,
      },
      async function (args) {
        const app = await adapter.getEditorApplication();
        const range = await resolveRange(adapter, app, args);
        if (!range) {
          return helpers.toToolResult(
            helpers.fail('webedit_merge_cells', { range: args && args.range }, errorCodes.RANGE_NOT_FOUND, 'Unable to resolve target range')
          );
        }
        const strategy = await adapter.mergeRange(range);
        if (!strategy) {
          return helpers.toToolResult(
            helpers.fail('webedit_merge_cells', { range: args.range }, errorCodes.WRITE_NOT_SUPPORTED, 'Target range does not expose merge APIs')
          );
        }
        return helpers.toToolResult(
          helpers.ok('webedit_merge_cells', { range: args.range }, {
            range: args.range,
            writeStrategy: strategy,
            after: await adapter.summarizeRange(range),
          })
        );
      }
    );

    registerTool(
      'webedit_unmerge_cells',
      '取消合并指定区域。',
      {
        type: 'object',
        properties: {
          range: { type: 'string', description: '区域地址，如 A1:B1' },
        },
        required: ['range'],
        additionalProperties: false,
      },
      async function (args) {
        const app = await adapter.getEditorApplication();
        const range = await resolveRange(adapter, app, args);
        if (!range) {
          return helpers.toToolResult(
            helpers.fail('webedit_unmerge_cells', { range: args && args.range }, errorCodes.RANGE_NOT_FOUND, 'Unable to resolve target range')
          );
        }
        const strategy = await adapter.unmergeRange(range);
        if (!strategy) {
          return helpers.toToolResult(
            helpers.fail('webedit_unmerge_cells', { range: args.range }, errorCodes.WRITE_NOT_SUPPORTED, 'Target range does not expose unmerge APIs')
          );
        }
        return helpers.toToolResult(
          helpers.ok('webedit_unmerge_cells', { range: args.range }, {
            range: args.range,
            writeStrategy: strategy,
            after: await adapter.summarizeRange(range),
          })
        );
      }
    );

    registerTool(
      'webedit_clear_contents',
      '清除指定区域内容。',
      {
        type: 'object',
        properties: {
          range: { type: 'string', description: '区域地址，如 J12 或 A1:B2' },
        },
        required: ['range'],
        additionalProperties: false,
      },
      async function (args) {
        const app = await adapter.getEditorApplication();
        const range = await resolveRange(adapter, app, args);
        if (!range) {
          return helpers.toToolResult(
            helpers.fail('webedit_clear_contents', { range: args && args.range }, errorCodes.RANGE_NOT_FOUND, 'Unable to resolve target range')
          );
        }
        const strategy = await adapter.clearRangeContents(range);
        if (!strategy) {
          return helpers.toToolResult(
            helpers.fail('webedit_clear_contents', { range: args.range }, errorCodes.WRITE_NOT_SUPPORTED, 'Target range does not expose clear contents APIs')
          );
        }
        return helpers.toToolResult(
          helpers.ok('webedit_clear_contents', { range: args.range }, {
            range: args.range,
            writeStrategy: strategy,
            after: await adapter.summarizeRange(range),
          })
        );
      }
    );

    registerTool(
      'webedit_set_row_height',
      '设置指定区域的行高。',
      {
        type: 'object',
        properties: {
          range: { type: 'string', description: '区域地址，如 1:1 或 A1:B2' },
          height: { type: 'number', description: '目标行高' },
        },
        required: ['range', 'height'],
        additionalProperties: false,
      },
      async function (args) {
        const app = await adapter.getEditorApplication();
        const range = await resolveRange(adapter, app, args);
        if (!range) {
          return helpers.toToolResult(
            helpers.fail('webedit_set_row_height', { range: args && args.range }, errorCodes.RANGE_NOT_FOUND, 'Unable to resolve target range')
          );
        }
        const strategy = await adapter.setRangeRowHeight(range, args.height);
        if (!strategy) {
          return helpers.toToolResult(
            helpers.fail('webedit_set_row_height', { range: args.range }, errorCodes.WRITE_NOT_SUPPORTED, 'Target range does not expose row height APIs')
          );
        }
        return helpers.toToolResult(
          helpers.ok('webedit_set_row_height', { range: args.range }, {
            range: args.range,
            height: args.height,
            writeStrategy: strategy,
          })
        );
      }
    );

    registerTool(
      'webedit_set_column_width',
      '设置指定区域的列宽。',
      {
        type: 'object',
        properties: {
          range: { type: 'string', description: '区域地址，如 A:A 或 A1:B2' },
          width: { type: 'number', description: '目标列宽' },
        },
        required: ['range', 'width'],
        additionalProperties: false,
      },
      async function (args) {
        const app = await adapter.getEditorApplication();
        const range = await resolveRange(adapter, app, args);
        if (!range) {
          return helpers.toToolResult(
            helpers.fail('webedit_set_column_width', { range: args && args.range }, errorCodes.RANGE_NOT_FOUND, 'Unable to resolve target range')
          );
        }
        const strategy = await adapter.setRangeColumnWidth(range, args.width);
        if (!strategy) {
          return helpers.toToolResult(
            helpers.fail('webedit_set_column_width', { range: args.range }, errorCodes.WRITE_NOT_SUPPORTED, 'Target range does not expose column width APIs')
          );
        }
        return helpers.toToolResult(
          helpers.ok('webedit_set_column_width', { range: args.range }, {
            range: args.range,
            width: args.width,
            writeStrategy: strategy,
          })
        );
      }
    );
  }

  global.__webeditStructureTools = {
    registerStructureTools: registerStructureTools,
  };
})(window);
