/**
 * MCP Hub 服务
 * 
 * 该服务负责管理来自内容脚本的工具注册和执行。
 * 它维护一个按域名和标签页 ID 索引的工具注册表，并处理标签页的打开、关闭和重新打开。
 * 
 * 主要功能：
 * - 管理来自不同域和标签页的工具注册
 * - 处理内容脚本的连接和消息通信
 * - 支持工具缓存，允许在标签页关闭后重新打开
 * - 跟踪当前活动标签页并更新工具描述
 * - 执行工具调用并将结果返回给 MCP 服务器
 */

// 导入 MCP SDK 类型定义
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { CallToolResult, Tool } from '@modelcontextprotocol/sdk/types.js';

// 导入 Zod 用于模式验证
import { z } from 'zod';

// 导入工具名称清理函数
import { sanitizeToolName } from '@/entrypoints/sidepanel/components/McpServer/utils';

// 导入请求管理器（用于处理请求 ID 和响应匹配）
import { RequestManager } from '../lib/utils';

// 导入扩展工具服务
import { ExtensionToolsService } from './ExtensionToolsService';
import { windowTakeoverService } from './window-takeover';

let activeMcpHubInstance: McpHub | null = null;

export function getMcpHubInstance(): McpHub | null {
  return activeMcpHubInstance;
}

/**
 * 标签页数据接口
 * 
 * 存储与特定标签页或缓存数据相关的工具和元数据。
 */
interface TabData {
  /** 该标签页注册的工具列表 */
  tools: Tool[];
  /** 最后更新时间戳 */
  lastUpdated: number;
  /** 标签页 URL */
  url: string;
  /** 标签页 ID（仅对打开的标签页有效） */
  tabId?: number;
  /** 与内容脚本的通信端口 */
  port?: chrome.runtime.Port;
  /** 标签页是否已关闭（用于缓存数据） */
  isClosed: boolean;
}

export interface WebsiteRuntimeToolEntry {
  domain: string;
  dataId: string;
  url: string;
  tabId: number | undefined;
  isClosed: boolean;
  tool: Tool;
}

/**
 * MCP Hub 服务类
 * 
 * 该类是扩展后台服务与内容脚本工具之间的中央协调器。
 * 它管理工具注册、执行和生命周期，包括标签页关闭后的缓存机制。
 */
export default class McpHub {
  /** MCP 服务器实例 */
  private server: McpServer;
  
  /** 域名到标签页数据的映射（domain → dataId → TabData）
   * dataId 格式：'tab-${tabId}' 用于打开的标签页，'cached-${timestamp}' 用于缓存的数据
   */
  private domains = new Map<string, Map<string, TabData>>();
  
  /** 当前活动标签页的 ID */
  private activeTabId: number | null = null;
  
  /** 请求管理器，用于处理异步工具调用的请求-响应匹配 */
  private requestManager = new RequestManager();
  
  /** 已注册工具的映射（工具名称 → 工具注册对象） */
  private registeredTools = new Map<string, ReturnType<typeof this.server.registerTool>>();
  
  /** 待重新打开的标签页映射（tabId → pending reopen info）
   * 用于等待标签页重新打开后的端口连接
   */
  private pendingReopens = new Map<
    number,
    {
      cachedDataId: string;
      resolvePort: (port: chrome.runtime.Port) => void;
      reject: (err: any) => void;
      timeoutId: NodeJS.Timeout;
    }
  >();

  /**
   * 构造函数
   * @param server - MCP 服务器实例
   */
  constructor(server: McpServer) {
    this.server = server;
    activeMcpHubInstance = this;
    // 注册静态扩展工具（如 tabs、scripting API）
    this.registerStaticTools();
    // 设置内容脚本连接监听
    this.setupConnections();
    // 跟踪活动标签页变化
    this.trackActiveTab();
  }

  /**
   * 注册静态扩展工具
   * 
   * 该方法注册不依赖内容脚本的 Chrome Extension API 工具，
   * 如标签页管理、脚本注入等。这些工具始终可用。
   */
  private registerStaticTools() {
    const extensionToolsService = new ExtensionToolsService(this.server, {
      tabs: {
        getAllTabs: true,      // 获取所有标签页
        createTab: true,        // 创建新标签页
        closeTabs: true,        // 关闭标签页
        updateTab: true,        // 更新标签页属性
      },
      scripting: {
        executeScript: true,    // 执行脚本
        executeUserScript: true, // 执行用户脚本
        insertCSS: false,       // 插入 CSS（当前禁用）
        removeCSS: false,       // 移除 CSS（当前禁用）
      },
    });
    extensionToolsService.registerAllTools();
  }

  /**
   * 获取或创建域名的标签页数据映射
   * @param domain - 域名（如 'example.com'）
   * @returns 该域名下的标签页数据映射
   */
  private getDomainData(domain: string): Map<string, TabData> {
    if (!this.domains.has(domain)) {
      this.domains.set(domain, new Map());
    }
    return this.domains.get(domain)!;
  }

  /**
   * 从 URL 中提取域名
   * @param url - 完整 URL
   * @returns 提取的域名，localhost 会包含端口号
   */
  private extractDomainFromUrl(url: string): string {
    try {
      const urlObj = new URL(url);
      const hostname = urlObj.hostname;
      // 特殊处理 localhost，保留端口号以便区分不同本地服务
      return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '[::1]'
        ? `localhost:${urlObj.port || '80'}`
        : hostname;
    } catch {
      return 'unknown';
    }
  }

  /**
   * 设置内容脚本连接监听
   * 
   * 监听来自内容脚本的连接请求，只处理名称为 'mcp-content-script-proxy' 的端口。
   */
  private setupConnections() {
    chrome.runtime.onConnect.addListener((port) => {
      if (port.name === 'mcp-content-script-proxy') {
        this.handleContentScriptConnection(port);
      }
    });
  }

  /**
   * 向标签页请求工具刷新
   * 
   * 向指定的标签页发送工具刷新请求，促使其重新发送工具列表。
   * @param domain - 域名
   * @param dataId - 标签页数据 ID
   */
  private requestToolsFromTab(domain: string, dataId: string) {
    const domainData = this.getDomainData(domain);
    const tabData = domainData.get(dataId);
    if (tabData && !tabData.isClosed && tabData.port) {
      try {
        tabData.port.postMessage({ type: 'request-tools-refresh' });
      } catch (error) {
        console.warn('[McpHub] Skipping tool refresh request on disconnected port:', error);
      }
    }
  }

  /**
   * 处理内容脚本连接
   * 
   * 处理来自内容脚本的连接，设置消息监听器和断开连接监听器。
   * 支持三种消息类型：
   * - register-tools: 首次注册工具
   * - tools-updated: 工具列表更新
   * - tool-result: 工具执行结果
   * 
   * @param port - 内容脚本通信端口
   */
  private handleContentScriptConnection(port: chrome.runtime.Port) {
    const tabId = port.sender?.tab?.id;
    const url = port.sender?.tab?.url || '';
    if (!tabId) return;

    const domain = this.extractDomainFromUrl(url);
    const dataId = `tab-${tabId}`;

    port.onMessage.addListener(async (message) => {
      // 处理工具注册消息
      if (message.type === 'register-tools' && message.tools) {
        await this.registerOrUpdateTools(domain, dataId, port, message.tools, true);
        // 检查是否是重新打开的标签页：如果是，解析待处理的 Promise
        const pending = this.pendingReopens.get(tabId);
        if (pending) {
          clearTimeout(pending.timeoutId);
          pending.resolvePort(port);
          // 重新打开后清理缓存数据
          const cachedDataId = pending.cachedDataId;
          this.unregisterTools(domain, cachedDataId);
          this.getDomainData(domain).delete(cachedDataId);
          this.pendingReopens.delete(tabId);
        }
      } 
      // 处理工具更新消息
      else if (message.type === 'tools-updated' && message.tools) {
        await this.registerOrUpdateTools(domain, dataId, port, message.tools, false);
      } 
      // 处理工具执行结果消息
      else if (message.type === 'tool-result' && message.requestId) {
        this.requestManager.resolve(message.requestId, message.data);
      }
    });

    // 端口断开时注销标签页
    port.onDisconnect.addListener(() => {
      this.unregisterTab(domain, dataId);
    });
  }

  /**
   * 注册或更新工具
   * 
   * 将内容脚本提供的工具注册到 MCP 服务器，或更新已注册的工具。
   * 工具名称格式：website_tool_{domain}_{prefix}_{toolName}
   * 
   * @param domain - 域名
   * @param dataId - 标签页数据 ID
   * @param port - 内容脚本通信端口
   * @param tools - 要注册的工具列表
   * @param isRegister - 是否为首次注册（true）或更新（false）
   */
  private async registerOrUpdateTools(
    domain: string,
    dataId: string,
    port: chrome.runtime.Port,
    tools: Tool[],
    isRegister: boolean
  ) {
    const domainData = this.getDomainData(domain);
    const existing = domainData.get(dataId);
    const tabData: TabData = {
      tools,
      lastUpdated: Date.now(),
      url: port.sender?.tab?.url || '',
      tabId: port.sender?.tab?.id,
      port,
      isClosed: false,
    };
    domainData.set(dataId, tabData);

    // 确保在注册工具之前有当前活动标签页 ID
    if (this.activeTabId === null) {
      await this.initializeActiveTab();
    }

    const cleanedDomain = sanitizeToolName(domain);
    // 打开的标签页使用 tabId 数字，缓存的数据使用完整的 dataId
    const namePrefix = dataId.startsWith('cached-') ? dataId : `tab${tabData.tabId}`;

    // 遍历所有工具并注册或更新
    for (const tool of tools) {
      const toolName = `website_tool_${cleanedDomain}_${namePrefix}_${sanitizeToolName(tool.name)}`;
      const description = this.getSimpleTabDescription(
        domain,
        dataId,
        tool,
        tool.description || ''
      );

      // 将输入模式转换为 Zod 模式（使用 z.any() 作为占位符）
      const inputSchema: Record<string, z.ZodAny> = {};
      for (const key in tool.inputSchema.properties ?? {}) {
        inputSchema[key] = z.any();
      }

      // 将输出模式转换为 Zod 模式
      const outputSchema: Record<string, z.ZodAny> | undefined = tool.outputSchema?.properties
        ? Object.fromEntries(Object.keys(tool.outputSchema.properties).map((key) => [key, z.any()]))
        : undefined;

      const config = {
        title: tool.title,
        description,
        inputSchema: inputSchema as any,
        outputSchema: outputSchema as any,
        annotations: tool.annotations,
      };

      // 如果工具已注册，更新配置；否则注册新工具
      if (this.registeredTools.has(toolName)) {
        this.registeredTools.get(toolName)!.update(config);
      } else {
        const mcpTool = this.server.registerTool(toolName, config, async (args: any) =>
          this.executeTool(domain, dataId, tool.name, args)
        );
        this.registeredTools.set(toolName, mcpTool);
      }
    }

    // 如果是更新操作，清理已移除的工具
    if (!isRegister) {
      const oldTools = existing?.tools || [];
      const removed = oldTools.filter((t) => !tools.some((nt) => nt.name === t.name));
      for (const tool of removed) {
        const toolName = `website_tool_${cleanedDomain}_${namePrefix}_${sanitizeToolName(tool.name)}`;
        this.registeredTools.get(toolName)?.remove();
        this.registeredTools.delete(toolName);
      }
    }
  }

  /**
   * 注销标签页
   * 
   * 当标签页关闭时调用，注销所有相关工具。
   * 如果工具支持缓存（annotations.cache=true），则创建缓存数据。
   * 
   * @param domain - 域名
   * @param dataId - 标签页数据 ID
   */
  private unregisterTab(domain: string, dataId: string) {
    const domainData = this.getDomainData(domain);
    const tabData = domainData.get(dataId);
    if (!tabData) return;

    // 注销所有工具
    this.unregisterTools(domain, dataId);

    // 过滤出支持缓存的工具
    const cacheable = tabData.tools.filter((t) => t.annotations?.cache);
    if (cacheable.length > 0 && !tabData.isClosed) {
      // 仅在标签页原本是打开状态时才缓存
      const cachedId = `cached-${Date.now()}`;
      domainData.set(cachedId, {
        ...tabData,
        tools: cacheable,
        isClosed: true,
        tabId: undefined,
        port: undefined,
      });
      this.registerCachedTools(domain, cachedId);
    }
    // 删除原始数据
    domainData.delete(dataId);
  }

  /**
   * 注册缓存工具
   * 
   * 为已关闭标签页的缓存工具注册到 MCP 服务器。
   * 这些工具在执行时会触发标签页重新打开。
   * 
   * @param domain - 域名
   * @param dataId - 缓存数据 ID（格式：'cached-{timestamp}'）
   */
  private registerCachedTools(domain: string, dataId: string) {
    const domainData = this.getDomainData(domain);
    const tabData = domainData.get(dataId);
    if (!tabData) return;

    const cleanedDomain = sanitizeToolName(domain);
    const namePrefix = dataId;

    // 注册所有缓存工具
    for (const tool of tabData.tools) {
      const toolName = `website_tool_${cleanedDomain}_${namePrefix}_${sanitizeToolName(tool.name)}`;
      const description = this.getSimpleTabDescription(
        domain,
        dataId,
        tool,
        tool.description || ''
      );

      const inputSchema: Record<string, z.ZodAny> = {};
      for (const key in tool.inputSchema.properties ?? {}) {
        inputSchema[key] = z.any();
      }

      const outputSchema: Record<string, z.ZodAny> | undefined = tool.outputSchema?.properties
        ? Object.fromEntries(Object.keys(tool.outputSchema.properties).map((key) => [key, z.any()]))
        : undefined;

      const config = {
        title: tool.title,
        description,
        inputSchema: inputSchema as any,
        outputSchema: outputSchema as any,
        annotations: tool.annotations,
      };

      const mcpTool = this.server.registerTool(toolName, config, async (args: any) =>
        this.executeTool(domain, dataId, tool.name, args)
      );
      this.registeredTools.set(toolName, mcpTool);
    }
  }

  /**
   * 注销工具
   * 
   * 从 MCP 服务器中移除指定标签页的所有工具。
   * 
   * @param domain - 域名
   * @param dataId - 标签页数据 ID
   */
  private unregisterTools(domain: string, dataId: string) {
    const domainData = this.getDomainData(domain);
    const tabData = domainData.get(dataId);
    if (!tabData) return;

    const cleanedDomain = sanitizeToolName(domain);
    const namePrefix = dataId.startsWith('cached-') ? dataId : `tab${tabData.tabId ?? ''}`;

    // 遍历所有工具并注销
    for (const tool of tabData.tools) {
      const toolName = `website_tool_${cleanedDomain}_${namePrefix}_${sanitizeToolName(tool.name)}`;
      this.registeredTools.get(toolName)?.remove();
      this.registeredTools.delete(toolName);
    }
  }

  /**
   * 获取指定数据 ID 对应的通信端口
   * 
   * 如果标签页是打开的，直接返回其端口。
   * 如果标签页已关闭（缓存数据），则重新打开标签页并等待端口连接。
   * 
   * @param domain - 域名
   * @param dataId - 标签页数据 ID
   * @returns 内容脚本通信端口
   * @throws 如果数据不存在或重新打开超时
   */
  private async getPortForDataId(domain: string, dataId: string): Promise<chrome.runtime.Port> {
    const domainData = this.getDomainData(domain);
    const tabData = domainData.get(dataId);
    if (!tabData) throw new Error(`No data for ${dataId}`);

    // 如果标签页未关闭，直接返回端口
    if (!tabData.isClosed) {
      if (!tabData.port) throw new Error('No port for open tab');
      return tabData.port;
    }

    // 重新打开缓存的标签页
    return new Promise((resolve, reject) => {
      // 设置 10 秒超时
      const timeoutId = setTimeout(() => {
        this.pendingReopens.forEach((p, id) => {
          if (p.cachedDataId === dataId) {
            this.pendingReopens.delete(id);
          }
        });
        reject(new Error('Timeout reopening tab'));
      }, 10000);

      const takeoverState = windowTakeoverService.getState();
      if (takeoverState?.status === 'active') {
        windowTakeoverService.allowNavigation({
          windowId: takeoverState.windowId,
          fromTabId: takeoverState.lockedTabId,
          reason: 'ai-tab-switch',
          expiresAt: Date.now() + 10_000,
        });
      }

      // 创建新标签页并等待内容脚本连接
      chrome.tabs.create({ url: tabData.url, active: true }, (newTab) => {
        if (chrome.runtime.lastError || !newTab?.id) {
          clearTimeout(timeoutId);
          reject(new Error('Failed to create tab: ' + chrome.runtime.lastError?.message));
          return;
        }
        // 将待处理的重新打开信息存储到 pendingReopens
        this.pendingReopens.set(newTab.id, {
          cachedDataId: dataId,
          resolvePort: resolve,
          reject,
          timeoutId,
        });
      });
    });
  }

  /**
   * 生成简单的标签页工具描述
   * 
   * 为工具生成描述，包含域名和状态信息（Active/Cached）。
   * 
   * @param domain - 域名
   * @param dataId - 标签页数据 ID
   * @param tool - 工具对象
   * @param original - 原始工具描述
   * @returns 增强后的工具描述
   */
  private getSimpleTabDescription(
    domain: string,
    dataId: string,
    tool: Tool,
    original: string
  ): string {
    const domainData = this.getDomainData(domain);
    const tabData = domainData.get(dataId);
    if (!tabData) return `[${domain}] ${original}`;

    const isActive = !tabData.isClosed && tabData.tabId === this.activeTabId;
    const status = isActive ? 'Active' : tabData.isClosed ? 'Cached' : '';
    return `[${this.getToolSourceLabel(tabData, domain, tool)}${status ? ` • ${status}` : ''} Tab] ${original}`;
  }

  /**
   * 获取工具来源标签
   * 
   * 根据工具类型和来源域名生成标签。
   * 特殊处理 WebEdit 工具，显示 iframe 来源。
   * 
   * @param tabData - 标签页数据
   * @param domain - 域名
   * @param tool - 工具对象
   * @returns 工具来源标签
   */
  private getToolSourceLabel(tabData: TabData, domain: string, tool: Tool): string {
    const hostDomain = this.extractDomainFromUrl(tabData.url) || domain;
    const isWebEditTool = tool.name.startsWith('webedit_');

    // 特殊处理 WebEdit 工具
    if (isWebEditTool) {
      return `WebEdit iframe:webedit.midea.com via ${hostDomain}`;
    }

    return hostDomain;
  }

  /**
   * 执行工具
   * 
   * 通过内容脚本执行指定的工具，并返回结果。
   * 如果执行失败，返回错误信息。
   * 
   * @param domain - 域名
   * @param dataId - 标签页数据 ID
   * @param toolName - 工具名称
   * @param args - 工具参数
   * @returns 工具执行结果
   */
  private async executeTool(
    domain: string,
    dataId: string,
    toolName: string,
    args: any
  ): Promise<CallToolResult> {
    try {
      const port = await this.getPortForDataId(domain, dataId);
      return await this.requestManager.create(port, { type: 'execute-tool', toolName, args });
    } catch (error) {
      return {
        content: [
          {
            type: 'text',
            text: `Failed to execute tool: ${error instanceof Error ? error.message : String(error)}`,
          },
        ],
        isError: true,
      };
    }
  }

  async executeWebsiteToolOnActiveTab(
    toolName: string,
    args: any = {},
    lockedTabId?: number
  ): Promise<CallToolResult> {
    if (this.activeTabId === null && typeof lockedTabId !== 'number') {
      await this.initializeActiveTab();
    }

    const targetTabId = typeof lockedTabId === 'number' ? lockedTabId : this.activeTabId;
    if (!targetTabId) {
      return {
        content: [{ type: 'text', text: 'Failed to execute tool: no target tab found' }],
        isError: true,
      };
    }

    const matches: Array<{ domain: string; dataId: string }> = [];
    for (const [domain, domainData] of this.domains.entries()) {
      for (const [dataId, tabData] of domainData.entries()) {
        if (tabData.isClosed || tabData.tabId !== targetTabId) {
          continue;
        }

        if (tabData.tools.some((tool) => tool.name === toolName)) {
          matches.push({ domain, dataId });
        }
      }
    }

    if (!matches.length) {
      const targetLabel =
        typeof lockedTabId === 'number' ? `locked tab ${lockedTabId}` : 'active tab';
      return {
        content: [
          {
            type: 'text',
            text: `Failed to execute tool: tool '${toolName}' is not available on the ${targetLabel}`,
          },
        ],
        isError: true,
      };
    }

    const preferredMatch =
      matches.find(({ domain }) => domain.includes('midea.com') || domain.includes('webedit')) ||
      matches[0];

    return this.executeTool(preferredMatch.domain, preferredMatch.dataId, toolName, args);
  }

  /**
   * 跟踪活动标签页
   * 
   * 监听标签页激活事件，更新活动标签页 ID，
   * 并相应地更新工具描述和请求工具刷新。
   */
  private trackActiveTab() {
    // 初始化当前活动标签页
    this.initializeActiveTab();

    chrome.tabs.onActivated.addListener(async (activeInfo) => {
      const previousActiveTabId = this.activeTabId;
      this.activeTabId = activeInfo.tabId;

      // 更新之前活动标签页的工具描述（移除 Active 状态）
      if (previousActiveTabId && previousActiveTabId !== this.activeTabId) {
        try {
          const prevTab = await chrome.tabs.get(previousActiveTabId);
          if (prevTab.url) {
            const prevDomain = this.extractDomainFromUrl(prevTab.url);
            const prevDataId = `tab-${previousActiveTabId}`;
            this.updateToolDescriptions(prevDomain, prevDataId);
          }
        } catch (e) {
          // 标签页可能已关闭，忽略错误
        }
      }

      // 更新新活动标签页的工具描述（添加 Active 状态）并请求工具刷新
      try {
        const tab = await chrome.tabs.get(this.activeTabId);
        if (!tab.url) return;
        const domain = this.extractDomainFromUrl(tab.url);
        const dataId = `tab-${this.activeTabId}`;
        this.updateToolDescriptions(domain, dataId);
        this.requestToolsFromTab(domain, dataId);
      } catch (e) {
        // 处理错误（如果需要）
      }
    });
  }

  /**
   * 初始化活动标签页
   * 
   * 查询当前窗口的活动标签页并设置 activeTabId。
   */
  private async initializeActiveTab() {
    try {
      const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (activeTab?.id) {
        this.activeTabId = activeTab.id;
      }
    } catch (e) {
      // 处理错误（如果需要）
    }
  }

  /**
   * 更新工具描述
   * 
   * 根据标签页的当前状态（活动/非活动）更新工具描述。
   * 活动标签页的工具描述会包含 'Active' 标记。
   * 
   * @param domain - 域名
   * @param dataId - 标签页数据 ID
   */
  private updateToolDescriptions(domain: string, dataId: string) {
    const domainData = this.getDomainData(domain);
    const tabData = domainData.get(dataId);
    if (!tabData || tabData.isClosed || !tabData.tabId) return;

    const cleanedDomain = sanitizeToolName(domain);
    const namePrefix = `tab${tabData.tabId}`;

    // 遍历所有工具并更新描述
    for (const tool of tabData.tools) {
      const toolName = `website_tool_${cleanedDomain}_${namePrefix}_${sanitizeToolName(tool.name)}`;
      const description = this.getSimpleTabDescription(
        domain,
        dataId,
        tool,
        tool.description || ''
      );

      if (this.registeredTools.has(toolName)) {
        this.registeredTools.get(toolName)!.update({ description });
      }
    }
  }

  findWebsiteRuntimeToolEntry(toolName: string, tabId?: number): WebsiteRuntimeToolEntry | null {
    for (const entry of this.listWebsiteRuntimeTools(tabId)) {
      if (typeof tabId === 'number' && entry.tabId !== tabId) {
        continue;
      }
      const cleanedDomain = sanitizeToolName(entry.domain);
      const namePrefix = entry.dataId.startsWith('cached-')
        ? entry.dataId
        : `tab${entry.tabId ?? ''}`;
      const registeredToolName = `website_tool_${cleanedDomain}_${namePrefix}_${sanitizeToolName(entry.tool.name)}`;

      if (entry.tool.name === toolName || registeredToolName === toolName) {
        return entry;
      }
    }

    return null;
  }

  listWebsiteRuntimeTools(tabId?: number): WebsiteRuntimeToolEntry[] {
    const entries: WebsiteRuntimeToolEntry[] = [];

    for (const [domain, domainData] of this.domains.entries()) {
      for (const [dataId, tabData] of domainData.entries()) {
        if (typeof tabId === 'number' && tabData.tabId !== tabId) {
          continue;
        }

        for (const tool of tabData.tools) {
          entries.push({
            domain,
            dataId,
            url: tabData.url,
            tabId: tabData.tabId,
            isClosed: tabData.isClosed,
            tool,
          });
        }
      }
    }

    return entries;
  }

  /**
   * 清理方法（如果需要）
   * 可以在服务销毁时调用，清理所有注册的工具和数据。
   */
  // cleanup() {
  //   // 实现清理逻辑
  // }
}
