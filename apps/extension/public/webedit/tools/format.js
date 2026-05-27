(function (global) {
  'use strict';

  if (global.__webeditFormatTools) {
    return;
  }

  async function getRange(adapter, app, address) {
    return adapter.getRangeByAddress(app, address);
  }

  async function summarizeRange(adapter, range) {
    if (!adapter || typeof adapter.summarizeRange !== 'function') {
      return null;
    }
    return adapter.summarizeRange(range);
  }

  function getWriteStrategy(result) {
    if (typeof result === 'string') {
      return result;
    }
    if (result && typeof result.writeStrategy === 'string') {
      return result.writeStrategy;
    }
    return null;
  }

  function resolveBorderEdges(args) {
    if (args && args.edges && typeof args.edges === 'object') {
      return {
        top: args.edges.top === true,
        bottom: args.edges.bottom === true,
        left: args.edges.left === true,
        right: args.edges.right === true,
        insideHorizontal: args.edges.insideHorizontal === true,
        insideVertical: args.edges.insideVertical === true,
      };
    }

    switch (args && args.preset) {
      case 'outer':
        return {
          top: true,
          bottom: true,
          left: true,
          right: true,
        };
      case 'inner':
        return {
          top: false,
          bottom: false,
          left: false,
          right: false,
          insideHorizontal: true,
          insideVertical: true,
        };
      case 'horizontal':
        return {
          top: false,
          bottom: false,
          left: false,
          right: false,
          insideHorizontal: true,
          insideVertical: false,
        };
      case 'vertical':
        return {
          top: false,
          bottom: false,
          left: false,
          right: false,
          insideHorizontal: false,
          insideVertical: true,
        };
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

  function registerFormatTools(registerTool, deps) {
    const adapter = deps.adapter;
    const helpers = deps.helpers;
    const errorCodes = deps.errorCodes;

    registerTool(
      'webedit_set_font',
      '设置指定区域的字体样式。',
      {
        type: 'object',
        properties: {
          range: { type: 'string', description: '区域地址，如 A1:B2' },
          bold: { type: 'boolean' },
          italic: { type: 'boolean' },
          underline: { type: 'boolean' },
          strikethrough: { type: 'boolean' },
          size: { type: 'number' },
          name: { type: 'string' },
          color: { type: 'string' },
        },
        required: ['range'],
        additionalProperties: false,
      },
      async function (args) {
        const app = await adapter.getEditorApplication();
        const range = await getRange(adapter, app, args && args.range);
        if (!range) {
          return helpers.toToolResult(
            helpers.fail('webedit_set_font', { range: args && args.range }, errorCodes.RANGE_NOT_FOUND, 'Unable to resolve target range')
          );
        }
        const applied = await adapter.setRangeFont(range, args || {});
        if (!applied) {
          return helpers.toToolResult(
            helpers.fail('webedit_set_font', { range: args.range }, errorCodes.WRITE_NOT_SUPPORTED, 'Target range does not expose font APIs')
          );
        }
        return helpers.toToolResult(
          helpers.ok('webedit_set_font', { range: args.range }, {
            range: args.range,
            font: args,
          })
        );
      }
    );

    registerTool(
      'webedit_set_fill',
      '设置指定区域的背景填充颜色。',
      {
        type: 'object',
        properties: {
          range: { type: 'string', description: '区域地址，如 A1:B2' },
          color: { type: 'string', description: '颜色值，如 #fff2cc' },
        },
        required: ['range', 'color'],
        additionalProperties: false,
      },
      async function (args) {
        const app = await adapter.getEditorApplication();
        const range = await getRange(adapter, app, args && args.range);
        if (!range) {
          return helpers.toToolResult(
            helpers.fail('webedit_set_fill', { range: args && args.range }, errorCodes.RANGE_NOT_FOUND, 'Unable to resolve target range')
          );
        }
        const applied = await adapter.setRangeFill(range, args.color);
        if (!applied) {
          return helpers.toToolResult(
            helpers.fail('webedit_set_fill', { range: args.range }, errorCodes.WRITE_NOT_SUPPORTED, 'Target range does not expose fill APIs')
          );
        }
        return helpers.toToolResult(
          helpers.ok('webedit_set_fill', { range: args.range }, {
            range: args.range,
            color: args.color,
          })
        );
      }
    );

    registerTool(
      'webedit_set_number_format',
      '设置指定区域的数字格式。',
      {
        type: 'object',
        properties: {
          range: { type: 'string', description: '区域地址，如 A1:B2' },
          numberFormat: { type: 'string', description: '数字格式，如 0.00 或 yyyy-mm-dd' },
        },
        required: ['range', 'numberFormat'],
        additionalProperties: false,
      },
      async function (args) {
        const app = await adapter.getEditorApplication();
        const range = await getRange(adapter, app, args && args.range);
        if (!range) {
          return helpers.toToolResult(
            helpers.fail('webedit_set_number_format', { range: args && args.range }, errorCodes.RANGE_NOT_FOUND, 'Unable to resolve target range')
          );
        }
        const strategy = await adapter.setRangeNumberFormat(range, args.numberFormat);
        if (!strategy) {
          return helpers.toToolResult(
            helpers.fail('webedit_set_number_format', { range: args.range }, errorCodes.WRITE_NOT_SUPPORTED, 'Target range does not expose number format APIs')
          );
        }
        return helpers.toToolResult(
          helpers.ok('webedit_set_number_format', { range: args.range }, {
            range: args.range,
            numberFormat: args.numberFormat,
            writeStrategy: strategy,
          })
        );
      }
    );

    registerTool(
      'webedit_set_wrap_text',
      '设置指定区域是否自动换行。',
      {
        type: 'object',
        properties: {
          range: { type: 'string', description: '区域地址，如 A1:B2' },
          wrapText: { type: 'boolean', description: '是否自动换行' },
        },
        required: ['range', 'wrapText'],
        additionalProperties: false,
      },
      async function (args) {
        const app = await adapter.getEditorApplication();
        const range = await getRange(adapter, app, args && args.range);
        if (!range) {
          return helpers.toToolResult(
            helpers.fail('webedit_set_wrap_text', { range: args && args.range }, errorCodes.RANGE_NOT_FOUND, 'Unable to resolve target range')
          );
        }
        const strategy = await adapter.setRangeWrapText(range, args.wrapText);
        if (!strategy) {
          return helpers.toToolResult(
            helpers.fail('webedit_set_wrap_text', { range: args.range }, errorCodes.WRITE_NOT_SUPPORTED, 'Target range does not expose wrap text APIs')
          );
        }
        return helpers.toToolResult(
          helpers.ok('webedit_set_wrap_text', { range: args.range }, {
            range: args.range,
            wrapText: args.wrapText,
            writeStrategy: strategy,
          })
        );
      }
    );

    registerTool(
      'webedit_set_alignment',
      '设置指定区域的对齐方式。',
      {
        type: 'object',
        properties: {
          range: { type: 'string', description: '区域地址，如 B8:J14' },
          horizontal: { type: 'string', description: '水平对齐方式' },
          vertical: { type: 'string', description: '垂直对齐方式' },
          wrapText: { type: 'boolean', description: '是否自动换行' },
          shrinkToFit: { type: 'boolean', description: '是否缩小字体填充' },
          indent: { type: 'number', description: '缩进级别' },
          textRotation: { type: 'number', description: '文字旋转角度' },
        },
        required: ['range'],
        additionalProperties: false,
      },
      async function (args) {
        const app = await adapter.getEditorApplication();
        const range = await getRange(adapter, app, args && args.range);
        if (!range) {
          return helpers.toToolResult(
            helpers.fail('webedit_set_alignment', { range: args && args.range }, errorCodes.RANGE_NOT_FOUND, 'Unable to resolve target range')
          );
        }
        const before = await summarizeRange(adapter, range);
        const result = await adapter.setRangeAlignment(range, args || {});
        const writeStrategy = getWriteStrategy(result);
        if (!writeStrategy) {
          return helpers.toToolResult(
            helpers.fail('webedit_set_alignment', { range: args.range }, errorCodes.WRITE_NOT_SUPPORTED, 'Target range does not expose alignment APIs')
          );
        }
        return helpers.toToolResult(
          helpers.ok('webedit_set_alignment', { range: args.range }, {
            range: args.range,
            horizontal: args.horizontal,
            vertical: args.vertical,
            wrapText: args.wrapText,
            shrinkToFit: args.shrinkToFit,
            indent: args.indent,
            textRotation: args.textRotation,
            writeStrategy: writeStrategy,
            before: before,
            after: await summarizeRange(adapter, range),
          })
        );
      }
    );

    registerTool(
      'webedit_set_border',
      '设置指定区域的边框。',
      {
        type: 'object',
        properties: {
          range: { type: 'string', description: '区域地址，如 B8:J14' },
          preset: { type: 'string', description: '边框预设，如 all 或 outer' },
          color: { type: 'string', description: '边框颜色' },
          style: { type: 'string', description: '边框线型' },
          weight: { type: 'string', description: '边框粗细' },
          edges: {
            type: 'object',
            properties: {
              top: { type: 'boolean' },
              bottom: { type: 'boolean' },
              left: { type: 'boolean' },
              right: { type: 'boolean' },
              insideHorizontal: { type: 'boolean' },
              insideVertical: { type: 'boolean' },
            },
            additionalProperties: false,
          },
        },
        required: ['range'],
        additionalProperties: false,
      },
      async function (args) {
        const app = await adapter.getEditorApplication();
        const range = await getRange(adapter, app, args && args.range);
        if (!range) {
          return helpers.toToolResult(
            helpers.fail('webedit_set_border', { range: args && args.range }, errorCodes.RANGE_NOT_FOUND, 'Unable to resolve target range')
          );
        }
        const before = await summarizeRange(adapter, range);
        const result = await adapter.setRangeBorder(range, args || {});
        const writeStrategy = getWriteStrategy(result);
        if (!writeStrategy) {
          return helpers.toToolResult(
            helpers.fail('webedit_set_border', { range: args.range }, errorCodes.WRITE_NOT_SUPPORTED, 'Target range does not expose border APIs')
          );
        }
        return helpers.toToolResult(
          helpers.ok('webedit_set_border', { range: args.range }, {
            range: args.range,
            appliedPreset: args && typeof args.preset === 'string' ? args.preset : null,
            appliedEdges: resolveBorderEdges(args),
            color: args.color,
            style: args.style,
            weight: args.weight,
            writeStrategy: writeStrategy,
            before: before,
            after: await summarizeRange(adapter, range),
          })
        );
      }
    );
  }

  global.__webeditFormatTools = {
    registerFormatTools: registerFormatTools,
  };
})(window);
