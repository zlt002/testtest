(function (global) {
  'use strict';

  if (global.__webeditFlowTools) {
    return;
  }

  const DEFAULT_ERROR_CODES = {
    FLOW_RUNTIME_NOT_READY: 'flow_runtime_not_ready',
    FLOW_MODE_NOT_DETECTED: 'flow_mode_not_detected',
    FLOW_DEFINITION_UNAVAILABLE: 'flow_definition_unavailable',
    FLOW_WRITE_NOT_SUPPORTED: 'flow_write_not_supported',
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

  async function resolveValue(value) {
    return value && typeof value.then === 'function' ? await value : value;
  }

  async function safeAdapterCall(adapter, methodName, args, fallbackValue) {
    if (!adapter || typeof adapter[methodName] !== 'function') {
      return fallbackValue === undefined ? null : fallbackValue;
    }

    try {
      return await resolveValue(adapter[methodName](args));
    } catch (error) {
      return {
        supported: false,
        reason: 'adapter_call_failed',
        action: methodName,
        error: error && error.message ? error.message : String(error),
      };
    }
  }

  function ensureRuntimeReady(adapter, helpers, errorCodes) {
    if (adapter && typeof adapter.isRuntimeReady === 'function' && adapter.isRuntimeReady() !== true) {
      return helpers.fail(new Error('Flow runtime is not ready'), {
        code: errorCodes.FLOW_RUNTIME_NOT_READY,
      });
    }

    return null;
  }

  async function detectFlowMode(adapter) {
    if (adapter && typeof adapter.detectRuntimeMode === 'function') {
      return await resolveValue(adapter.detectRuntimeMode());
    }

    return 'unknown';
  }

  function ensureFlowMode(mode, helpers, errorCodes) {
    if (mode === 'flow') {
      return null;
    }

    return helpers.fail(new Error('Current runtime is not a flow runtime'), {
      code: errorCodes.FLOW_MODE_NOT_DETECTED,
      meta: { mode: mode },
    });
  }

  function normalizeBoolean(value, fallbackValue) {
    return typeof value === 'boolean' ? value : fallbackValue;
  }

  function normalizeDefinitionArgs(args) {
    const input = args && typeof args === 'object' ? args : {};
    const definition =
      input.definition && typeof input.definition === 'object'
        ? input.definition
        : {
            nodes: Array.isArray(input.nodes) ? input.nodes : [],
            edges: Array.isArray(input.edges) ? input.edges : [],
            meta: input.meta && typeof input.meta === 'object' ? input.meta : undefined,
          };

    return {
      definition: definition,
      clearExisting: normalizeBoolean(input.clearExisting, true),
      beautify: normalizeBoolean(input.beautify, true),
    };
  }

  function buildFlowSummary(definition) {
    const source = definition && typeof definition === 'object' ? definition : {};
    const nodes = Array.isArray(source.nodes) ? source.nodes : [];
    const edges = Array.isArray(source.edges) ? source.edges : [];

    return {
      nodesCount: nodes.length,
      edgesCount: edges.length,
      totalCount: nodes.length + edges.length,
      sampleNodeTexts: nodes
        .map(function (node) {
          if (!node || typeof node !== 'object') {
            return null;
          }

          if (typeof node.text === 'string' && node.text.trim()) {
            return node.text.trim();
          }

          const textBlock = Array.isArray(node.textBlock) ? node.textBlock : [];
          if (textBlock[0] && typeof textBlock[0].text === 'string') {
            return textBlock[0].text.trim();
          }

          return node.name || null;
        })
        .filter(Boolean)
        .slice(0, 10),
    };
  }

  function registerFlowTools(deps) {
    const resolved = resolveDeps(deps);
    const adapter = resolved.adapter;
    const helpers = resolved.helpers;
    const errorCodes = resolved.errorCodes;
    const registerTool = resolved.registerTool;

    registerTool(
      'webedit_get_flow_context',
      '返回当前流程图 runtime 的上下文、页面标识和能力探测结果。',
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

        const mode = await detectFlowMode(adapter);
        const modeError = ensureFlowMode(mode, helpers, errorCodes);
        if (modeError) {
          return modeError;
        }

        return helpers.ok({
          runtimeReady:
            typeof adapter.isRuntimeReady === 'function' ? adapter.isRuntimeReady() : false,
          mode: mode,
          document:
            typeof adapter.detectDocumentIdentity === 'function'
              ? adapter.detectDocumentIdentity()
              : null,
          runtimeFlags:
            typeof adapter.getRuntimeFlags === 'function' ? adapter.getRuntimeFlags() : undefined,
          capabilities:
            typeof adapter.listFlowCapabilities === 'function'
              ? await resolveValue(adapter.listFlowCapabilities())
              : null,
        });
      }
    );

    registerTool(
      'webedit_debug_flow_api',
      '返回当前流程图 runtime 的 Model/Designer/Beautify/智能入口探测结果。',
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

        const mode = await detectFlowMode(adapter);
        const modeError = ensureFlowMode(mode, helpers, errorCodes);
        if (modeError) {
          return modeError;
        }

        return helpers.ok({
          mode: mode,
          document:
            typeof adapter.detectDocumentIdentity === 'function'
              ? adapter.detectDocumentIdentity()
              : null,
          runtimeFlags:
            typeof adapter.getRuntimeFlags === 'function' ? adapter.getRuntimeFlags() : undefined,
          capabilities:
            typeof adapter.listFlowCapabilities === 'function'
              ? await resolveValue(adapter.listFlowCapabilities())
              : null,
          apiProbe:
            typeof adapter.inspectFlowRuntime === 'function'
              ? await resolveValue(adapter.inspectFlowRuntime())
              : null,
        });
      }
    );

    registerTool(
      'webedit_read_flow_definition',
      '读取当前画布中的流程图定义，返回 nodes、edges 和摘要。',
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

        const mode = await detectFlowMode(adapter);
        const modeError = ensureFlowMode(mode, helpers, errorCodes);
        if (modeError) {
          return modeError;
        }

        const definition =
          typeof adapter.readFlowDefinition === 'function'
            ? await resolveValue(adapter.readFlowDefinition())
            : null;

        if (!definition) {
          return helpers.fail(new Error('Flow definition is unavailable'), {
            code: errorCodes.FLOW_DEFINITION_UNAVAILABLE,
            meta: { mode: mode },
          });
        }

        return helpers.ok({
          mode: mode,
          definition: definition,
        });
      }
    );

    registerTool(
      'webedit_beautify_flow',
      '对当前流程图画布执行自动美化/整理布局。',
      {
        type: 'object',
        properties: {
          theme: {
            type: 'string',
            description: '可选，美化时使用的主题名。',
          },
        },
        additionalProperties: false,
      },
      async function (args) {
        const runtimeError = ensureRuntimeReady(adapter, helpers, errorCodes);
        if (runtimeError) {
          return runtimeError;
        }

        const mode = await detectFlowMode(adapter);
        const modeError = ensureFlowMode(mode, helpers, errorCodes);
        if (modeError) {
          return modeError;
        }

        const result = await safeAdapterCall(adapter, 'beautifyFlow', args, null);

        if (!result || result.supported === false) {
          return helpers.fail(new Error('Flow beautify is not supported in the current runtime'), {
            code: errorCodes.FLOW_WRITE_NOT_SUPPORTED,
            meta: {
              mode: mode,
              action: 'beautify',
              result: result || null,
            },
          });
        }

        return helpers.ok({
          mode: mode,
          result: result,
        });
      }
    );

    registerTool(
      'webedit_apply_flow_definition',
      '将结构化的流程图定义写入当前画布，可选先清空再写入，并在写入后自动美化。',
      {
        type: 'object',
        properties: {
          definition: {
            type: 'object',
            description: '完整流程图定义，推荐包含 nodes 和 edges。',
          },
          nodes: {
            type: 'array',
            description: '节点数组；未传 definition 时可单独传入。',
            items: { type: 'object' },
          },
          edges: {
            type: 'array',
            description: '连线数组；未传 definition 时可单独传入。',
            items: { type: 'object' },
          },
          clearExisting: {
            type: 'boolean',
            description: '是否在写入前清空现有画布，默认 true。',
          },
          beautify: {
            type: 'boolean',
            description: '写入后是否自动美化，默认 true。',
          },
          meta: {
            type: 'object',
            description: '可选元数据，不直接影响写入。',
          },
        },
        additionalProperties: false,
      },
      async function (args) {
        const runtimeError = ensureRuntimeReady(adapter, helpers, errorCodes);
        if (runtimeError) {
          return runtimeError;
        }

        const mode = await detectFlowMode(adapter);
        const modeError = ensureFlowMode(mode, helpers, errorCodes);
        if (modeError) {
          return modeError;
        }

        const normalized = normalizeDefinitionArgs(args);
        const summary = buildFlowSummary(normalized.definition);
        if (summary.totalCount === 0) {
          return helpers.fail(new Error('Flow definition is empty'), {
            code: errorCodes.INVALID_ARGUMENT,
            meta: { mode: mode },
          });
        }

        let clearResult = null;
        if (normalized.clearExisting) {
          clearResult = await safeAdapterCall(adapter, 'clearFlowCanvas', undefined, null);

          if (!clearResult || clearResult.supported === false) {
            return helpers.fail(new Error('Flow clear canvas is not supported in the current runtime'), {
              code: errorCodes.FLOW_WRITE_NOT_SUPPORTED,
              meta: {
                mode: mode,
                action: 'clear',
                result: clearResult || null,
              },
            });
          }
        }

        const writeResult = await safeAdapterCall(
          adapter,
          'addFlowElements',
          normalized.definition,
          null
        );

        if (!writeResult || writeResult.supported === false) {
          return helpers.fail(new Error('Flow definition write is not supported in the current runtime'), {
            code: errorCodes.FLOW_WRITE_NOT_SUPPORTED,
            meta: {
              mode: mode,
              action: 'write',
              result: writeResult || null,
            },
          });
        }

        let beautifyResult = null;
        if (normalized.beautify) {
          beautifyResult = await safeAdapterCall(adapter, 'beautifyFlow', {}, null);
        }

        const afterDefinition =
          typeof adapter.readFlowDefinition === 'function'
            ? await resolveValue(adapter.readFlowDefinition())
            : null;

        return helpers.ok({
          mode: mode,
          requested: {
            clearExisting: normalized.clearExisting,
            beautify: normalized.beautify,
            summary: summary,
          },
          clearResult: clearResult,
          writeResult: writeResult,
          beautifyResult: beautifyResult,
          afterDefinition: afterDefinition,
        });
      }
    );
  }

  global.__webeditFlowTools = {
    registerFlowTools: registerFlowTools,
  };
})(window);
