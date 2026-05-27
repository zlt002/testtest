(function () {
  'use strict';

  if (window.__webMcpPolyfillInstalled) {
    return;
  }
  window.__webMcpPolyfillInstalled = true;

  var CHANNEL = 'mcp-default';
  var PROTOCOL_VERSION = '2024-11-05';
  var SERVER_INFO = {
    name: 'accr Polyfill',
    version: '0.1.0',
  };
  var tools = new Map();
  var initialized = false;

  function isOpaqueOrFileLikeOrigin() {
    return (
      !window.location.origin ||
      window.location.origin === 'null' ||
      window.location.origin === 'file://' ||
      window.location.protocol === 'file:'
    );
  }

  function getMessageTargetOrigin() {
    return isOpaqueOrFileLikeOrigin() ? '*' : window.location.origin;
  }

  function isCurrentPageMessageOrigin(origin) {
    if (!isOpaqueOrFileLikeOrigin()) {
      return origin === window.location.origin;
    }

    return (
      origin === 'null' ||
      origin === 'file://' ||
      origin === '' ||
      origin === window.location.origin
    );
  }

  function send(payload) {
    window.postMessage(
      {
        channel: CHANNEL,
        type: 'mcp',
        direction: 'server-to-client',
        payload: payload,
      },
      getMessageTargetOrigin()
    );
  }

  function sendError(id, code, message) {
    send({
      jsonrpc: '2.0',
      id: id,
      error: {
        code: code,
        message: message,
      },
    });
  }

  function notifyToolsListChanged() {
    if (!initialized) {
      return;
    }

    send({
      jsonrpc: '2.0',
      method: 'notifications/tools/list_changed',
    });
  }

  function normalizeToolConfig(config) {
    var safeConfig = config && typeof config === 'object' ? config : {};
    var inputSchema = safeConfig.inputSchema;

    if (!inputSchema || typeof inputSchema !== 'object') {
      inputSchema = { type: 'object', properties: {} };
    }

    return {
      description: typeof safeConfig.description === 'string' ? safeConfig.description : '',
      inputSchema: inputSchema,
    };
  }

  function registerTool(name, config, handler) {
    if (typeof name !== 'string' || !name) {
      throw new Error('Tool name is required');
    }

    if (typeof handler !== 'function') {
      throw new Error('Tool handler must be a function');
    }

    var normalizedConfig = normalizeToolConfig(config);
    tools.set(name, {
      description: normalizedConfig.description,
      inputSchema: normalizedConfig.inputSchema,
      handler: handler,
    });

    notifyToolsListChanged();
  }

  function unregisterTool(name) {
    if (tools.delete(name)) {
      notifyToolsListChanged();
    }
  }

  function listTools() {
    return Array.from(tools.entries()).map(function (entry) {
      var name = entry[0];
      var tool = entry[1];
      return {
        name: name,
        description: tool.description,
        inputSchema: tool.inputSchema,
      };
    });
  }

  function installProperty(target, key, value) {
    Object.defineProperty(target, key, {
      configurable: true,
      enumerable: false,
      writable: true,
      value: value,
    });
  }

  var modelContext =
    navigator.modelContext && typeof navigator.modelContext === 'object'
      ? navigator.modelContext
      : {};

  modelContext.registerTool = registerTool;
  modelContext.unregisterTool = unregisterTool;

  installProperty(navigator, 'modelContext', modelContext);
  installProperty(window, 'registerTool', registerTool);
  installProperty(window, 'unregisterTool', unregisterTool);

  window.addEventListener('message', function (event) {
    if (!isCurrentPageMessageOrigin(event.origin)) {
      return;
    }

    var message = event.data;
    if (!message || message.channel !== CHANNEL || message.type !== 'mcp') {
      return;
    }

    if (message.direction !== 'client-to-server') {
      return;
    }

    var payload = message.payload;
    if (payload === 'mcp-check-ready') {
      send('mcp-server-ready');
      return;
    }

    if (!payload || typeof payload !== 'object' || payload.jsonrpc !== '2.0') {
      return;
    }

    if (payload.method === 'initialize') {
      initialized = true;
      send({
        jsonrpc: '2.0',
        id: payload.id,
        result: {
          protocolVersion: PROTOCOL_VERSION,
          capabilities: {
            tools: {
              listChanged: true,
            },
          },
          serverInfo: SERVER_INFO,
        },
      });
      return;
    }

    if (payload.method === 'tools/list') {
      send({
        jsonrpc: '2.0',
        id: payload.id,
        result: {
          tools: listTools(),
        },
      });
      return;
    }

    if (payload.method === 'tools/call') {
      Promise.resolve()
        .then(function () {
          var params = payload.params || {};
          var tool = tools.get(params.name);
          if (!tool) {
            sendError(payload.id, -32601, 'Tool not found: ' + params.name);
            return;
          }

          return Promise.resolve(tool.handler(params.arguments || {}))
            .then(function (result) {
              send({
                jsonrpc: '2.0',
                id: payload.id,
                result: result,
              });
            })
            .catch(function (error) {
              var messageText = error && error.message ? error.message : String(error);
              sendError(payload.id, -32000, messageText);
            });
        })
        .catch(function (error) {
          var messageText = error && error.message ? error.message : String(error);
          sendError(payload.id, -32000, messageText);
        });
      return;
    }

    sendError(payload.id, -32601, 'Method not found: ' + payload.method);
  });
})();
