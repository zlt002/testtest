/**
 * Native Host Manager
 * 
 * 该模块负责管理扩展与 Native Host 之间的通信。
 * Native Host 是一个本地进程，通过 Chrome Native Messaging 协议与扩展通信，
 * 提供 MCP 服务器的功能。
 * 
 * 主要功能：
 * - 管理 Native Host 连接和重连逻辑
 * - 处理来自 Native Host 的消息（工具调用、工具列表等）
 * - 提供 MCP 服务器和客户端的桥接
 * - 管理服务器状态和持久化
 * - 提供内省工具（introspection tools）用于动态工具发现
 */

// 导入传输层相关的常量和类型
import {
  BACKGROUND_MESSAGE_TYPES,  // 后台消息类型
  ERROR_MESSAGES,            // 错误消息常量
  NATIVE_HOST,               // Native Host 配置
  NativeMessageType,         // Native 消息类型枚举
  STORAGE_KEYS,              // 存储键常量
  SUCCESS_MESSAGES,          // 成功消息常量
} from '@mcp-b/transports';

// 导入 MCP SDK 客户端和服务器
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

// 导入 MCP 类型定义
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';

// 导入 Zod 用于输入模式验证
import { z } from 'zod';

// 导入内存传输层（用于服务器和客户端之间的通信）
import { clientTransport, serverTransport } from '../../inMemory';

// 导入 MCP Hub（管理来自内容脚本的工具）
import McpHub, { getMcpHubInstance, type WebsiteRuntimeToolEntry } from './mcpHub';
import { resolveCurrentPageCodebaseContext } from './page-code-context';
import { readCurrentPageContent } from './read-current-page-content';

/**
 * 工具调用参数接口
 * 
 * 定义工具调用的基本参数结构。
 */
export interface ToolCallParam {
  /** 工具名称 */
  name: string;
  /** 工具参数（任意类型） */
  args: any;
}

/**
 * 创建错误响应
 * 
 * 创建一个标准的 MCP 错误响应对象。
 * 
 * @param message - 错误消息
 * @returns MCP 错误响应
 */
export const createErrorResponse = (
  message = 'Unknown error, please try again'
): CallToolResult => {
  console.log(`[native] Creating error response: ${message}`);
  return {
    content: [
      {
        type: 'text',
        text: message,
      },
    ],
    isError: true,
  };
};

function normalizeWebsiteToolMatchCandidates(domain?: string): string[] {
  const raw = String(domain || '')
    .trim()
    .toLowerCase();

  if (!raw) {
    return [];
  }

  const candidates = new Set<string>();
  const push = (value?: string | null) => {
    const normalized = String(value || '')
      .trim()
      .toLowerCase();
    if (!normalized) {
      return;
    }
    candidates.add(normalized);
    candidates.add(normalized.replace(/\./g, '_'));
  };

  push(raw);
  push(raw.replace(/^https?:\/\//, ''));

  try {
    const hostname = new URL(raw.includes('://') ? raw : `https://${raw}`).hostname.toLowerCase();
    push(hostname);
    if (hostname === 'doc.midea.com') {
      push('webedit');
      push('webedit.midea.com');
    }
  } catch {
    // Ignore unparseable domain values and fall back to raw string matching.
  }

  return Array.from(candidates);
}

export function matchesWebsiteToolDomain(
  tool: { name?: string | null; description?: string | null },
  domain?: string
): boolean {
  const toolName = String(tool.name || '').toLowerCase();
  const toolDescription = String(tool.description || '').toLowerCase();
  const isWebsiteLikeTool =
    toolName.includes('website') ||
    toolName.startsWith('webedit_') ||
    toolDescription.includes('iframe:') ||
    toolDescription.includes('via ');

  if (!isWebsiteLikeTool) {
    return false;
  }

  if (!domain) {
    return true;
  }

  const candidates = normalizeWebsiteToolMatchCandidates(domain);
  return candidates.some(
    (candidate) => toolName.includes(candidate) || toolDescription.includes(candidate)
  );
}

function buildRuntimeWebsiteToolDescription(entry: WebsiteRuntimeToolEntry): string {
  const sourceHost = (() => {
    try {
      return new URL(entry.url).hostname;
    } catch {
      return entry.domain;
    }
  })();

  const status = entry.isClosed ? 'Cached Tab' : entry.tabId ? `Tab ${entry.tabId}` : 'Active Tab';
  const viaLabel = entry.tool.name.startsWith('webedit_')
    ? `WebEdit iframe:webedit.midea.com via ${sourceHost}`
    : sourceHost;

  return `[${viaLabel} • ${status}] ${entry.tool.description || ''}`.trim();
}

function listRuntimeWebsiteTools(domain?: string, tabId?: number) {
  const hub = getMcpHubInstance();
  if (!hub) {
    return [];
  }

  return hub
    .listWebsiteRuntimeTools(tabId)
    .filter((entry) => (typeof tabId === 'number' ? entry.tabId === tabId : true))
    .filter((entry) =>
      matchesWebsiteToolDomain(
        {
          name: entry.tool.name,
          description: buildRuntimeWebsiteToolDescription(entry),
        },
        domain
      )
    );
}

/**
 * 处理工具执行
 * 
 * 通过 MCP 客户端执行指定的工具调用，并返回结果。
 * 
 * @param param - 工具调用参数（名称和参数）
 * @param client - MCP 客户端实例
 * @returns 工具执行结果或错误响应
 */
export const handleCallTool = async (
  param: ToolCallParam,
  client: Client
): Promise<CallToolResult> => {
  console.log(`[native] Handling tool call: ${param.name} with args:`, param.args);
  try {
    // 调用 MCP 客户端执行工具
    // @ts-ignore - MCP SDK 类型定义可能不完整
    const result = await client.callTool({
      name: param.name,
      arguments: param.args,
    });
    console.log(`[native] Tool call successful for ${param.name}:`, result);
    // @ts-ignore
    return result;
  } catch (error) {
    console.error(`[native] Tool execution failed for ${param.name}:`, error);
    return createErrorResponse(
      error instanceof Error ? error.message : ERROR_MESSAGES.TOOL_EXECUTION_FAILED
    );
  }
};

/** Native Host 通信端口 */
let nativePort: chrome.runtime.Port | null = null;

/** 复用同一套 MCP runtime，避免反复 new McpHub 导致旧监听器/旧工具集合残留 */
let mcpRuntimePromise: Promise<{ server: McpServer; client: Client }> | null = null;

/** Native Host 名称 */
export const HOST_NAME = NATIVE_HOST.NAME;

/**
 * 服务器状态管理接口
 * 
 * 用于跟踪和持久化 Native Host 服务器的运行状态。
 */
interface ServerStatus {
  /** 服务器是否正在运行 */
  isRunning: boolean;
  /** 服务器端口号 */
  port?: number;
  /** 最后更新时间戳 */
  lastUpdated: number;
}

/**
 * Companion 发现接口
 * 
 * 用于发现和获取 Companion（Agent V2）服务的连接信息。
 */
export interface CompanionDiscovery {
  /** Agent 基础 URL */
  agentBaseUrl: string;
  /** Agent API 基础 URL */
  agentApiBaseUrl: string;
  /** MCP 服务器 URL */
  mcpUrl: string;
  /** Agent 能力信息 */
  capabilities: unknown | null;
  /** Native Host 连接状态 */
  nativeHost?: {
    connected: boolean;
    server: ServerStatus;
  };
}

/** 当前服务器状态 */
let currentServerStatus: ServerStatus = {
  isRunning: false,
  lastUpdated: Date.now(),
};

/** 重连定时器 */
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

/** 重连尝试次数 */
let reconnectAttempts = 0;

/** 最大重连尝试次数 */
const MAX_RECONNECT_ATTEMPTS = 5;

/**
 * 检查是否为 Service Worker 重载错误
 * 
 * 在 Service Worker 重载期间，某些操作会失败。
 * 该函数用于识别这些错误以便优雅处理。
 * 
 * @param error - 错误对象
 * @returns 是否为 Service Worker 错误
 */
function isNoServiceWorkerError(error: unknown): boolean {
  return error instanceof Error && error.message.includes('No SW');
}

/**
 * 调度 Native Host 重连
 * 
 * 使用指数退避策略调度重连尝试。
 * 延迟时间从 1 秒开始，每次失败后翻倍，最大 10 秒。
 * 
 * @param port - Native Host 端口号
 */
function scheduleNativeReconnect(port: number): void {
  // 如果已有重连定时器，跳过
  if (reconnectTimer) {
    return;
  }

  // 检查是否超过最大重连次数
  if (reconnectAttempts >= MAX_RECONNECT_ATTEMPTS) {
    console.warn(
      `[native] Reconnect stopped after ${MAX_RECONNECT_ATTEMPTS} failed attempts. Reload the extension or send ensure_native_host after fixing native host registration.`
    );
    return;
  }

  // 计算延迟时间（指数退避，最大 10 秒）
  const delay = Math.min(1000 * 2 ** reconnectAttempts, 10_000);
  reconnectAttempts += 1;

  console.warn(`[native] Scheduling reconnect attempt ${reconnectAttempts} in ${delay}ms`);
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    void connectNativeHost(port);
  }, delay);
}

/**
 * 保存服务器状态到 chrome.storage
 * 
 * 将服务器状态持久化到本地存储，以便在扩展重启后恢复。
 * 
 * @param status - 要保存的服务器状态
 */
async function saveServerStatus(status: ServerStatus): Promise<void> {
  console.log('[native] Saving server status:', status);
  try {
    await chrome.storage.local.set({ [STORAGE_KEYS.SERVER_STATUS]: status });
    console.log('[native] Server status saved successfully');
  } catch (error) {
    // Service Worker 重载期间跳过保存
    if (isNoServiceWorkerError(error)) {
      console.warn('[native] Skipping server status save during SW reload');
      return;
    }
    console.error(`[native] ${ERROR_MESSAGES.SERVER_STATUS_SAVE_FAILED}:`, error);
  }
}

/**
 * 从 chrome.storage 加载服务器状态
 * 
 * 从本地存储加载之前保存的服务器状态。
 * 如果没有保存的状态，返回默认状态。
 * 
 * @returns 服务器状态
 */
async function loadServerStatus(): Promise<ServerStatus> {
  console.log('[native] Loading server status from storage');
  try {
    const result = await chrome.storage.local.get([STORAGE_KEYS.SERVER_STATUS]);
    if (result[STORAGE_KEYS.SERVER_STATUS]) {
      console.log('[native] Server status loaded:', result[STORAGE_KEYS.SERVER_STATUS]);
      return result[STORAGE_KEYS.SERVER_STATUS];
    }
    console.log('[native] No stored server status found, using default');
  } catch (error) {
    // Service Worker 重载期间返回默认状态
    if (isNoServiceWorkerError(error)) {
      console.warn('[native] Skipping server status load during SW reload');
      return {
        isRunning: false,
        lastUpdated: Date.now(),
      };
    }
    console.error(`[native] ${ERROR_MESSAGES.SERVER_STATUS_LOAD_FAILED}:`, error);
  }
  // 返回默认状态
  return {
    isRunning: false,
    lastUpdated: Date.now(),
  };
}

/**
 * 广播服务器状态变更到所有监听器
 * 
 * 通过 chrome.runtime.sendMessage 向所有监听器发送服务器状态变更通知。
 * 
 * @param status - 新的服务器状态
 */
function broadcastServerStatusChange(status: ServerStatus): void {
  console.log('[native] Broadcasting server status change:', status);
  chrome.runtime
    .sendMessage({
      type: BACKGROUND_MESSAGE_TYPES.SERVER_STATUS_CHANGED,
      payload: status,
    })
    .catch((error) => {
      // Service Worker 重载期间跳过广播
      if (isNoServiceWorkerError(error)) {
        console.warn('[native] Skipping server status broadcast during SW reload');
        return;
      }
      // 如果没有监听器，忽略错误
      console.log('[native] No listeners for server status change broadcast');
    });
}

/**
 * 更新并持久化服务器状态
 * 
 * 合并新的状态到当前状态，更新时间戳，
 * 保存到存储并广播变更通知。
 * 
 * @param newStatus - 要更新的状态部分
 */
async function updateServerStatus(newStatus: Partial<ServerStatus>): Promise<void> {
  currentServerStatus = {
    ...currentServerStatus,
    ...newStatus,
    lastUpdated: Date.now(),
  };
  await saveServerStatus(currentServerStatus);
  broadcastServerStatusChange(currentServerStatus);
}

/**
 * 设置内省工具（Introspection Tools）用于动态工具发现和管理
 * 
 * 这些工具对于 AI 智能体理解 accr-ui 生态系统中可用工具的当前状态至关重要。
 * 由于许多 MCP 客户端不支持实时工具更新，这些工具允许 AI 在预期变化时主动检查可用工具。
 * 
 * 主要用例：
 * 1. 导航到新网站后 - 检查哪些网站特定工具变得可用
 * 2. 对网站进行可能暴露新工具的更改后 - 验证工具是否已添加
 * 3. 在多个网站之间工作时 - 发现已存在哪些域特定工具
 * 4. 调试工具可用性问题时 - 按类别列出所有工具
 * 
 * 工具分类：
 * - Website tools: 网站通过其 MCP 服务器暴露的工具（带域名前缀）
 * - Extension tools: 浏览器扩展提供的工具
 * - Native tools: 来自本地 MCP 服务器的工具（其他所有工具）
 * 
 * @param server - MCP 服务器实例
 * @param client - MCP 客户端实例
 */
export function setupIntrospectionTools(server: McpServer, client: Client): void {
  server.tool(
    'debug_webedit_bridge',
    'Inspect the current WebEdit content-script bridge state for a tab. Use this when doc.midea.com or webedit.midea.com tools are missing, iframe handshake seems stuck, or WebEdit page reads keep timing out.',
    {
      tabId: z
        .number()
        .describe('Target browser tab ID. Prefer the tabId from browser_context or from extension_tool_tab_operations.')
        .optional(),
      windowId: z
        .number()
        .describe('Optional window ID used to resolve the active tab when tabId is omitted.')
        .optional(),
    },
    async ({ tabId, windowId }) => {
      try {
        const targetTabId =
          typeof tabId === 'number'
            ? tabId
            : await (async () => {
                const query: chrome.tabs.QueryInfo =
                  typeof windowId === 'number'
                    ? { active: true, windowId }
                    : { active: true, lastFocusedWindow: true };
                const [activeTab] = await chrome.tabs.query(query);
                return activeTab?.id;
              })();

        if (typeof targetTabId !== 'number') {
          return createErrorResponse(
            'No target tab resolved for debug_webedit_bridge. Pass tabId explicitly when possible.'
          );
        }

        const tab = await chrome.tabs.get(targetTabId);
        const response = await chrome.tabs.sendMessage(targetTabId, {
          type: 'webedit-debug-state',
        });

        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(
                {
                  tab: {
                    tabId: targetTabId,
                    windowId: tab.windowId,
                    title: tab.title,
                    url: tab.url,
                    status: tab.status,
                  },
                  bridgeState: response,
                },
                null,
                2
              ),
            },
          ],
        };
      } catch (error) {
        return createErrorResponse(
          error instanceof Error
            ? error.message
            : 'Failed to inspect WebEdit bridge state'
        );
      }
    }
  );

  /**
   * list_website_tools - 发现网站暴露的工具
   * 
   * 该工具对于处理动态网站工具的 AI 智能体至关重要。
   * 由于网站可以根据以下条件暴露不同的工具：
   * - 当前页面/路由（例如，购物车工具仅在 /cart 页面上）
   * - 用户认证状态（管理员的 admin 工具）
   * - 组件生命周期（工具随 React 组件出现/消失）
   * 
   * AI 应在以下情况调用此工具：
   * - 导航到新网站或页面后
   * - 执行可能改变可用工具的操作后
   * - 需要验证特定域具有预期工具时
   * 
   * 示例：
   * - domain: "amazon" - 列出所有 Amazon 网站工具
   * - domain: "google" - 列出所有 Google 网站工具
   * - domain: undefined - 列出来自所有域的所有网站工具
   */
  server.tool(
    'list_website_tools',
    'List all website tools for a given website. Use this after navigating to a new site or when you expect website tools to have changed (e.g., after login, page change, or component updates)',
    {
      domain: z
        .string()
        .describe(
          'The domain to list tools for. Examples: "google" for google.com, "amazon" for amazon.com. Leave empty to list ALL website tools from all domains.'
        )
        .optional()
        .default('website'),
      tabId: z
        .number()
        .describe('Optional locked browser tab ID. When provided, only return website tools registered on that tab.')
        .optional(),
    },
    async ({ domain, tabId }) => {
      const hub = getMcpHubInstance();
      const runtimeTools = listRuntimeWebsiteTools(domain, tabId);
      const tools = await client.listTools();
      const registeredTools = tools.tools.filter((tool) => {
        if (!matchesWebsiteToolDomain(tool, domain)) {
          return false;
        }

        if (typeof tabId !== 'number') {
          return true;
        }

        const runtimeEntry = hub?.findWebsiteRuntimeToolEntry(tool.name);
        return runtimeEntry?.tabId === tabId;
      });

      const mergedTools = new Map<string, any>();

      for (const tool of registeredTools) {
        mergedTools.set(tool.name, {
          name: tool.name,
          description: tool.description,
          inputSchema: tool.inputSchema,
        });
      }

      for (const entry of runtimeTools) {
        mergedTools.set(entry.tool.name, {
          name: entry.tool.name,
          description: buildRuntimeWebsiteToolDescription(entry),
          inputSchema: entry.tool.inputSchema,
          sourceDomain: entry.domain,
          sourceUrl: entry.url,
          tabId: entry.tabId,
          isClosed: entry.isClosed,
          origin: 'runtime',
        });
      }

      const filteredTools = Array.from(mergedTools.values());

      if (filteredTools.length === 0) {
        return {
          content: [
            {
              type: 'text',
              text: domain
                ? `No tools found for domain "${domain}". This could mean:\n` +
                  `1. The website doesn\'t have an MCP server\n` +
                  `2. You haven\'t navigated to the website yet\n` +
                  `3. The website\'s tools haven\'t loaded yet\n` +
                  `4. The domain name doesn\'t match (try variations)`
                : 'No website tools found. Navigate to a website with MCP support to see its tools.',
            },
          ],
          isError: false, // This isn't really an error, just no results
        };
      }

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(
              {
                domain: domain || 'all',
                toolCount: filteredTools.length,
                tools: filteredTools,
              },
              null,
              2
            ),
          },
        ],
      };
    }
  );

  /**
   * list_extension_tools - 发现浏览器扩展提供的工具
   * 
   * 扩展工具无论当前网站如何都始终可用。这些包括：
   * - 浏览器 API 工具（标签页、书签、历史记录等）
   * - 跨站点自动化工具
   * - 浏览器状态管理工具
   * 
   * AI 应在以下情况调用此工具：
   * - 需要执行浏览器级别操作时
   * - 发现有哪些浏览器自动化功能可用时
   * - 规划跨站点工作流时
   */
  server.tool(
    'list_extension_tools',
    'List all browser extension tools. These tools are always available and provide browser-level functionality like tab management, bookmarks, history, etc.',
    {},
    async () => {
      const tools = await client.listTools();
      const filteredTools = tools.tools.filter((tool) => tool.name.includes('extension'));

      if (filteredTools.length === 0) {
        return {
          content: [
            {
              type: 'text',
              text: 'No extension tools found. This might indicate the accr-ui extension is not properly initialized.',
            },
          ],
          isError: true,
        };
      }

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(
              {
                toolCount: filteredTools.length,
                tools: filteredTools.map((tool) => ({
                  name: tool.name,
                  description: tool.description,
                  category: tool.name.split('_')[1], // e.g., "tabs", "bookmarks", etc.
                  inputSchema: tool.inputSchema,
                })),
              },
              null,
              2
            ),
          },
        ],
      };
    }
  );

  /**
   * read_current_page_content - 从浏览器标签页读取可见文档文本
   * 
   * 这是一个稳定的便利包装器，供智能体使用。
   * 它避免了让模型猜测不存在的页面读取扩展工具名称，
   * 并在侧边栏发送浏览器上下文时强制标签页/窗口目标明确。
   */
  server.tool(
    'read_current_page_content',
    'Read title, URL, and visible text from the current browser page. Prefer passing tabId from browser_context when available.',
    {
      tabId: z
        .number()
        .describe('Target tab ID. Use the tabId from browser_context when available.')
        .optional(),
      windowId: z
        .number()
        .describe('Target window ID. Used to resolve the active tab when tabId is omitted.')
        .optional(),
      maxChars: z
        .number()
        .int()
        .min(500)
        .max(50000)
        .describe('Maximum number of page text characters to return.')
        .optional()
        .default(12000),
      includeFrames: z
        .boolean()
        .describe('Whether to inspect accessible iframe content in addition to the main frame.')
        .optional()
        .default(false),
      maxFrames: z
        .number()
        .int()
        .min(1)
        .max(20)
        .describe('Maximum number of accessible frames to inspect when includeFrames is enabled.')
        .optional()
        .default(12),
      frameStrategy: z
        .enum(['main-only', 'all-accessible', 'wps-priority'])
        .describe('Frame selection strategy. Use wps-priority for WPS/WebEdit-heavy pages.')
        .optional()
        .default('main-only'),
      includeFrameAnalysis: z
        .boolean()
        .describe('Whether to include structured frame analysis metadata in the response.')
        .optional()
        .default(false),
    },
    async ({
      tabId,
      windowId,
      maxChars,
      includeFrames,
      maxFrames,
      frameStrategy,
      includeFrameAnalysis,
    }) => {
      try {
        const result = await readCurrentPageContent({
          tabId,
          windowId,
          maxChars,
          includeFrames,
          maxFrames,
          frameStrategy,
          includeFrameAnalysis,
        });

        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(result),
            },
          ],
        };
      } catch (error) {
        return createErrorResponse(
          error instanceof Error ? error.message : 'Failed to read current page content'
        );
      }
    }
  );

  server.tool(
    'resolve_current_page_codebase_context',
    'Collect current page evidence for page-linked analysis, including URL, page summary, API candidates, resource hints, and frame hints.',
    {
      tabId: z
        .number()
        .describe('Target tab ID. Use the tabId from browser_context when available.')
        .optional(),
      windowId: z
        .number()
        .describe('Target window ID. Used to resolve the active tab when tabId is omitted.')
        .optional(),
      maxChars: z
        .number()
        .int()
        .min(500)
        .max(50000)
        .describe('Maximum number of page text characters to inspect before summarizing.')
        .optional()
        .default(8000),
      includeFrames: z
        .boolean()
        .describe('Whether to inspect accessible iframe content in addition to the main frame.')
        .optional()
        .default(false),
    },
    async ({ tabId, windowId, maxChars, includeFrames }) => {
      try {
        const result = await resolveCurrentPageCodebaseContext({
          tabId,
          windowId,
          maxChars,
          includeFrames,
          ensureCompanionReady,
        });

        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(result),
            },
          ],
        };
      } catch (error) {
        return createErrorResponse(
          error instanceof Error
            ? error.message
            : 'Failed to collect current page codebase context'
        );
      }
    }
  );

  /**
   * list_native_tools - 发现来自本地 MCP 服务器的工具
   * 
   * 这个隐式工具（未明确定义但通过过滤可用）
   * 列出所有既不是网站工具也不是扩展工具的工具。
   * 这些通常是来自用户机器上运行的本地 MCP 服务器的工具。
   * 
   * 注意：这目前在消息处理程序中通过从完整工具列表中过滤出
   * 网站和扩展工具来处理。
   */

  /**
   * call_website_tool - 执行来自网站 MCP 服务器的工具
   * 
   * 该工具允许 AI 直接调用网站特定工具。
   * 网站工具由网站动态注册，可能需要在正确的页面/域上才能正常工作。
   * 
   * AI 应在以下情况使用此工具：
   * - 需要与网站特定功能交互时
   * - 已通过 list_website_tools 识别网站工具并想要执行它时
   * - 执行跨站点工作流并需要调用来自特定域的工具时
   * 
   * 注意：工具执行在网站的上下文中进行，因此身份验证和页面状态会自动处理。
   */
  server.tool(
    'call_website_tool',
    'Execute a tool from a website MCP server. Use this to call website-specific tools that you discovered via list_website_tools.',
    {
      toolName: z
        .string()
        .describe('The exact name of the website tool to call (e.g., "amazon_website_addToCart")'),
      arguments: z
        .record(z.any())
        .describe('The arguments to pass to the tool as a key-value object')
        .optional()
        .default({}),
      lockedTabId: z
        .number()
        .describe('Optional locked browser tab ID. When provided, the tool must belong to that tab.')
        .optional(),
    },
    async ({ toolName, arguments: args, lockedTabId }) => {
      console.log(`[native] Calling website tool: ${toolName} with args:`, args);

      try {
        const hub = getMcpHubInstance();

        if (!toolName.includes('website')) {
          if (hub) {
            return typeof lockedTabId === 'number'
              ? await hub.executeWebsiteToolOnActiveTab(toolName, args, lockedTabId)
              : await hub.executeWebsiteToolOnActiveTab(toolName, args);
          }
        }

        if (typeof lockedTabId === 'number') {
          const runtimeEntry = hub?.findWebsiteRuntimeToolEntry(toolName, lockedTabId);
          if (!runtimeEntry || runtimeEntry.tabId !== lockedTabId) {
            return {
              content: [
                {
                  type: 'text',
                  text: `Website tool "${toolName}" is not available on locked tab ${lockedTabId}. Use list_website_tools with the same tabId to refresh the tool list.`,
                },
              ],
              isError: true,
            };
          }
        }

        // Verify this is actually a website tool
        const tools = await client.listTools();
        const tool = tools.tools.find(
          (t: any) => t.name === toolName && t.name.includes('website')
        );

        if (!tool) {
          return {
            content: [
              {
                type: 'text',
                text: `Website tool "${toolName}" not found. Use list_website_tools to see available tools. Make sure you're on the correct website.`,
              },
            ],
            isError: true,
          };
        }

        // Call the tool
        const result = await client.callTool({
          name: toolName,
          arguments: args,
        });

        console.log(`[native] Website tool call successful for ${toolName}:`, result);
        return result as any;
      } catch (error) {
        console.error(`[native] Website tool execution failed for ${toolName}:`, error);
        return createErrorResponse(
          error instanceof Error ? error.message : `Failed to execute website tool: ${toolName}`
        );
      }
    }
  );

  /**
   * call_extension_tool - 执行浏览器扩展工具
   * 
   * 该工具允许 AI 直接调用浏览器扩展工具。
   * 扩展工具提供浏览器级别的功能，无论当前网站如何都始终可用。
   * 
   * AI 应在以下情况使用此工具：
   * - 需要执行浏览器自动化（管理标签页、书签等）时
   * - 想要访问浏览器状态或历史记录时
   * - 执行需要浏览器级别协调的跨站点工作流时
   * 
   * 扩展工具比网站工具更稳定，因为它们不依赖于页面状态或导航。
   */
  server.tool(
    'call_extension_tool',
    'Execute a browser extension tool. Use this to call extension tools that provide browser-level functionality like tab management, bookmarks, history, etc.',
    {
      toolName: z
        .string()
        .describe('The exact name of the extension tool to call (e.g., "extension_tabs_create")'),
      arguments: z
        .record(z.any())
        .describe('The arguments to pass to the tool as a key-value object')
        .optional()
        .default({}),
    },
    async ({ toolName, arguments: args }) => {
      console.log(`[native] Calling extension tool: ${toolName} with args:`, args);

      try {
        // Verify this is actually an extension tool
        const tools = await client.listTools();
        const tool = tools.tools.find(
          (t: any) => t.name === toolName && t.name.includes('extension')
        );

        if (!tool) {
          return {
            content: [
              {
                type: 'text',
                text: `Extension tool "${toolName}" not found. Use list_extension_tools to see available tools.`,
              },
            ],
            isError: true,
          };
        }

        // Call the tool
        const result = await client.callTool({
          name: toolName,
          arguments: args,
        });

        console.log(`[native] Extension tool call successful for ${toolName}:`, result);
        return result as any;
      } catch (error) {
        console.error(`[native] Extension tool execution failed for ${toolName}:`, error);
        return createErrorResponse(
          error instanceof Error ? error.message : `Failed to execute extension tool: ${toolName}`
        );
      }
    }
  );
}

/**
 * 设置 MCP 服务器和客户端
 * 
 * 创建并连接 MCP 服务器和客户端实例，
 * 初始化 MCP Hub 以管理来自内容脚本的工具，
 * 并设置内省工具。
 * 
 * @returns MCP 服务器和客户端实例
 */
async function setupMcp(): Promise<{ server: McpServer; client: Client }> {
  if (mcpRuntimePromise) {
    return mcpRuntimePromise;
  }

  mcpRuntimePromise = (async () => {
    // 创建 MCP 服务器
    const server = new McpServer({
      name: 'Native-Host',
      version: '1.0.0',
    });

    // 只初始化一次 MCP Hub，避免在重连时重复注册监听器与工具树。
    new McpHub(server);

    // 连接服务器到内存传输层
    await server.connect(serverTransport);

    // 创建 MCP 客户端
    const client = new Client({
      name: 'Native-Host',
      version: '1.0.0',
    });
    // 连接客户端到内存传输层
    await client.connect(clientTransport);

    // 设置内省工具
    setupIntrospectionTools(server, client);

    return { server, client };
  })().catch((error) => {
    mcpRuntimePromise = null;
    throw error;
  });

  return mcpRuntimePromise;
}

/**
 * 发送响应到 Native Host
 * 
 * 通过 Native Messaging 端口向 Native Host 发送响应消息。
 * 
 * @param requestId - 请求 ID
 * @param payload - 响应载荷
 */
function sendNativeResponse(requestId: string, payload: any): void {
  if (!nativePort) return;
  nativePort.postMessage({
    responseToRequestId: requestId,
    payload,
  });
  console.log(`[native] Sent response for request ${requestId}`);
}

/**
 * 为不同的 Native 消息类型创建消息处理程序
 * 
 * 返回一个对象，其中每个键对应一种消息类型，值为处理该消息的函数。
 * 
 * @param client - MCP 客户端实例
 * @returns 消息处理程序映射
 */
const createMessageHandlers = (client: Client) => ({
  /** 处理 PROCESS_DATA 消息 */
  [NativeMessageType.PROCESS_DATA]: async (message: any) => {
    if (!message.requestId) return;
    const { requestId, payload: requestPayload } = message;
    console.log(
      `[native] Processing PROCESS_DATA request ${requestId} with payload:`,
      requestPayload
    );

    // 返回处理后的数据
    sendNativeResponse(requestId, {
      status: 'success',
      message: SUCCESS_MESSAGES.TOOL_EXECUTED,
      data: requestPayload,
    });
  },

  /** 处理 LIST_TOOLS 消息 */
  [NativeMessageType.LIST_TOOLS]: async (message: any) => {
    if (!message.requestId) return;
    const { requestId } = message;
    console.log(`[native] Processing LIST_TOOLS request ${requestId}`);

    // 获取工具列表并过滤出 Native 工具（排除网站和扩展工具）
    const { tools } = await client.listTools();
    console.log('[native] List tools:', tools);

    sendNativeResponse(requestId, {
      status: 'success',
      message: SUCCESS_MESSAGES.TOOL_EXECUTED,
      data: tools.filter(
        (tool) => !tool.name.startsWith('website') && !tool.name.startsWith('extension')
      ),
    });
  },

  // 注意：原始代码中 'request_data' 是 LIST_TOOLS 的别名，但在这里在 LIST_TOOLS 下处理。
  // 如果是单独的类型，请将其作为另一个键添加。

  /** 处理 CALL_TOOL 消息 */
  [NativeMessageType.CALL_TOOL]: async (message: any) => {
    if (!message.requestId || !message.payload) return;
    const { requestId, payload } = message;
    console.log(`[native] Processing CALL_TOOL request ${requestId} with payload:`, payload);

    try {
      // 执行工具调用
      const result = await handleCallTool(payload, client);
      sendNativeResponse(requestId, {
        status: 'success',
        message: SUCCESS_MESSAGES.TOOL_EXECUTED,
        data: result,
      });
      console.log(`[native] Sent successful CALL_TOOL response for request ${requestId}`);
    } catch (error) {
      console.error(`[native] Error handling CALL_TOOL request ${requestId}:`, error);
      sendNativeResponse(requestId, {
        status: 'error',
        message: ERROR_MESSAGES.TOOL_EXECUTION_FAILED,
        error: error instanceof Error ? error.message : String(error),
      });
      console.log(`[native] Sent error CALL_TOOL response for request ${requestId}`);
    }
  },

  /** 处理 SERVER_STARTED 消息 */
  [NativeMessageType.SERVER_STARTED]: async (message: any) => {
    const port = message.payload?.port;
    if (!port) return;
    console.log(`[native] Server started notification received for port ${port}`);
    // 更新服务器状态为运行中
    await updateServerStatus({ isRunning: true, port });
    console.log(`[native] ${SUCCESS_MESSAGES.SERVER_STARTED} on port ${port}`);
  },

  /** 处理 SERVER_STOPPED 消息 */
  [NativeMessageType.SERVER_STOPPED]: async () => {
    console.log('[native] Server stopped notification received');
    // 更新服务器状态为停止
    await updateServerStatus({ isRunning: false });
    console.log(`[native] ${SUCCESS_MESSAGES.SERVER_STOPPED}`);
  },

  /** 处理 ERROR_FROM_NATIVE_HOST 消息 */
  [NativeMessageType.ERROR_FROM_NATIVE_HOST]: (message: any) => {
    const errorMessage = message.payload?.message || 'Unknown error';
    console.error(`[native] Error from native host: ${errorMessage}`);
  },

  /** 处理 TOOL_LIST_UPDATED_ACK 消息 */
  [NativeMessageType.TOOL_LIST_UPDATED_ACK]: async (message: any) => {
    console.log('[native] Tool list updated ack received', JSON.stringify(message, null, 2));
  },
});

/**
 * 连接到 Native Messaging Host
 * 
 * 建立与 Native Host 的连接，设置消息处理程序，
 * 并处理重连逻辑。
 * 
 * @param port - Native Host 端口号
 */
export async function connectNativeHost(port: number = NATIVE_HOST.DEFAULT_PORT) {
  console.log(`[native] Attempting to connect to native host on port ${port}`);

  // 如果已连接，跳过连接尝试
  if (nativePort) {
    console.log('[native] Native port already connected, skipping connection attempt');
    return;
  }

  try {
    // 设置 MCP 服务器和客户端
    const { client } = await setupMcp();
    const messageHandlers = createMessageHandlers(client);

    // 创建 Native Host 连接
    console.log(`[native] Creating native port connection to ${HOST_NAME}`);
    nativePort = chrome.runtime.connectNative(HOST_NAME);
    reconnectAttempts = 0;

    // 设置消息监听器
    nativePort.onMessage.addListener(async (message) => {
      console.log('[native] Received message from native host:', message);

      // 根据消息类型路由到相应的处理程序
      const handler = messageHandlers[message.type as keyof typeof messageHandlers];
      if (handler) {
        await handler(message);
      } else {
        console.log(`[native] Unhandled message type: ${message.type}`);
      }
    });

    // 设置断开连接监听器
    nativePort.onDisconnect.addListener(() => {
      const lastError = chrome.runtime.lastError;
      console.warn('[native] Native port disconnected. lastError:', lastError);
      
      // 检查是否为 Native Host 退出
      if (lastError?.message?.includes('Native host has exited.')) {
        console.warn('[native] Native host exited; scheduling reconnect');
        nativePort = null;
        void updateServerStatus({ isRunning: false, port: undefined });
        scheduleNativeReconnect(port);
        return;
      }

      // 处理其他断开连接错误
      const serializedLastError = JSON.stringify(lastError, null, 2);
      const disconnectedMessage = `[native] ${ERROR_MESSAGES.NATIVE_DISCONNECTED}`;
      console.error(disconnectedMessage, serializedLastError);
      nativePort = null;
      void updateServerStatus({ isRunning: false, port: undefined });
      scheduleNativeReconnect(port);
    });

    // 发送启动消息到 Native Host
    const startMessage = { type: NativeMessageType.START, payload: { port } };
    console.log('[native] Sending START message to native host:', startMessage);
    nativePort.postMessage(startMessage);

    console.log('[native] Native host connection established successfully');
  } catch (error) {
    console.error(`[native] ${ERROR_MESSAGES.NATIVE_CONNECTION_FAILED}:`, error);
  }
}

/**
 * 探测 Agent 能力
 * 
 * 尝试从 Agent V2 服务器获取能力信息。
 * 
 * @param agentBaseUrl - Agent 基础 URL
 * @returns 能力信息或 null（如果失败）
 */
async function probeAgentCapabilities(agentBaseUrl: string): Promise<unknown | null> {
  try {
    const response = await fetch(`${agentBaseUrl}/api/capabilities`);
    if (!response.ok) {
      return null;
    }
    return response.json();
  } catch (error) {
    console.debug('[native] Agent V2 capabilities probe failed:', error);
    return null;
  }
}

function buildCompanionDiscoveryFallback(
  port: number,
  agentBaseUrl: string,
  capabilities: unknown | null
): CompanionDiscovery {
  return {
    agentBaseUrl,
    agentApiBaseUrl: `${agentBaseUrl}/api/agent-v2`,
    mcpUrl: `http://127.0.0.1:${port}/mcp`,
    capabilities,
    nativeHost: {
      connected: nativePort !== null,
      server: currentServerStatus,
    },
  };
}

async function recoverStaleNativePort(
  port: number,
  agentBaseUrl: string
): Promise<unknown | null> {
  if (!nativePort) {
    return null;
  }

  const capabilities = await probeAgentCapabilities(agentBaseUrl);
  if (capabilities) {
    return capabilities;
  }

  console.warn('[native] Native port is connected but companion is unhealthy; reconnecting');
  try {
    nativePort.disconnect();
  } catch (error) {
    console.warn('[native] Failed to disconnect stale native port cleanly:', error);
  }
  nativePort = null;
  await updateServerStatus({ isRunning: false, port: undefined });
  await connectNativeHost(port);
  return null;
}

/**
 * 探测 Companion 发现端点
 * 
 * 尝试从 Native Host 服务器的发现端点获取连接信息。
 * 最多尝试 20 次，每次间隔 250ms。
 * 
 * @param port - Native Host 端口号
 * @returns Companion 发现信息或 null（如果失败）
 */
async function probeCompanionDiscovery(port: number): Promise<CompanionDiscovery | null> {
  const discoveryUrl = `http://127.0.0.1:${port}/discovery`;
  // 最多尝试 20 次，每次间隔 250ms
  for (let attempt = 0; attempt < 20; attempt += 1) {
    try {
      const response = await fetch(discoveryUrl);
      if (response.ok) {
        return (await response.json()) as CompanionDiscovery;
      }
    } catch {
      // Native 服务器可能仍在启动中
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  return null;
}

/**
 * 确保 Companion 就绪
 * 
 * 连接到 Native Host 并探测 Companion 服务，返回连接信息。
 * 
 * @param port - Native Host 端口号
 * @returns Companion 发现信息
 */
export async function ensureCompanionReady(
  port: number = NATIVE_HOST.DEFAULT_PORT
): Promise<CompanionDiscovery> {
  const agentBaseUrl = 'http://127.0.0.1:8792';
  const recoveredCapabilities = await recoverStaleNativePort(port, agentBaseUrl);
  if (recoveredCapabilities) {
    return buildCompanionDiscoveryFallback(port, agentBaseUrl, recoveredCapabilities);
  }
  // 连接到 Native Host
  await connectNativeHost(port);

  let capabilities = await probeAgentCapabilities(agentBaseUrl);
  if (capabilities) {
    return buildCompanionDiscoveryFallback(port, agentBaseUrl, capabilities);
  }

  
  // 尝试从发现端点获取信息
  const discovery = await probeCompanionDiscovery(port);
  if (discovery) {
    return discovery;
  }

  // 如果发现端点失败，探测 Agent 能力
  capabilities = await probeAgentCapabilities(agentBaseUrl);

  // 返回默认的 Companion 发现信息
  return buildCompanionDiscoveryFallback(port, agentBaseUrl, capabilities);
}

/**
 * 初始化 Native Host 监听器并加载初始状态
 * 
 * 从存储中加载服务器状态，初始化 Native Host 监听器。
 * 该函数应在扩展启动时调用。
 */
export const initNativeHostListener = async () => {
  console.log('[native] Initializing native host listener');

  // 从存储中初始化服务器状态
  try {
    currentServerStatus = await loadServerStatus();
    console.log('[native] Server status loaded:', currentServerStatus);
  } catch (error) {
    console.error(`[native] ${ERROR_MESSAGES.SERVER_STATUS_LOAD_FAILED}:`, error);
  }

  console.log('[native] Native host listener initialized; waiting for first UI/native demand');
};
