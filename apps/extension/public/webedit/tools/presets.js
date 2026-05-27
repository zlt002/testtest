(function (global) {
  'use strict';

  if (global.__webeditPresetTools) {
    return;
  }

  function createStep(tool, targetRange, args, extra) {
    return Object.assign(
      {
        tool: tool,
        targetRange: targetRange,
        args: args,
      },
      extra || {}
    );
  }

  function parseA1Range(range) {
    if (typeof range !== 'string' || !range) {
      return null;
    }

    const match = /^([A-Z]+)(\d+)(?::([A-Z]+)(\d+))?$/i.exec(range.trim());
    if (!match) {
      return null;
    }

    return {
      startColumn: match[1].toUpperCase(),
      startRow: Number(match[2]),
      endColumn: (match[3] || match[1]).toUpperCase(),
      endRow: Number(match[4] || match[2]),
    };
  }

  function resolveHeaderRange(range, explicitHeaderRange) {
    if (explicitHeaderRange) {
      return explicitHeaderRange;
    }

    const parsed = parseA1Range(range);
    if (!parsed) {
      return range;
    }

    return parsed.startColumn + parsed.startRow + ':' + parsed.endColumn + parsed.startRow;
  }

  function buildSteps(args) {
    const range = args && args.range ? args.range : null;
    const headerRange = resolveHeaderRange(range, args && args.headerRange);
    const titleRange = args && args.titleRange ? args.titleRange : null;
    const autoAlign = !args || args.autoAlign !== false;
    const withBorder = !args || args.withBorder !== false;

    const steps = [];

    if (titleRange) {
      steps.push(
        createStep(
          'webedit_set_font',
          titleRange,
          {
            range: titleRange,
            bold: true,
            size: 14,
          },
          {
            label: 'title-font',
          }
        )
      );
      steps.push(
        createStep(
          'webedit_set_alignment',
          titleRange,
          {
            range: titleRange,
            horizontal: 'center',
            vertical: 'middle',
            wrapText: !args || args.autoWrap !== false,
          },
          {
            label: 'title-alignment',
          }
        )
      );
    }

    steps.push(
      createStep(
        'webedit_set_font',
        headerRange,
        {
          range: headerRange,
          bold: args && args.headerBold !== false,
        },
        {
          label: 'header-font',
        }
      )
    );

    steps.push(
      createStep(
        'webedit_set_fill',
        headerRange,
        {
          range: headerRange,
          color: args && args.theme === 'gray' ? '#d9d9d9' : '#dbeafe',
        },
        {
          label: 'header-fill',
        }
      )
    );

    steps.push(
      createStep(
        'webedit_set_alignment',
        range,
        autoAlign
          ? {
              range: range,
              horizontal: 'center',
              vertical: 'middle',
              wrapText: !args || args.autoWrap !== false,
            }
          : undefined,
        {
          label: 'table-alignment',
          skipped: autoAlign ? undefined : true,
        }
      )
    );

    steps.push(
      createStep(
        'webedit_set_border',
        range,
        withBorder
          ? {
              range: range,
              preset: args && args.withInnerGrid ? 'all' : 'outer',
              style: 'solid',
              color: '#D9D9D9',
            }
          : undefined,
        {
          label: 'table-border',
          skipped: withBorder ? undefined : true,
        }
      )
    );

    return steps;
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

  function registerPresetTools(registerTool, deps) {
    const resolved = resolveRegistration(registerTool, deps);
    const adapter = resolved.deps.adapter;
    const helpers = resolved.deps.helpers;
    const errorCodes = resolved.deps.errorCodes || {};

    async function executeStep(step, args) {
      if (!step || step.skipped) {
        return Object.assign({}, step, {
          ok: true,
          skipped: true,
        });
      }

      const app = await adapter.getEditorApplication();
      const range = await adapter.getRangeByAddress(app, args.range);
      if (!range) {
        return Object.assign({}, step, {
          ok: false,
          error: {
            code: errorCodes.RANGE_NOT_FOUND || 'range_not_found',
            message: 'Unable to resolve target range',
          },
        });
      }

      let writeStrategy = null;
      if (step.tool === 'webedit_set_font') {
        writeStrategy = (await adapter.setRangeFont(range, args)) ? 'Range.Font' : null;
      } else if (step.tool === 'webedit_set_fill') {
        writeStrategy = (await adapter.setRangeFill(range, args.color)) ? 'Range.Fill' : null;
      } else if (step.tool === 'webedit_set_alignment') {
        writeStrategy = await adapter.setRangeAlignment(range, args);
      } else if (step.tool === 'webedit_set_border') {
        writeStrategy = await adapter.setRangeBorder(range, args);
      }

      if (!writeStrategy) {
        return Object.assign({}, step, {
          ok: false,
          error: {
            code: errorCodes.WRITE_NOT_SUPPORTED || 'write_not_supported',
            message: 'Target range does not expose required style APIs',
          },
        });
      }

      return Object.assign({}, step, {
        ok: true,
        writeStrategy: writeStrategy,
      });
    }

    resolved.registerTool(
      'webedit_apply_table_style',
      '对指定区域应用稳定的标准表格样式组合。',
      {
        type: 'object',
        properties: {
          range: { type: 'string', description: '整个表格区域，如 B8:J14' },
          headerRange: { type: 'string', description: '表头区域，默认等于 range 的首行' },
          titleRange: { type: 'string', description: '可选标题区域' },
          theme: { type: 'string', description: '预设主题，默认 blue' },
          withBorder: { type: 'boolean', description: '是否包含外边框，默认 true' },
          withInnerGrid: { type: 'boolean', description: '是否包含内部网格线' },
          headerBold: { type: 'boolean', description: '表头是否加粗，默认 true' },
          autoAlign: { type: 'boolean', description: '是否加入居中对齐步骤，默认 true' },
          autoWrap: { type: 'boolean', description: '是否在对齐步骤中启用自动换行，默认 true' },
          autoWidth: { type: 'boolean', description: '预留字段，第一版仅回显配置' },
        },
        required: ['range'],
        additionalProperties: false,
      },
      async function (args) {
        const safeArgs = args || {};
        const steps = buildSteps(safeArgs);
        const before =
          adapter && typeof adapter.getEditorApplication === 'function'
            ? await (async function () {
                const app = await adapter.getEditorApplication();
                const range = await adapter.getRangeByAddress(app, safeArgs.range);
                return range && typeof adapter.summarizeRange === 'function'
                  ? await adapter.summarizeRange(range)
                  : null;
              })()
            : null;
        const executedSteps = [];

        for (let index = 0; index < steps.length; index += 1) {
          const step = steps[index];
          executedSteps.push(await executeStep(step, step.args || {}));
        }

        const failedSteps = executedSteps.filter(function (step) {
          return step.ok === false;
        });
        const succeededSteps = executedSteps.filter(function (step) {
          return step.ok === true && step.skipped !== true;
        });
        const after =
          adapter && typeof adapter.getEditorApplication === 'function'
            ? await (async function () {
                const app = await adapter.getEditorApplication();
                const range = await adapter.getRangeByAddress(app, safeArgs.range);
                return range && typeof adapter.summarizeRange === 'function'
                  ? await adapter.summarizeRange(range)
                  : null;
              })()
            : null;

        if (failedSteps.length > 0) {
          return helpers.toToolResult(
            {
              ok: false,
              operation: 'webedit_apply_table_style',
              target: { range: safeArgs.range },
              data: {
                range: safeArgs.range,
                headerRange: resolveHeaderRange(safeArgs.range, safeArgs.headerRange),
                titleRange: safeArgs.titleRange || null,
                theme: safeArgs.theme || 'blue',
                options: {
                  withBorder: safeArgs.withBorder !== false,
                  withInnerGrid: safeArgs.withInnerGrid === true,
                  headerBold: safeArgs.headerBold !== false,
                  autoAlign: safeArgs.autoAlign !== false,
                  autoWrap: safeArgs.autoWrap !== false,
                  autoWidth: safeArgs.autoWidth === true,
                },
                overallStatus: 'partial_success',
                steps: executedSteps,
                before: before,
                after: after,
              },
              error: {
                code: errorCodes.PARTIAL_SUCCESS || 'partial_success',
                message: 'Some style steps failed',
                details: {
                  succeeded: succeededSteps.map(function (step) {
                    return step.tool;
                  }),
                  failed: failedSteps.map(function (step) {
                    return step.tool;
                  }),
                },
              },
            },
            { isError: true }
          );
        }

        return helpers.toToolResult(
          helpers.ok('webedit_apply_table_style', { range: safeArgs.range }, {
            range: safeArgs.range,
            headerRange: resolveHeaderRange(safeArgs.range, safeArgs.headerRange),
            titleRange: safeArgs.titleRange || null,
            theme: safeArgs.theme || 'blue',
            options: {
              withBorder: safeArgs.withBorder !== false,
              withInnerGrid: safeArgs.withInnerGrid === true,
              headerBold: safeArgs.headerBold !== false,
              autoAlign: safeArgs.autoAlign !== false,
              autoWrap: safeArgs.autoWrap !== false,
              autoWidth: safeArgs.autoWidth === true,
            },
            overallStatus: 'success',
            steps: executedSteps,
            before: before,
            after: after,
          })
        );
      }
    );
  }

  global.__webeditPresetTools = {
    registerPresetTools: registerPresetTools,
  };
})(window);
