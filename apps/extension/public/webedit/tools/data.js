(function (global) {
  'use strict';

  if (global.__webeditDataTools) {
    return;
  }

  async function resolveRange(adapter, app, args) {
    return adapter.getRangeByAddress(app, args && args.range ? args.range : null);
  }

  function resolveRegistration(registerTool, deps) {
    if (typeof registerTool === 'function') {
      return {
        registerTool: registerTool,
        deps: deps || {},
      };
    }

    return {
      registerTool: registerTool && registerTool.registerTool,
      deps: registerTool || {},
    };
  }

  function registerDataTools(registerTool, deps) {
    const resolved = resolveRegistration(registerTool, deps);
    const adapter = resolved.deps.adapter;
    const helpers = resolved.deps.helpers;
    const errorCodes = resolved.deps.errorCodes || {};
    const toolRegistrar = resolved.registerTool;

    toolRegistrar(
      'webedit_sort_range',
      '对指定区域执行排序。',
      {
        type: 'object',
        properties: {
          range: { type: 'string', description: '目标区域地址，如 A1:C10' },
          hasHeader: { type: 'boolean', description: '是否包含表头，默认 true' },
          sorts: {
            type: 'array',
            description: '排序描述列表，按顺序生效',
            items: {
              type: 'object',
              properties: {
                key: {
                  type: 'string',
                  description: '排序键，可为列标识、列地址或运行时可识别的 key',
                },
                order: {
                  type: 'string',
                  enum: ['asc', 'desc'],
                  description: '排序方向',
                },
                type: {
                  type: 'string',
                  description: '可选，运行时识别的排序类型',
                },
              },
              required: ['key'],
              additionalProperties: false,
            },
          },
        },
        required: ['range', 'sorts'],
        additionalProperties: false,
      },
      async function (args) {
        const app = await adapter.getEditorApplication();
        const range = await resolveRange(adapter, app, args);
        if (!range) {
          return helpers.toToolResult(
            helpers.fail(
              'webedit_sort_range',
              { range: args && args.range },
              errorCodes.RANGE_NOT_FOUND,
              'Unable to resolve target range'
            )
          );
        }

        const before =
          typeof adapter.summarizeRange === 'function' ? await adapter.summarizeRange(range) : null;
        const result = await adapter.sortRange(range, args || {});
        if (!result) {
          return helpers.toToolResult(
            helpers.fail(
              'webedit_sort_range',
              { range: args.range },
              errorCodes.WRITE_NOT_SUPPORTED,
              'Target range does not expose sorting APIs'
            )
          );
        }

        return helpers.toToolResult(
          helpers.ok('webedit_sort_range', { range: args.range }, {
            range: args.range,
            hasHeader: args.hasHeader !== false,
            sorts: Array.isArray(args.sorts) ? args.sorts : [],
            writeStrategy: result.writeStrategy || null,
            header:
              typeof result.header === 'undefined'
                ? args.hasHeader !== false
                : result.header,
            before: before,
            after:
              typeof adapter.summarizeRange === 'function'
                ? await adapter.summarizeRange(range)
                : null,
          })
        );
      }
    );
  }

  global.__webeditDataTools = {
    registerDataTools: registerDataTools,
  };
})(window);
