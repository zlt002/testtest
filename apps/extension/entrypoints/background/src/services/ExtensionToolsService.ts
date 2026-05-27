// 导入 Chrome Extension API 工具类
import {
  BookmarksApiTools,           // 书签 API 工具
  type BookmarksApiToolsOptions,
  HistoryApiTools,             // 历史记录 API 工具
  type HistoryApiToolsOptions,
  ScriptingApiTools,          // 脚本注入 API 工具
  type ScriptingApiToolsOptions,
  StorageApiTools,            // 存储管理 API 工具
  type StorageApiToolsOptions,
  TabGroupsApiTools,          // 标签页分组 API 工具
  type TabGroupsApiToolsOptions,
  TabsApiTools,               // 标签页管理 API 工具
  type TabsApiToolsOptions,
  WindowsApiTools,            // 窗口管理 API 工具
  type WindowsApiToolsOptions,
} from '@mcp-b/extension-tools';

// 导入 MCP 服务器类型定义
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

// 导入自定义扩展工具
import { UserScriptTools, type UserScriptToolsOptions } from '../models/aiCRUD/UserScriptTools';
import { WpsSpreadsheetTools, type WpsSpreadsheetToolsOptions } from '../models/wps/WpsSpreadsheetTools';
import { createTakeoverAwareExtensionToolServer } from './takeover-aware-extension-tool';

/**
 * 扩展工具服务配置选项接口
 * 
 * 虽然这种定义方式看起来不够维护友好，但将所有子方法重新定义可以让 AI 更容易理解和使用。
 * 每个可选属性对应一个 Chrome Extension API 或自定义工具的配置选项。
 */
export interface ExtensionToolsOptions {
  /** 书签 API 配置选项 */
  bookmarks?: BookmarksApiToolsOptions;
  /** 历史记录 API 配置选项 */
  history?: HistoryApiToolsOptions;
  /** 存储管理 API 配置选项 */
  storage?: StorageApiToolsOptions;
  /** 标签页管理 API 配置选项 */
  tabs?: TabsApiToolsOptions;
  /** 窗口管理 API 配置选项 */
  windows?: WindowsApiToolsOptions;
  /** 脚本注入 API 配置选项 */
  scripting?: ScriptingApiToolsOptions;
  /** 标签页分组 API 配置选项 */
  tabGroups?: TabGroupsApiToolsOptions;
  /** 用户自定义脚本工具配置选项 */
  userScriptTools?: UserScriptToolsOptions;
  /** WPS 电子表格工具配置选项 */
  wpsSpreadsheet?: WpsSpreadsheetToolsOptions;
}

/**
 * 扩展工具服务类
 * 
 * 该服务负责将扩展特定的工具注册到 MCP 服务器。
 * 这些工具提供对后台 Service Worker 中可用的 Chrome Extension API 的访问。
 * 
 * 主要功能：
 * - 初始化和管理所有 Chrome Extension API 工具
 * - 检测 API 可用性（基于权限和上下文）
 * - 向 MCP 服务器注册可用的工具
 * - 提供 API 状态检查工具
 */
export class ExtensionToolsService {
  /** 存储所有已初始化的 API 工具实例 */
  private apiTools: any[] = [];

  /**
   * 构造函数
   * @param server - MCP 服务器实例，用于注册工具
   * @param options - 扩展工具配置选项，用于初始化各个 API 工具
   */
  constructor(
    private server: McpServer,
    private options: ExtensionToolsOptions = {}
  ) {
    this.initializeApiTools();
  }

  /**
   * 初始化所有 API 工具类
   * 
   * 该方法创建所有支持的 API 工具实例，并将它们存储在 apiTools 数组中。
   * 每个工具实例都接收 MCP 服务器实例和对应的配置选项。
   */
  private initializeApiTools(): void {
    const takeoverAwareServer = createTakeoverAwareExtensionToolServer(this.server);

    // 按顺序初始化所有 API 工具类
    this.apiTools = [
      new BookmarksApiTools(takeoverAwareServer, this.options.bookmarks),
      new StorageApiTools(takeoverAwareServer, this.options.storage),
      new HistoryApiTools(takeoverAwareServer, this.options.history),
      new TabGroupsApiTools(takeoverAwareServer, this.options.tabGroups),
      new TabsApiTools(takeoverAwareServer, this.options.tabs),
      new UserScriptTools(this.server, this.options.userScriptTools),
      new WpsSpreadsheetTools(this.server, this.options.wpsSpreadsheet),
      new WindowsApiTools(takeoverAwareServer, this.options.windows),
      new ScriptingApiTools(takeoverAwareServer, this.options.scripting),
    ];
  }

  /**
   * 获取 API 对应的 Chrome 命名空间
   * 
   * 该方法根据 API 名称返回对应的 Chrome Extension API 命名空间。
   * 对于特殊的 API（如 tabGroups、userScripts）需要进行特殊处理。
   * 
   * @param apiName - API 工具名称（如 'Bookmarks', 'TabGroups' 等）
   * @returns Chrome API 命名空间对象，或虚拟 API 标记
   */
  private getApiNamespace(apiName: string): unknown {
    const namespace = apiName.toLowerCase();
    
    // 特殊处理：tabGroups API 的命名空间是 chrome.tabGroups
    if (namespace === 'tabgroups') {
      return chrome.tabGroups;
    }
    
    // 特殊处理：userScripts API 的命名空间是 chrome.userScripts
    if (namespace === 'userscripts') {
      return chrome.userScripts;
    }
    
    // 特殊处理：WpsSpreadsheet 不是 Chrome 原生 API，而是虚拟 API
    if (apiName === 'WpsSpreadsheet') {
      return { __virtual__: true };
    }
    
    // 通用处理：返回 chrome 对象上对应的命名空间
    return (chrome as Record<string, unknown>)[namespace];
  }

  /**
   * 安全地检查 API 工具的可用性
   * 
   * 该方法检查指定的 API 工具是否在当前上下文中可用。
   * 为了避免 MV3 Service Worker 重载竞争条件，不再使用基于回调的探测方式，
   * 而是简单地检查命名空间是否存在。
   * 
   * @param tool - API 工具实例
   * @returns 包含可用性状态、消息和详细信息的对象
   */
  private getSafeAvailability(tool: any) {
    const apiName = tool.apiName || 'Unknown';
    const namespace = this.getApiNamespace(apiName);

    // 如果命名空间不存在，说明该 API 不可用
    if (!namespace) {
      return {
        available: false,
        message: `chrome.${apiName.toLowerCase()} API is not defined`,
        details: 'Namespace unavailable in current service worker context',
      };
    }

    // 命名空间存在，标记为可用
    return {
      available: true,
      message: `${apiName} API namespace is available`,
      details: 'Skipped callback-based probe to avoid MV3 service worker reload races.',
    };
  }

  /**
   * 获取可用的 Chrome API 摘要
   * 
   * 该方法遍历所有已初始化的 API 工具，检查它们的可用性，
   * 并返回一个包含所有 API 状态的对象。
   * 
   * @returns 一个对象，键为 API 名称（小写），值为包含可用性信息的对象
   */
  getAvailableApis(): Record<string, any> {
    const apiStatuses: Record<string, any> = {};

    // 遍历所有 API 工具并检查可用性
    for (const tool of this.apiTools) {
      const availability = this.getSafeAvailability(tool);
      apiStatuses[tool.apiName.toLowerCase()] = {
        available: availability.available,
        message: availability.message,
        details: availability.details,
      };
    }

    return apiStatuses;
  }

  /**
   * 将所有扩展特定的工具注册到 MCP 服务器
   * 
   * 该方法执行以下操作：
   * 1. 始终注册 API 检查工具（用于查询可用 API）
   * 2. 遍历所有 API 工具，仅注册那些可用的工具（具有适当权限）
   * 3. 在控制台输出注册日志，包括成功和失败的 API
   */
  registerAllTools() {
    console.log('Registering extension tools...');

    // 始终注册 API 检查工具，用于查询可用 API 列表
    this.registerApiCheckTool();

    // 遍历所有 API 工具并注册可用的工具
    for (const tool of this.apiTools) {
      const availability = this.getSafeAvailability(tool);
      
      // 如果 API 不可用，输出警告并跳过注册
      if (!availability.available) {
        console.warn(`✗ ${tool.apiName} API not available: ${availability.message}`);
        if (availability.details) {
          console.warn(`  Details: ${availability.details}`);
        }
        continue;
      }

      // API 可用，输出成功日志并注册工具
      console.log(`✓ ${tool.apiName} API available`);
      tool.registerTools();
    }
  }

  /**
   * 注册 API 检查工具
   * 
   * 该方法注册一个特殊的 MCP 工具，用于查询扩展当前可用的 Chrome Extension API 列表。
   * 该工具还会尝试获取扩展当前的权限信息（如果可用）。
   * 
   * 工具名称：extension_tool_check_available_apis
   * 工具描述：检查扩展可用的 Chrome Extension API
   * 输入参数：无
   * 返回内容：包含可用 API 列表和权限信息的 JSON 对象
   */
  private registerApiCheckTool() {
    // 注册 API 检查工具
    this.server.registerTool(
      'extension_tool_check_available_apis',
      {
        description: 'Check which Chrome Extension APIs are available to the extension',
        inputSchema: {},
      },
      async () => {
        // 获取所有 API 的可用性状态
        const apis = this.getAvailableApis();
        let permissions = null;

        // 尝试获取扩展权限信息（仅在 permissions API 可用时）
        if (chrome.permissions && typeof chrome.permissions.getAll === 'function') {
          try {
            permissions = await chrome.permissions.getAll();
          } catch (error) {
            console.error('Failed to get permissions:', error);
          }
        }

        // 返回包含 API 状态和权限信息的响应
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(
                {
                  availableApis: apis,
                  permissions: permissions
                    ? {
                        permissions: permissions.permissions || [],
                        origins: permissions.origins || [],
                      }
                    : 'Permissions API not available',
                },
                null,
                2
              ),
            },
          ],
        };
      }
    );
  }
}
