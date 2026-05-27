/**
 * WebEdit MCP Server - 注入到 webedit.midea.com iframe 中，通过 postMessage 暴露结构化表格工具
 * 通信协议:
 * - channel: 'mcp-iframe'
 * - type: 'mcp'
 * - direction: 'server-to-client' / 'client-to-server'
 */

(function () {
  'use strict';

  if (window.__webeditMcpServerInstalled) {
    return;
  }

  window.__webeditMcpServerInstalled = true;

  const CHANNEL = 'mcp-iframe';
  const POLL_INTERVAL_MS = 250;
  const MAX_WAIT_MS = 30000;
  const tools = new Map();
  let runtimeReady = false;
  let readyBroadcasted = false;

  const ERROR_CODES = {
    RUNTIME_NOT_READY: 'runtime_not_ready',
    SHEET_NOT_FOUND: 'sheet_not_found',
    RANGE_NOT_FOUND: 'range_not_found',
    WRITE_NOT_SUPPORTED: 'write_not_supported',
    INVALID_ARGUMENT: 'invalid_argument',
    TOOL_EXECUTION_FAILED: 'tool_execution_failed',
  };

  function log() {
    console.log.apply(console, ['[WebEdit MCP]'].concat(Array.prototype.slice.call(arguments)));
  }

  function warn() {
    console.warn.apply(console, ['[WebEdit MCP]'].concat(Array.prototype.slice.call(arguments)));
  }

  function sendToParent(payload) {
    try {
      window.parent.postMessage(
        {
          channel: CHANNEL,
          type: 'mcp',
          direction: 'server-to-client',
          payload: payload,
        },
        '*'
      );
    } catch (error) {
      warn('Failed to send message to parent:', error);
    }
  }

  function broadcastServerReady() {
    if (readyBroadcasted) {
      return;
    }

    readyBroadcasted = true;
    sendToParent('mcp-server-ready');
    log('Runtime ready, mcp-server-ready sent');
  }

  function createDependencies() {
    const adapter = window.__webeditRuntimeAdapter;
    const helpers = window.__webeditResultHelpers;

    if (!adapter) {
      throw new Error('WebEdit runtime adapter is not available');
    }

    if (!helpers) {
      throw new Error('WebEdit result helpers are not available');
    }

    return {
      adapter: adapter,
      helpers: helpers,
      errorCodes: ERROR_CODES,
    };
  }

  function createToolError(error, context) {
    const adapter = window.__webeditRuntimeAdapter;
    const helpers = window.__webeditResultHelpers;
    const runtimeFlags = adapter ? adapter.getRuntimeFlags() : {};

    return {
      code: -32000,
      message: 'Tool execution failed',
      data: {
        context: context,
        runtimeReady: runtimeReady,
        runtimeFlags: runtimeFlags,
        result: helpers
          ? helpers.fail(
              context,
              null,
              ERROR_CODES.TOOL_EXECUTION_FAILED,
              error && error.message ? error.message : String(error),
              {
                runtimeReady: runtimeReady,
                runtimeFlags: runtimeFlags,
              }
            )
          : {
              success: false,
              operation: context,
              target: null,
              data: {},
              error: {
                code: ERROR_CODES.TOOL_EXECUTION_FAILED,
                message: error && error.message ? error.message : String(error),
              },
            },
      },
    };
  }

  function registerTool(name, description, inputSchema, handler) {
    const normalizedName =
      typeof name === 'string' && name.indexOf('webedit_') === 0 ? name : 'webedit_' + name;

    tools.set(normalizedName, {
      description: description,
      inputSchema: inputSchema,
      handler: handler,
    });
    log('Registered tool:', normalizedName);
  }

  function registerToolModules() {
    const deps = createDependencies();
    const moduleDeps = Object.assign({}, deps, {
      registerTool: registerTool,
    });
    const moduleRegistrations = [
      window.__webeditContextTools && window.__webeditContextTools.registerContextTools,
      window.__webeditProbeTools && window.__webeditProbeTools.registerProbeTools,
      window.__webeditDocumentTools && window.__webeditDocumentTools.registerDocumentTools,
      window.__webeditFlowTools && window.__webeditFlowTools.registerFlowTools,
      window.__webeditCellTools && window.__webeditCellTools.registerCellTools,
      window.__webeditFormulaTools && window.__webeditFormulaTools.registerFormulaTools,
      window.__webeditFormatTools && window.__webeditFormatTools.registerFormatTools,
      window.__webeditStructureTools && window.__webeditStructureTools.registerStructureTools,
      window.__webeditSearchTools && window.__webeditSearchTools.registerSearchTools,
      window.__webeditDataTools && window.__webeditDataTools.registerDataTools,
      window.__webeditPresetTools && window.__webeditPresetTools.registerPresetTools,
    ].filter(Boolean);

    moduleRegistrations.forEach(function (registerModuleTools) {
      if (typeof registerModuleTools !== 'function') {
        return;
      }

      if (registerModuleTools.length >= 2) {
        registerModuleTools(registerTool, moduleDeps);
        return;
      }

      registerModuleTools(moduleDeps);
    });
  }

  async function handleRpcRequest(message) {
    const id = message.id;
    const method = message.method;
    const params = message.params || {};

    switch (method) {
      case 'initialize':
        sendToParent({
          jsonrpc: '2.0',
          id: id,
          result: {
            protocolVersion: '2024-11-05',
            capabilities: { tools: { listChanged: false } },
            serverInfo: { name: 'WebEdit-Midea', version: '0.2.0' },
          },
        });
        return;

      case 'notifications/initialized':
        return;

      case 'tools/list':
        sendToParent({
          jsonrpc: '2.0',
          id: id,
          result: {
            tools: Array.from(tools.entries()).map(function (entry) {
              return {
                name: entry[0],
                description: entry[1].description,
                inputSchema: entry[1].inputSchema,
              };
            }),
          },
        });
        return;

      case 'tools/call': {
        const toolName = params.name;
        const tool = tools.get(toolName);

        if (!tool) {
          sendToParent({
            jsonrpc: '2.0',
            id: id,
            error: {
              code: -32601,
              message: 'Tool not found: ' + toolName,
            },
          });
          return;
        }

        try {
          const result = await tool.handler(params.arguments || {});
          sendToParent({
            jsonrpc: '2.0',
            id: id,
            result: result,
          });
        } catch (error) {
          sendToParent({
            jsonrpc: '2.0',
            id: id,
            error: createToolError(error, 'tools/call:' + toolName),
          });
        }
        return;
      }

      default:
        sendToParent({
          jsonrpc: '2.0',
          id: id,
          error: {
            code: -32601,
            message: 'Method not found: ' + method,
          },
        });
    }
  }

  window.addEventListener('message', function (event) {
    const message = event.data;

    if (!message || message.channel !== CHANNEL || message.type !== 'mcp') {
      return;
    }

    if (message.direction !== 'client-to-server') {
      return;
    }

    if (message.payload === 'mcp-check-ready') {
      sendToParent('mcp-server-ready');
      return;
    }

    if (
      message.payload &&
      typeof message.payload === 'object' &&
      message.payload.jsonrpc === '2.0' &&
      message.payload.method
    ) {
      handleRpcRequest(message.payload).catch(function (error) {
        warn('RPC error:', error);
        sendToParent({
          jsonrpc: '2.0',
          id: message.payload.id,
          error: createToolError(error, 'rpc:' + message.payload.method),
        });
      });
    }
  });

  function waitForRuntimeReady() {
    const adapter = window.__webeditRuntimeAdapter;
    if (!adapter) {
      warn('Runtime adapter is missing; broadcasting ready for diagnostics only');
      sendToParent('mcp-server-ready');
      return;
    }

    if (adapter.isRuntimeReady()) {
      runtimeReady = true;
      broadcastServerReady();
      return;
    }

    log('Waiting for webedit runtime...');

    const startTime = Date.now();
    const timer = window.setInterval(function () {
      if (adapter.isRuntimeReady()) {
        window.clearInterval(timer);
        runtimeReady = true;
        broadcastServerReady();
        return;
      }

      if (Date.now() - startTime >= MAX_WAIT_MS) {
        window.clearInterval(timer);
        warn('Runtime was not detected within ' + MAX_WAIT_MS + 'ms');
        sendToParent('mcp-server-ready');
      }
    }, POLL_INTERVAL_MS);
  }

  registerToolModules();
  waitForRuntimeReady();
})();
