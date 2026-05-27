/**
 * WPS 在线表格自动化工具
 * 
 * 该模块提供了一组用于自动化 WPS 在线表格编辑器的 MCP 工具。
 * 通过 Chrome 的 userScripts API 在目标标签页中执行 JavaScript 代码，
 * 调用 WPSOpenApi 来实现单元格读写、格式设置、公式计算等功能。
 * 
 * 技术要求：
 * - Chrome 135+（支持 chrome.userScripts.execute）
 * - 需要 userScripts 权限
 * - 目标标签页必须加载 WPS WebOffice 页面
 */

// 导入扩展工具基类和类型
import { type ApiAvailability, BaseApiTools } from '@mcp-b/extension-tools';

// 导入 MCP 服务器类型定义
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

// 导入 Zod 用于输入模式验证
import { z } from 'zod';

/**
 * WPS 表格工具配置选项接口
 * 
 * 每个可选属性对应一个 WPS 自动化功能的启用/禁用开关。
 */
export interface WpsSpreadsheetToolsOptions {
  /** 是否检测 WPS 可用性 */
  isAvailable?: boolean;
  /** 是否启用读取单元格功能 */
  readCell?: boolean;
  /** 是否启用写入单元格功能 */
  writeCell?: boolean;
  /** 是否启用批量写入功能 */
  batchWrite?: boolean;
  /** 是否启用设置公式功能 */
  setFormula?: boolean;
  /** 是否启用设置字体功能 */
  setFont?: boolean;
  /** 是否启用设置样式功能 */
  setStyle?: boolean;
  /** 是否启用设置边框功能 */
  setBorder?: boolean;
  /** 是否启用合并单元格功能 */
  mergeCells?: boolean;
  /** 是否启用设置对齐方式功能 */
  setAlignment?: boolean;
  /** 是否启用设置列宽功能 */
  setColumnWidth?: boolean;
  /** 是否启用设置行高功能 */
  setRowHeight?: boolean;
  /** 是否启用设置数字格式功能 */
  setNumberFormat?: boolean;
  /** 是否启用获取工作簿信息功能 */
  getInfo?: boolean;
}

/**
 * WPS 表格工具类
 * 
 * 该类继承自 BaseApiTools，提供 WPS 在线表格的自动化功能。
 * 所有工具都通过在目标标签页中执行 JavaScript 代码来调用 WPSOpenApi。
 */
export class WpsSpreadsheetTools extends BaseApiTools {
  /** API 名称标识 */
  protected apiName = 'WpsSpreadsheet';

  /**
   * 构造函数
   * @param server - MCP 服务器实例
   * @param options - 工具配置选项
   */
  constructor(server: McpServer, options: WpsSpreadsheetToolsOptions = {}) {
    super(server, options);
  }

  /**
   * 检查 WPS 表格工具的可用性
   * 
   * 该方法检查 Chrome runtime 和 chrome.userScripts.execute API 是否可用。
   * 这是使用 WPS 工具的前提条件。
   * 
   * @returns API 可用性信息
   */
  checkAvailability(): ApiAvailability {
    try {
      // 检查 Chrome runtime 是否可用（需要在扩展后台上下文中）
      if (typeof chrome === 'undefined') {
        return {
          available: false,
          message: 'chrome runtime is not available',
          details: 'This tool requires a Chrome extension background context',
        };
      }

      // 检查 chrome.userScripts.execute 是否可用（需要 Chrome 135+）
      if (!chrome.userScripts || typeof chrome.userScripts.execute !== 'function') {
        return {
          available: false,
          message: 'chrome.userScripts.execute is not available',
          details: 'This API requires Chrome 135+ with userScripts permission',
        };
      }

      return {
        available: true,
        message: 'WPS Spreadsheet tools are available',
        details: 'Requires WPS WebOffice page loaded in target tab',
      };
    } catch (error) {
      return {
        available: false,
        message: 'Failed to check WPS Spreadsheet tools availability',
        details: error instanceof Error ? error.message : 'Unknown error occurred',
      };
    }
  }

  /**
   * 注册所有 WPS 表格工具
   * 
   * 根据配置选项注册启用的工具到 MCP 服务器。
   */
  registerTools(): void {
    if (this.shouldRegisterTool('isAvailable')) this.registerIsAvailable();
    if (this.shouldRegisterTool('readCell')) this.registerReadCell();
    if (this.shouldRegisterTool('writeCell')) this.registerWriteCell();
    if (this.shouldRegisterTool('batchWrite')) this.registerBatchWrite();
    if (this.shouldRegisterTool('setFormula')) this.registerSetFormula();
    if (this.shouldRegisterTool('setFont')) this.registerSetFont();
    if (this.shouldRegisterTool('setStyle')) this.registerSetStyle();
    if (this.shouldRegisterTool('setBorder')) this.registerSetBorder();
    if (this.shouldRegisterTool('mergeCells')) this.registerMergeCells();
    if (this.shouldRegisterTool('setAlignment')) this.registerSetAlignment();
    if (this.shouldRegisterTool('setColumnWidth')) this.registerSetColumnWidth();
    if (this.shouldRegisterTool('setRowHeight')) this.registerSetRowHeight();
    if (this.shouldRegisterTool('setNumberFormat')) this.registerSetNumberFormat();
    if (this.shouldRegisterTool('getInfo')) this.registerGetInfo();
  }

  // ==================== 核心辅助方法 ====================

  /**
   * 在 WPS 编辑器标签页中执行 JavaScript 代码并返回结果
   * 
   * 该方法将用户代码包装在一个 WPS 感知的异步 IIFE 中，
   * 在 MAIN world 中执行，并将结果序列化为 JSON 返回。
   * 
   * @param tabId - 目标标签页 ID
   * @param code - 要执行的 JavaScript 代码
   * @returns 执行结果，包含成功状态、数据或错误信息
   */
  private async execInWpsTab<T>(
    tabId: number,
    code: string,
  ): Promise<{ success: boolean; data?: T; error?: string }> {
    try {
      // 验证标签页是否存在
      await chrome.tabs.get(tabId);

      // 检查 chrome.userScripts.execute 是否可用
      if (typeof chrome.userScripts.execute !== 'function') {
        return { success: false, error: 'chrome.userScripts.execute requires Chrome 135+' };
      }

      // 包装代码：检查 WPSOpenApi 可用性，执行用户代码，序列化结果
      const wrapperCode = `(async () => {
        try {
          // 检查页面是否加载了 WPSOpenApi
          if (typeof WPSOpenApi === 'undefined' || !WPSOpenApi.Application) {
            return JSON.stringify({ wpsAvailable: false, error: 'WPSOpenApi not found on this page. Make sure this tab has a WPS online spreadsheet open.' });
          }
          const app = await WPSOpenApi.Application;
          const wb = await app.ActiveWorkbook;
          // 执行用户代码
          const result = await (async function() {
            ${code}
          })();
          return JSON.stringify({ wpsAvailable: true, result: result });
        } catch(e) {
          return JSON.stringify({ wpsAvailable: true, error: e.message });
        }
      })()`;

      // 在 MAIN world 中执行脚本
      const results = await chrome.userScripts.execute({
        target: { tabId },
        js: [{ code: wrapperCode }],
        world: 'MAIN',
        injectImmediately: true,
      });

      // 检查执行结果
      if (!results || results.length === 0) {
        return { success: false, error: 'No result from script execution' };
      }

      const rawResult = results[0].result;
      if (typeof rawResult !== 'string') {
        return { success: false, error: `Unexpected result type: ${typeof rawResult}` };
      }

      // 解析并验证结果
      const parsed = JSON.parse(rawResult);
      if (!parsed.wpsAvailable) {
        return { success: false, error: parsed.error || 'Not a WPS editor tab' };
      }
      if (parsed.error) {
        return { success: false, error: parsed.error };
      }
      return { success: true, data: parsed.result as T };
    } catch (err) {
      // 处理标签页不存在等错误
      if (err instanceof Error && err.message.includes('No tab with id')) {
        return { success: false, error: `Tab ${tabId} does not exist` };
      }
      return { success: false, error: err instanceof Error ? err.message : String(err) };
    }
  }

  /**
   * 将十六进制颜色字符串转换为 VBA 负数格式
   * 
   * 十六进制颜色是 RGB 格式，而 VBA 使用 BGR 格式并取反。
   * 示例："#FF0000"（红色）-> -16776961
   * 
   * @param hex - 十六进制颜色字符串（如 "#FF0000"）
   * @returns VBA 颜色数值
   */
  private hexToVbaColor(hex: string): number {
    const cleanHex = hex.replace('#', '');
    const r = parseInt(cleanHex.slice(0, 2), 16);
    const g = parseInt(cleanHex.slice(2, 4), 16);
    const b = parseInt(cleanHex.slice(4, 6), 16);
    // VBA 使用 BGR 顺序：R + G*256 + B*65536
    const bgrValue = r + (g * 256) + (b * 65536);
    // VBA 约定：正值取负
    return bgrValue > 0x7FFFFFFF ? bgrValue - 0x100000000 : -bgrValue;
  }

  /**
   * 解析颜色值
   * 
   * 接受十六进制字符串或数值型 VBA 颜色。
   * 
   * @param color - 颜色值（hex 字符串或数字）
   * @returns VBA 颜色数值
   */
  private resolveColor(color: string | number): number {
    if (typeof color === 'string' && color.startsWith('#')) {
      return this.hexToVbaColor(color);
    }
    return typeof color === 'number' ? color : parseInt(String(color));
  }

  /**
   * 构建工作表引用的 JavaScript 表达式
   * 
   * @param sheetIndex - 工作表索引（可选，默认使用活动工作表）
   * @returns 工作表引用表达式
   */
  private sheetRef(sheetIndex?: number): string {
    return sheetIndex ? `(await wb.Sheets).Item(${sheetIndex})` : 'await app.ActiveSheet';
  }

  // ==================== 工具注册方法 ====================

  /**
   * 注册 WPS 可用性检测工具
   * 
   * 工具名称：extension_tool_wps_is_available
   * 功能：检测指定标签页是否为 WPS 在线表格编辑器
   */
  private registerIsAvailable(): void {
    this.server.registerTool(
      'extension_tool_wps_is_available',
      {
        description:
          '检测指定标签页是否为 WPS 在线表格编辑器。返回 true 表示当前页面是 WPS 表格，可以使用其他 WPS 工具。',
        inputSchema: {
          tabId: z.number().describe('要检测的浏览器标签页 ID'),
        },
      },
      async ({ tabId }) => {
        const result = await this.execInWpsTab<void>(
          tabId,
          `
          return { isWpsEditor: true };
          `,
        );
        if (!result.success) {
          return {
            content: [{ type: 'text', text: `不可用: ${result.error}` }],
            isError: true,
          };
        }
        return {
          content: [
            {
              type: 'text',
              text: `✅ 当前标签页是 WPS 在线表格编辑器，可以使用 WPS 自动化工具。`,
            },
          ],
        };
      },
    );
  }

  /**
   * 注册读取单元格工具
   * 
   * 工具名称：extension_tool_wps_read_cell
   * 功能：读取 WPS 表格中指定单元格的值
   */
  private registerReadCell(): void {
    this.server.registerTool(
      'extension_tool_wps_read_cell',
      {
        description: '读取 WPS 表格中指定单元格的值',
        inputSchema: {
          tabId: z.number().describe('WPS 编辑器标签页 ID'),
          cell: z.string().describe('单元格地址，如 "A1", "B2", "C10"'),
          sheetIndex: z.number().optional().describe('工作表索引（从 1 开始），默认使用活动工作表'),
        },
      },
      async ({ tabId, cell, sheetIndex }) => {
        const result = await this.execInWpsTab<{ value: unknown }>(
          tabId,
          `
          const sheet = ${this.sheetRef(sheetIndex)};
          const range = await sheet.Range('${cell}');
          const value = await range.Value2;
          return { cell: '${cell}', value: value };
          `,
        );
        if (!result.success) {
          return this.formatError(result.error);
        }
        return this.formatSuccess('读取成功', result.data);
      },
    );
  }

  /**
   * 注册写入单元格工具
   * 
   * 工具名称：extension_tool_wps_write_cell
   * 功能：写入值到 WPS 表格的指定单元格
   */
  private registerWriteCell(): void {
    this.server.registerTool(
      'extension_tool_wps_write_cell',
      {
        description: '写入值到 WPS 表格的指定单元格',
        inputSchema: {
          tabId: z.number().describe('WPS 编辑器标签页 ID'),
          cell: z.string().describe('单元格地址，如 "A1", "B2"'),
          value: z.union([z.string(), z.number()]).describe('要写入的值'),
          sheetIndex: z.number().optional().describe('工作表索引（从 1 开始）'),
        },
      },
      async ({ tabId, cell, value, sheetIndex }) => {
        const valStr = typeof value === 'string' ? JSON.stringify(value) : String(value);
        const result = await this.execInWpsTab<{ cell: string; written: unknown }>(
          tabId,
          `
          const sheet = ${this.sheetRef(sheetIndex)};
          const range = await sheet.Range('${cell}');
          range.Value2 = ${valStr};
          return { cell: '${cell}', written: ${valStr} };
          `,
        );
        if (!result.success) {
          return this.formatError(result.error);
        }
        return this.formatSuccess(`已写入 ${cell}`, result.data);
      },
    );
  }

  /**
   * 注册批量写入工具
   * 
   * 工具名称：extension_tool_wps_batch_write
   * 功能：批量写入多个单元格到 WPS 表格（推荐用于填充表头、表单等场景）
   */
  private registerBatchWrite(): void {
    this.server.registerTool(
      'extension_tool_wps_batch_write',
      {
        description: '批量写入多个单元格到 WPS 表格（推荐用于填充表头、表单等场景）',
        inputSchema: {
          tabId: z.number().describe('WPS 编辑器标签页 ID'),
          data: z.record(z.string(), z.union([z.string(), z.number()])).describe(
            '单元格地址到值的映射，如 {"A1": "标题", "B1": "价格", "A2": "产品A", "B2": 99.9}',
          ),
          sheetIndex: z.number().optional().describe('工作表索引（从 1 开始）'),
        },
      },
      async ({ tabId, data, sheetIndex }) => {
        const assignments = Object.entries(data)
          .map(([cell, value]) => {
            const valStr = typeof value === 'string' ? JSON.stringify(value) : String(value);
            return `(await sheet.Range('${cell}')).Value2 = ${valStr};`;
          })
          .join('\n        ');

        const result = await this.execInWpsTab<{ written: number }>(
          tabId,
          `
          const sheet = ${this.sheetRef(sheetIndex)};
          ${assignments}
          return { written: ${Object.keys(data).length} };
          `,
        );
        if (!result.success) {
          return this.formatError(result.error);
        }
        return this.formatSuccess(`批量写入成功，共写入 ${Object.keys(data).length} 个单元格`, result.data);
      },
    );
  }

  /**
   * 注册设置公式工具
   * 
   * 工具名称：extension_tool_wps_set_formula
   * 功能：在 WPS 表格的指定单元格中设置公式
   */
  private registerSetFormula(): void {
    this.server.registerTool(
      'extension_tool_wps_set_formula',
      {
        description: '在 WPS 表格的指定单元格中设置公式',
        inputSchema: {
          tabId: z.number().describe('WPS 编辑器标签页 ID'),
          cell: z.string().describe('单元格地址，如 "H2", "D10"'),
          formula: z.string().describe('Excel 公式字符串，如 "=SUM(A1:A10)", "=CONCATENATE(A1,B1)"'),
          sheetIndex: z.number().optional().describe('工作表索引（从 1 开始）'),
        },
      },
      async ({ tabId, cell, formula, sheetIndex }) => {
        const escapedFormula = formula.replace(/'/g, "\\'");
        const result = await this.execInWpsTab<{ cell: string; formula: string }>(
          tabId,
          `
          const sheet = ${this.sheetRef(sheetIndex)};
          const range = await sheet.Range('${cell}');
          range.Formula = '${escapedFormula}';
          return { cell: '${cell}', formula: '${escapedFormula}' };
          `,
        );
        if (!result.success) {
          return this.formatError(result.error);
        }
        return this.formatSuccess(`已在 ${cell} 设置公式`, result.data);
      },
    );
  }

  /**
   * 注册设置字体工具
   * 
   * 工具名称：extension_tool_wps_set_font
   * 功能：设置 WPS 表格单元格字体样式
   */
  private registerSetFont(): void {
    this.server.registerTool(
      'extension_tool_wps_set_font',
      {
        description:
          '设置 WPS 表格单元格字体样式。支持加粗、斜体、下划线、删除线、字号、字体名称和颜色。颜色支持 hex 格式（如 #FF0000）。',
        inputSchema: {
          tabId: z.number().describe('WPS 编辑器标签页 ID'),
          range: z.string().describe('单元格范围，如 "A1" 或 "A1:F1"'),
          bold: z.boolean().optional().describe('是否加粗'),
          italic: z.boolean().optional().describe('是否斜体'),
          underline: z.boolean().optional().describe('是否下划线'),
          strikethrough: z.boolean().optional().describe('是否删除线'),
          size: z.number().optional().describe('字号，如 12, 14, 16'),
          name: z.string().optional().describe('字体名称，如 "微软雅黑", "Arial", "宋体"'),
          color: z.string().optional().describe('字体颜色，支持 hex 格式如 "#FF0000"（红色）'),
          sheetIndex: z.number().optional().describe('工作表索引（从 1 开始）'),
        },
      },
      async ({ tabId, range, bold, italic, underline, strikethrough, size, name, color, sheetIndex }) => {
        let fontCode = `const font = (await sheet.Range('${range}')).Font;\n`;
        if (bold !== undefined) fontCode += `        font.Bold = ${bold};\n`;
        if (italic !== undefined) fontCode += `        font.Italic = ${italic};\n`;
        if (underline !== undefined) fontCode += `        font.Underline = ${underline};\n`;
        if (strikethrough !== undefined) fontCode += `        font.Strikethrough = ${strikethrough};\n`;
        if (size !== undefined) fontCode += `        font.Size = ${size};\n`;
        if (name !== undefined) fontCode += `        font.Name = '${name.replace(/'/g, "\\'")}';\n`;
        if (color !== undefined) {
          const vbaColor = this.resolveColor(color);
          fontCode += `        font.Color = ${vbaColor};\n`;
        }

        const result = await this.execInWpsTab<{ range: string; applied: boolean }>(
          tabId,
          `
          const sheet = ${this.sheetRef(sheetIndex)};
          ${fontCode}
          return { range: '${range}', applied: true };
          `,
        );
        if (!result.success) {
          return this.formatError(result.error);
        }
        return this.formatSuccess(`已设置 ${range} 的字体样式`, result.data);
      },
    );
  }

  /**
   * 注册设置样式工具
   * 
   * 工具名称：extension_tool_wps_set_style
   * 功能：设置 WPS 表格单元格的背景填充样式
   */
  private registerSetStyle(): void {
    this.server.registerTool(
      'extension_tool_wps_set_style',
      {
        description: '设置 WPS 表格单元格的背景填充样式',
        inputSchema: {
          tabId: z.number().describe('WPS 编辑器标签页 ID'),
          range: z.string().describe('单元格范围，如 "A1:F1"'),
          bgColor: z.string().optional().describe('背景颜色，支持 hex 格式如 "#4472C4"（深蓝）'),
          pattern: z.number().optional().describe('填充图案，1=实心, 2=灰色, 3=水平线, 4=虚线'),
          patternColor: z.string().optional().describe('图案颜色，支持 hex 格式'),
          sheetIndex: z.number().optional().describe('工作表索引（从 1 开始）'),
        },
      },
      async ({ tabId, range, bgColor, pattern, patternColor, sheetIndex }) => {
        let styleCode = `const interior = (await sheet.Range('${range}')).Interior;\n`;
        if (bgColor !== undefined) {
          const vbaColor = this.resolveColor(bgColor);
          styleCode += `        interior.Color = ${vbaColor};\n`;
        }
        if (pattern !== undefined) styleCode += `        interior.Pattern = ${pattern};\n`;
        if (patternColor !== undefined) {
          const vbaColor = this.resolveColor(patternColor);
          styleCode += `        interior.PatternColor = ${vbaColor};\n`;
        }

        const result = await this.execInWpsTab<{ range: string; applied: boolean }>(
          tabId,
          `
          const sheet = ${this.sheetRef(sheetIndex)};
          ${styleCode}
          return { range: '${range}', applied: true };
          `,
        );
        if (!result.success) {
          return this.formatError(result.error);
        }
        return this.formatSuccess(`已设置 ${range} 的填充样式`, result.data);
      },
    );
  }

  /**
   * 注册设置边框工具
   * 
   * 工具名称：extension_tool_wps_set_border
   * 功能：设置 WPS 表格单元格的边框样式
   */
  private registerSetBorder(): void {
    this.server.registerTool(
      'extension_tool_wps_set_border',
      {
        description: '设置 WPS 表格单元格的边框样式',
        inputSchema: {
          tabId: z.number().describe('WPS 编辑器标签页 ID'),
          range: z.string().describe('单元格范围，如 "A1:F10"'),
          lineStyle: z.number().optional().describe('线型，1=实线, 2=虚线, 4=点划线, -4119=双线'),
          weight: z.number().optional().describe('粗细，1=细, 2=中, 3=粗, 4=极粗'),
          color: z.string().optional().describe('边框颜色，支持 hex 格式如 "#000000"（黑色）'),
          sheetIndex: z.number().optional().describe('工作表索引（从 1 开始）'),
        },
      },
      async ({ tabId, range, lineStyle, weight, color, sheetIndex }) => {
        let borderCode = `const borders = (await sheet.Range('${range}')).Borders;\n`;
        if (lineStyle !== undefined) borderCode += `        borders.LineStyle = ${lineStyle};\n`;
        if (weight !== undefined) borderCode += `        borders.Weight = ${weight};\n`;
        if (color !== undefined) {
          const vbaColor = this.resolveColor(color);
          borderCode += `        borders.Color = ${vbaColor};\n`;
        }

        const result = await this.execInWpsTab<{ range: string; applied: boolean }>(
          tabId,
          `
          const sheet = ${this.sheetRef(sheetIndex)};
          ${borderCode}
          return { range: '${range}', applied: true };
          `,
        );
        if (!result.success) {
          return this.formatError(result.error);
        }
        return this.formatSuccess(`已设置 ${range} 的边框样式`, result.data);
      },
    );
  }

  /**
   * 注册合并单元格工具
   * 
   * 工具名称：extension_tool_wps_merge_cells
   * 功能：合并 WPS 表格中的单元格区域
   */
  private registerMergeCells(): void {
    this.server.registerTool(
      'extension_tool_wps_merge_cells',
      {
        description: '合并 WPS 表格中的单元格区域',
        inputSchema: {
          tabId: z.number().describe('WPS 编辑器标签页 ID'),
          range: z.string().describe('要合并的单元格范围，如 "A1:C1", "A2:E5"'),
          sheetIndex: z.number().optional().describe('工作表索引（从 1 开始）'),
        },
      },
      async ({ tabId, range, sheetIndex }) => {
        const result = await this.execInWpsTab<{ range: string; merged: boolean }>(
          tabId,
          `
          const sheet = ${this.sheetRef(sheetIndex)};
          const mergeRange = await sheet.Range('${range}');
          mergeRange.Merge();
          return { range: '${range}', merged: true };
          `,
        );
        if (!result.success) {
          return this.formatError(result.error);
        }
        return this.formatSuccess(`已合并 ${range}`, result.data);
      },
    );
  }

  /**
   * 注册设置对齐方式工具
   * 
   * 工具名称：extension_tool_wps_set_alignment
   * 功能：设置 WPS 表格单元格的对齐方式
   */
  private registerSetAlignment(): void {
    this.server.registerTool(
      'extension_tool_wps_set_alignment',
      {
        description: '设置 WPS 表格单元格的对齐方式。对齐常量：水平 -4131=左, -4108=中, -4152=右；垂直 -4160=顶, -4108=中, -4107=底。',
        inputSchema: {
          tabId: z.number().describe('WPS 编辑器标签页 ID'),
          range: z.string().describe('单元格范围，如 "A1:F1"'),
          hAlign: z.number().optional().describe('水平对齐：-4131=左, -4108=中, -4152=右'),
          vAlign: z.number().optional().describe('垂直对齐：-4160=顶, -4108=中, -4107=底'),
          wrapText: z.boolean().optional().describe('是否自动换行'),
          sheetIndex: z.number().optional().describe('工作表索引（从 1 开始）'),
        },
      },
      async ({ tabId, range, hAlign, vAlign, wrapText, sheetIndex }) => {
        let alignCode = `const rng = await sheet.Range('${range}');\n`;
        if (hAlign !== undefined) alignCode += `        rng.HorizontalAlignment = ${hAlign};\n`;
        if (vAlign !== undefined) alignCode += `        rng.VerticalAlignment = ${vAlign};\n`;
        if (wrapText !== undefined) alignCode += `        rng.WrapText = ${wrapText};\n`;

        const result = await this.execInWpsTab<{ range: string; applied: boolean }>(
          tabId,
          `
          const sheet = ${this.sheetRef(sheetIndex)};
          ${alignCode}
          return { range: '${range}', applied: true };
          `,
        );
        if (!result.success) {
          return this.formatError(result.error);
        }
        return this.formatSuccess(`已设置 ${range} 的对齐方式`, result.data);
      },
    );
  }

  /**
   * 注册设置列宽工具
   * 
   * 工具名称：extension_tool_wps_set_column_width
   * 功能：设置 WPS 表格中指定列的宽度
   */
  private registerSetColumnWidth(): void {
    this.server.registerTool(
      'extension_tool_wps_set_column_width',
      {
        description: '设置 WPS 表格中指定列的宽度',
        inputSchema: {
          tabId: z.number().describe('WPS 编辑器标签页 ID'),
          columns: z.string().describe('列标识，如 "A:A"（单列）, "A:C"（多列）'),
          width: z.number().describe('列宽度数值'),
          sheetIndex: z.number().optional().describe('工作表索引（从 1 开始）'),
        },
      },
      async ({ tabId, columns, width, sheetIndex }) => {
        const result = await this.execInWpsTab<{ columns: string; width: number }>(
          tabId,
          `
          const sheet = ${this.sheetRef(sheetIndex)};
          sheet.Columns('${columns}').ColumnWidth = ${width};
          return { columns: '${columns}', width: ${width} };
          `,
        );
        if (!result.success) {
          return this.formatError(result.error);
        }
        return this.formatSuccess(`已设置 ${columns} 的列宽为 ${width}`, result.data);
      },
    );
  }

  /**
   * 注册设置行高工具
   * 
   * 工具名称：extension_tool_wps_set_row_height
   * 功能：设置 WPS 表格中指定行的行高
   */
  private registerSetRowHeight(): void {
    this.server.registerTool(
      'extension_tool_wps_set_row_height',
      {
        description: '设置 WPS 表格中指定行的行高',
        inputSchema: {
          tabId: z.number().describe('WPS 编辑器标签页 ID'),
          rows: z.string().describe('行标识，如 "2:2"（单行）, "2:10"（多行）'),
          height: z.number().describe('行高数值'),
          sheetIndex: z.number().optional().describe('工作表索引（从 1 开始）'),
        },
      },
      async ({ tabId, rows, height, sheetIndex }) => {
        const result = await this.execInWpsTab<{ rows: string; height: number }>(
          tabId,
          `
          const sheet = ${this.sheetRef(sheetIndex)};
          sheet.Rows('${rows}').RowHeight = ${height};
          return { rows: '${rows}', height: ${height} };
          `,
        );
        if (!result.success) {
          return this.formatError(result.error);
        }
        return this.formatSuccess(`已设置 ${rows} 的行高为 ${height}`, result.data);
      },
    );
  }

  /**
   * 注册设置数字格式工具
   * 
   * 工具名称：extension_tool_wps_set_number_format
   * 功能：设置 WPS 表格单元格的数字格式（如百分比、货币、日期等）
   */
  private registerSetNumberFormat(): void {
    this.server.registerTool(
      'extension_tool_wps_set_number_format',
      {
        description: '设置 WPS 表格单元格的数字格式（如百分比、货币、日期等）',
        inputSchema: {
          tabId: z.number().describe('WPS 编辑器标签页 ID'),
          range: z.string().describe('单元格范围，如 "F2"'),
          numberFormat: z.string().describe('格式字符串，如 "0.00%"（百分比）, "$#,##0.00"（货币）, "yyyy-mm-dd"（日期）'),
          sheetIndex: z.number().optional().describe('工作表索引（从 1 开始）'),
        },
      },
      async ({ tabId, range, numberFormat, sheetIndex }) => {
        const escapedFormat = numberFormat.replace(/'/g, "\\'");
        const result = await this.execInWpsTab<{ range: string; format: string }>(
          tabId,
          `
          const sheet = ${this.sheetRef(sheetIndex)};
          (await sheet.Range('${range}')).NumberFormat = '${escapedFormat}';
          return { range: '${range}', format: '${escapedFormat}' };
          `,
        );
        if (!result.success) {
          return this.formatError(result.error);
        }
        return this.formatSuccess(`已设置 ${range} 的数字格式`, result.data);
      },
    );
  }

  /**
   * 注册获取工作簿信息工具
   * 
   * 工具名称：extension_tool_wps_get_info
   * 功能：获取 WPS 工作簿的各种信息（工作表名称、已使用区域、活动工作表、用户名等）
   */
  private registerGetInfo(): void {
    this.server.registerTool(
      'extension_tool_wps_get_info',
      {
        description: '获取 WPS 工作簿信息',
        inputSchema: {
          tabId: z.number().describe('WPS 编辑器标签页 ID'),
          type: z.enum(['sheet_names', 'used_range', 'active_sheet', 'user_name']).describe(
            '信息类型：sheet_names=所有工作表名称, used_range=已使用区域, active_sheet=活动工作表名, user_name=当前用户',
          ),
        },
      },
      async ({ tabId, type }) => {
        let code = '';
        switch (type) {
          case 'sheet_names':
            code = `
            const sheets = await wb.Sheets;
            const count = await sheets.Count;
            const names = [];
            for (let i = 1; i <= count; i++) {
              const s = await sheets.Item(i);
              names.push(await s.Name);
            }
            return { count, names };
            `;
            break;
          case 'used_range':
            code = `
            const sheet = await app.ActiveSheet;
            const usedRange = await sheet.UsedRange;
            const address = await usedRange.Address;
            return { address };
            `;
            break;
          case 'active_sheet':
            code = `
            const sheet = await app.ActiveSheet;
            const name = await sheet.Name;
            const index = await sheet.Index;
            return { name, index };
            `;
            break;
          case 'user_name':
            code = `
            const userName = await app.UserName;
            return { userName };
            `;
            break;
        }

        const result = await this.execInWpsTab<unknown>(tabId, code);
        if (!result.success) {
          return this.formatError(result.error);
        }
        return this.formatSuccess(`已获取${type}信息`, result.data);
      },
    );
  }
}
