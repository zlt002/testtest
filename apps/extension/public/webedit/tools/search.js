(function (global) {
  'use strict';

  if (global.__webeditSearchTools) {
    return;
  }

  function registerSearchTools(registerTool, deps) {
    const adapter = deps.adapter;
    const helpers = deps.helpers;

    registerTool(
      'webedit_find_text',
      '在指定区域或当前表中查找文本。',
      {
        type: 'object',
        properties: {
          query: { type: 'string', description: '要查找的文本' },
          range: { type: 'string', description: '可选范围，如 B8:J14' },
          matchCase: { type: 'boolean', description: '是否区分大小写' },
          matchEntireCell: { type: 'boolean', description: '是否整单元格匹配' },
          searchBy: { type: 'string', description: '查找字段：value、text 或 formula' },
          returnAll: { type: 'boolean', description: '是否返回全部命中项' },
        },
        required: ['query'],
        additionalProperties: false,
      },
      async function (args) {
        const app = await adapter.getEditorApplication();
        const matches = await adapter.findText(app, args.query, args || {});

        return helpers.toToolResult(
          helpers.ok('webedit_find_text', { query: args.query }, {
            query: args.query,
            searchRange: args && args.range ? args.range : null,
            matchCount: Array.isArray(matches) ? matches.length : 0,
            matches: Array.isArray(matches) ? matches : [],
          })
        );
      }
    );
  }

  global.__webeditSearchTools = {
    registerSearchTools: registerSearchTools,
  };
})(window);
