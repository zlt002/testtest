/**
 * WPS MCP Server - 注入到 WPS iframe 中，通过 window.APP 内部 API 暴露 WPS 电子表格功能为 MCP 工具
 * 通过 IframeChildTransport 协议与父页面的内容脚本通信
 *
 * 通信协议:
 * - window.parent.postMessage() 发送
 * - channel: 'mcp-iframe'
 * - 类型: 'mcp' + JSON-RPC 2.0
 *
 * 内部 API:
 * - window.APP: 核心应用对象（提供 getActiveBook, getActiveSheet, getCell, getSelectionRange 等）
 * - Range 对象: setValue2, setFormula, merge, getFont, getInterior, setColumnWidth, setRowHeight 等
 */

(function () {
  'use strict';

  // 防止重复安装
  if (window.__wpsMcpServerInstalled) return;

  // 如果 window.APP 尚未加载，则轮询等待
  if (typeof window.APP === 'undefined') {
    console.log('[WPS-MCP] window.APP not yet available, polling...');
    const startTime = Date.now();
    const MAX_WAIT = 30000; // 最多等30秒
    const interval = setInterval(() => {
      if (typeof window.APP !== 'undefined') {
        clearInterval(interval);
        window.__wpsMcpServerInstalled = true;
        init();
      } else if (Date.now() - startTime > MAX_WAIT) {
        clearInterval(interval);
        console.log('[WPS-MCP] window.APP not found after 30s, giving up.');
      }
    }, 200);
    return;
  }

  window.__wpsMcpServerInstalled = true;
  init();

  function init() {

  console.log('[WPS-MCP] Initializing WPS MCP Server...');

  const CHANNEL = 'mcp-iframe';
  let serverStarted = false;
  const tools = new Map();
  let toolCounter = 0;

  // ============ MCP 协议层 ============

  /**
   * 向父页面发送消息
   */
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
    } catch (e) {
      console.warn('[WPS-MCP] Failed to send to parent:', e);
    }
  }

  /**
   * 广播 server-ready 信号
   */
  function broadcastServerReady() {
    // 符合 IframeChildTransport 协议: payload 为 'mcp-server-ready' 字符串
    sendToParent('mcp-server-ready');
    console.log('[WPS-MCP] Server ready broadcast sent');
  }

  /**
   * 处理 JSON-RPC 请求（标准 JSON-RPC 2.0 格式）
   */
  async function handleRpcRequest(msg) {
    const { id, method, params } = msg;

    switch (method) {
      case 'tools/list': {
        const toolList = [];
        tools.forEach((tool, name) => {
          toolList.push({
            name: name,
            description: tool.description,
            inputSchema: tool.inputSchema,
          });
        });
        sendToParent({ jsonrpc: '2.0', id: id, result: { tools: toolList } });
        break;
      }

      case 'tools/call': {
        const { name, arguments: args } = params || {};
        const tool = tools.get(name);
        if (!tool) {
          sendToParent({ jsonrpc: '2.0', id: id, error: { code: -32601, message: `Tool not found: ${name}` } });
          return;
        }
        try {
          const result = await tool.handler(args || {});
          sendToParent({ jsonrpc: '2.0', id: id, result: result });
        } catch (e) {
          sendToParent({ jsonrpc: '2.0', id: id, error: { code: -32000, message: e.message || String(e) } });
        }
        break;
      }

      case 'initialize': {
        sendToParent({
          jsonrpc: '2.0',
          id: id,
          result: {
            protocolVersion: '2024-11-05',
            capabilities: { tools: { listChanged: true } },
            serverInfo: { name: 'WPS-Spreadsheet', version: '2.0.0' },
          },
        });
        break;
      }

      case 'notifications/initialized': {
        // 客户端初始化完成，不需要响应
        break;
      }

      default: {
        sendToParent({ jsonrpc: '2.0', id: id, error: { code: -32601, message: `Method not found: ${method}` } });
      }
    }
  }

  // 监听来自父页面的消息
  window.addEventListener('message', (event) => {
    const msg = event.data;
    if (!msg || msg.channel !== CHANNEL || msg.type !== 'mcp') return;
    if (msg.direction !== 'client-to-server') return;

    const payload = msg.payload;

    // 处理 mcp-check-ready 消息
    if (payload === 'mcp-check-ready') {
      broadcastServerReady();
      return;
    }

    // 处理 JSON-RPC 消息
    if (payload && typeof payload === 'object' && payload.jsonrpc === '2.0' && payload.method) {
      handleRpcRequest(payload).catch((e) => {
        console.error('[WPS-MCP] RPC error:', e);
        sendToParent({
          jsonrpc: '2.0',
          id: payload.id,
          error: { code: -32000, message: e.message || 'Internal error' },
        });
      });
    }
  });

  // ============ 工具注册 ============

  function registerTool(name, description, inputSchema, handler) {
    tools.set(name, {
      description,
      inputSchema,
      handler,
    });
    toolCounter++;
    console.log(`[WPS-MCP] Registered tool: ${name}`);

    // 通知父页面工具列表变化
    if (serverStarted) {
      sendToParent({
        jsonrpc: '2.0',
        method: 'notifications/tools/list_changed',
      });
    }
  }

  // ============ WPS 核心帮助函数 ============

  function getApp() {
    if (typeof window.APP === 'undefined') {
      throw new Error('WPS Application not available');
    }
    return window.APP;
  }

  /**
   * 通过 sheetIndex 获取工作表，如果未指定则返回活动工作表
   * 注意：sheetIndex 从 1 开始
   */
  function getSheet(app, sheetIndex) {
    if (sheetIndex) {
      const wb = app.getActiveBook();
      const worksheets = wb.getWorksheets();
      return worksheets.item(sheetIndex);
    }
    return app.getActiveSheet();
  }

  /**
   * 将 hex 颜色字符串转换为 WPS 内部颜色数值（负数）
   * WPS 使用 BGR 格式的负整数表示颜色: -(R + G*256 + B*65536)
   */
  function hexToWpsColor(hex) {
    const h = hex.replace('#', '');
    const r = parseInt(h.slice(0, 2), 16);
    const g = parseInt(h.slice(2, 4), 16);
    const b = parseInt(h.slice(4, 6), 16);
    return -(r + g * 256 + b * 65536);
  }

  /**
   * 解析单元格地址为行列号（0-based）
   * 例如 "A1" -> {row:0, col:0}, "B2" -> {row:1, col:1}, "AA10" -> {row:9, col:26}
   */
  function parseCellAddress(address) {
    const match = address.match(/^([A-Z]+)(\d+)$/i);
    if (!match) throw new Error(`Invalid cell address: ${address}`);
    let col = 0;
    const colStr = match[1].toUpperCase();
    for (let i = 0; i < colStr.length; i++) {
      col = col * 26 + (colStr.charCodeAt(i) - 64);
    }
    return { row: parseInt(match[2]) - 1, col: col - 1 };
  }

  // ============ 注册 WPS 工具 ============

  async function registerAllTools() {
    try {
      const app = getApp();
      if (!app) {
        console.error('[WPS-MCP] Failed to get WPS Application');
        return;
      }
      console.log('[WPS-MCP] WPS Application connected, registering tools...');

      // --- 读取单元格 ---
      registerTool(
        'wps_read_cell',
        '读取 WPS 表格中指定单元格的值',
        {
          type: 'object',
          properties: {
            cell: { type: 'string', description: '单元格地址，如 A1, B2, C10' },
            sheetIndex: { type: 'number', description: '工作表索引（从1开始），默认使用活动工作表' },
          },
          required: ['cell'],
        },
        async (args) => {
          const sheet = getSheet(app, args.sheetIndex);
          const range = sheet.getRange(args.cell);
          const value = range.getActiveCellValue();
          return { content: [{ type: 'text', text: JSON.stringify({ cell: args.cell, value }) }] };
        }
      );

      // --- 写入单元格 ---
      registerTool(
        'wps_write_cell',
        '写入值到 WPS 表格的指定单元格',
        {
          type: 'object',
          properties: {
            cell: { type: 'string', description: '单元格地址，如 A1' },
            value: { type: 'string', description: '要写入的值（字符串或数字的字符串形式）' },
            sheetIndex: { type: 'number', description: '工作表索引（从1开始）' },
          },
          required: ['cell', 'value'],
        },
        async (args) => {
          const sheet = getSheet(app, args.sheetIndex);
          const range = sheet.getRange(args.cell);
          const numVal = Number(args.value);
          range.setValue2(isNaN(numVal) ? args.value : numVal);
          return { content: [{ type: 'text', text: `已写入 ${args.cell} = ${args.value}` }] };
        }
      );

      // --- 批量写入 ---
      registerTool(
        'wps_batch_write',
        '批量写入多个单元格到 WPS 表格（推荐用于填充表头、表单等场景）',
        {
          type: 'object',
          properties: {
            data: {
              type: 'object',
              description: '单元格地址到值的映射，如 {"A1":"标题","B1":"价格","A2":"产品A","B2":99.9}',
            },
            sheetIndex: { type: 'number', description: '工作表索引（从1开始）' },
          },
          required: ['data'],
        },
        async (args) => {
          const sheet = getSheet(app, args.sheetIndex);
          const entries = Object.entries(args.data);
          for (const [cell, val] of entries) {
            const range = sheet.getRange(cell);
            const numVal = Number(val);
            range.setValue2(isNaN(numVal) ? String(val) : numVal);
          }
          return { content: [{ type: 'text', text: `批量写入成功，共 ${entries.length} 个单元格` }] };
        }
      );

      // --- 设置公式 ---
      registerTool(
        'wps_set_formula',
        '在 WPS 表格单元格中设置公式',
        {
          type: 'object',
          properties: {
            cell: { type: 'string', description: '单元格地址，如 H2' },
            formula: { type: 'string', description: 'Excel 公式，如 =SUM(A1:A10)' },
            sheetIndex: { type: 'number', description: '工作表索引（从1开始）' },
          },
          required: ['cell', 'formula'],
        },
        async (args) => {
          const sheet = getSheet(app, args.sheetIndex);
          const range = sheet.getRange(args.cell);
          range.setFormula(args.formula);
          return { content: [{ type: 'text', text: `已设置 ${args.cell} 公式: ${args.formula}` }] };
        }
      );

      // --- 设置字体 ---
      registerTool(
        'wps_set_font',
        '设置 WPS 表格单元格的字体样式（加粗、斜体、字号、颜色等）',
        {
          type: 'object',
          properties: {
            range: { type: 'string', description: '单元格范围，如 A1 或 A1:F1' },
            bold: { type: 'boolean', description: '是否加粗' },
            italic: { type: 'boolean', description: '是否斜体' },
            underline: { type: 'boolean', description: '是否下划线' },
            strikethrough: { type: 'boolean', description: '是否删除线' },
            size: { type: 'number', description: '字号，如 12, 14, 16' },
            name: { type: 'string', description: '字体名称，如 微软雅黑, Arial' },
            color: { type: 'string', description: '字体颜色 hex，如 #FF0000' },
            sheetIndex: { type: 'number', description: '工作表索引（从1开始）' },
          },
          required: ['range'],
        },
        async (args) => {
          const sheet = getSheet(app, args.sheetIndex);
          const font = sheet.getRange(args.range).getFont();
          if (args.bold !== undefined) font.setBold(args.bold);
          if (args.italic !== undefined) font.setItalic(args.italic);
          if (args.underline !== undefined) font.setUnderline(args.underline);
          if (args.strikethrough !== undefined) font.setStrikethrough(args.strikethrough);
          if (args.size !== undefined) font.setSize(args.size);
          if (args.name !== undefined) font.setName(args.name);
          if (args.color !== undefined) font.setColor(hexToWpsColor(args.color));
          return { content: [{ type: 'text', text: `已设置 ${args.range} 字体样式` }] };
        }
      );

      // --- 设置背景样式 ---
      registerTool(
        'wps_set_style',
        '设置 WPS 表格单元格的背景填充颜色',
        {
          type: 'object',
          properties: {
            range: { type: 'string', description: '单元格范围，如 A1:F1' },
            bgColor: { type: 'string', description: '背景颜色 hex，如 #4472C4' },
            sheetIndex: { type: 'number', description: '工作表索引（从1开始）' },
          },
          required: ['range'],
        },
        async (args) => {
          const sheet = getSheet(app, args.sheetIndex);
          const interior = sheet.getRange(args.range).getInterior();
          if (args.bgColor !== undefined) {
            interior.setColor(hexToWpsColor(args.bgColor));
          }
          return { content: [{ type: 'text', text: `已设置 ${args.range} 背景样式` }] };
        }
      );

      // --- 合并单元格 ---
      registerTool(
        'wps_merge_cells',
        '合并 WPS 表格中的单元格区域',
        {
          type: 'object',
          properties: {
            range: { type: 'string', description: '要合并的单元格范围，如 A1:C1' },
            sheetIndex: { type: 'number', description: '工作表索引（从1开始）' },
          },
          required: ['range'],
        },
        async (args) => {
          const sheet = getSheet(app, args.sheetIndex);
          sheet.getRange(args.range).merge();
          return { content: [{ type: 'text', text: `已合并 ${args.range}` }] };
        }
      );

      // --- 取消合并 ---
      registerTool(
        'wps_unmerge_cells',
        '取消合并 WPS 表格中的单元格区域',
        {
          type: 'object',
          properties: {
            range: { type: 'string', description: '要取消合并的单元格范围，如 A1:C1' },
            sheetIndex: { type: 'number', description: '工作表索引（从1开始）' },
          },
          required: ['range'],
        },
        async (args) => {
          const sheet = getSheet(app, args.sheetIndex);
          sheet.getRange(args.range).unMerge();
          return { content: [{ type: 'text', text: `已取消合并 ${args.range}` }] };
        }
      );

      // --- 设置列宽 ---
      registerTool(
        'wps_set_column_width',
        '设置 WPS 表格中指定列的宽度',
        {
          type: 'object',
          properties: {
            columns: { type: 'string', description: '列标识，如 A:A（单列）, A:C（多列）' },
            width: { type: 'number', description: '列宽度数值' },
            sheetIndex: { type: 'number', description: '工作表索引（从1开始）' },
          },
          required: ['columns', 'width'],
        },
        async (args) => {
          const sheet = getSheet(app, args.sheetIndex);
          sheet.getRange(args.columns).setColumnWidth(args.width);
          return { content: [{ type: 'text', text: `已设置 ${args.columns} 列宽为 ${args.width}` }] };
        }
      );

      // --- 设置行高 ---
      registerTool(
        'wps_set_row_height',
        '设置 WPS 表格中指定行的高度',
        {
          type: 'object',
          properties: {
            rows: { type: 'string', description: '行标识，如 2:2（单行）, 2:10（多行）' },
            height: { type: 'number', description: '行高数值' },
            sheetIndex: { type: 'number', description: '工作表索引（从1开始）' },
          },
          required: ['rows', 'height'],
        },
        async (args) => {
          const sheet = getSheet(app, args.sheetIndex);
          sheet.getRange(args.rows).setRowHeight(args.height);
          return { content: [{ type: 'text', text: `已设置 ${args.rows} 行高为 ${args.height}` }] };
        }
      );

      // --- 设置数字格式 ---
      registerTool(
        'wps_set_number_format',
        '设置 WPS 表格单元格的数字格式（百分比、货币、日期等）',
        {
          type: 'object',
          properties: {
            range: { type: 'string', description: '单元格范围，如 F2' },
            numberFormat: { type: 'string', description: '格式字符串，如 0.00%, $#,##0.00, yyyy-mm-dd' },
            sheetIndex: { type: 'number', description: '工作表索引（从1开始）' },
          },
          required: ['range', 'numberFormat'],
        },
        async (args) => {
          const sheet = getSheet(app, args.sheetIndex);
          sheet.getRange(args.range).setNumberFormatLocal(args.numberFormat);
          return { content: [{ type: 'text', text: `已设置 ${args.range} 数字格式: ${args.numberFormat}` }] };
        }
      );

      // --- 自动换行 ---
      registerTool(
        'wps_set_wrap_text',
        '设置 WPS 表格单元格是否自动换行',
        {
          type: 'object',
          properties: {
            range: { type: 'string', description: '单元格范围，如 A1' },
            wrapText: { type: 'boolean', description: '是否自动换行' },
            sheetIndex: { type: 'number', description: '工作表索引（从1开始）' },
          },
          required: ['range', 'wrapText'],
        },
        async (args) => {
          const sheet = getSheet(app, args.sheetIndex);
          sheet.getRange(args.range).setWrapText(args.wrapText);
          return { content: [{ type: 'text', text: `已设置 ${args.range} 自动换行: ${args.wrapText}` }] };
        }
      );

      // --- 清除内容 ---
      registerTool(
        'wps_clear_contents',
        '清除 WPS 表格中指定范围的单元格内容',
        {
          type: 'object',
          properties: {
            range: { type: 'string', description: '单元格范围，如 A1:F10' },
            sheetIndex: { type: 'number', description: '工作表索引（从1开始）' },
          },
          required: ['range'],
        },
        async (args) => {
          const sheet = getSheet(app, args.sheetIndex);
          sheet.getRange(args.range).clearContents();
          return { content: [{ type: 'text', text: `已清除 ${args.range} 内容` }] };
        }
      );

      // --- 获取工作簿信息 ---
      registerTool(
        'wps_get_workbook_info',
        '获取 WPS 工作簿的信息（工作表列表、活动工作表等）',
        {
          type: 'object',
          properties: {
            infoType: {
              type: 'string',
              enum: ['sheet_names', 'active_sheet', 'active_cell'],
              description: '信息类型：sheet_names=所有工作表名称, active_sheet=活动工作表名, active_cell=当前活动单元格',
            },
          },
          required: ['infoType'],
        },
        async (args) => {
          const wb = app.getActiveBook();
          switch (args.infoType) {
            case 'sheet_names': {
              const worksheets = wb.getWorksheets();
              const names = [];
              let idx = 1;
              let sheet;
              try {
                while ((sheet = worksheets.item(idx))) {
                  names.push(sheet.getName());
                  idx++;
                }
              } catch (e) {
                // 索引超出范围，停止
              }
              return { content: [{ type: 'text', text: JSON.stringify({ count: names.length, names }) }] };
            }
            case 'active_sheet': {
              const sheet = app.getActiveSheet();
              const name = sheet.getName();
              return { content: [{ type: 'text', text: JSON.stringify({ name }) }] };
            }
            case 'active_cell': {
              const value = app.getSelectionRange().getActiveCellValue();
              return { content: [{ type: 'text', text: JSON.stringify({ value }) }] };
            }
          }
        }
      );

      // --- 执行自定义 WPS 脚本 ---
      registerTool(
        'wps_execute_script',
        '在 WPS 表格中执行自定义 JavaScript 代码。可访问变量: APP (核心应用), app (同APP), sheet (活动工作表), range (当前选区)。使用带 get/set 前缀的方法操作属性。',
        {
          type: 'object',
          properties: {
            code: { type: 'string', description: '要执行的 JavaScript 代码。可访问 APP, sheet, range 变量' },
          },
          required: ['code'],
        },
        async (args) => {
          try {
            const sheet = app.getActiveSheet();
            const range = app.getSelectionRange();
            const result = eval(`(function() { ${args.code} })()`);
            return { content: [{ type: 'text', text: JSON.stringify({ success: true, result }) }] };
          } catch (e) {
            return { content: [{ type: 'text', text: JSON.stringify({ success: false, error: e.message }) }], isError: true };
          }
        }
      );

      console.log(`[WPS-MCP] All ${toolCounter} tools registered`);
    } catch (e) {
      console.error('[WPS-MCP] Failed to register tools:', e);
    }
  }

  // ============ 启动 ============

  async function start() {
    await registerAllTools();
    serverStarted = true;
    // 广播 server-ready
    broadcastServerReady();
    const retryInterval = setInterval(() => {
      if (!serverStarted) {
        clearInterval(retryInterval);
        return;
      }
      broadcastServerReady();
    }, 1000);
    // 15秒后停止重试
    setTimeout(() => clearInterval(retryInterval), 15000);
  }

  start().catch(console.error);
  } // end init()

})();
