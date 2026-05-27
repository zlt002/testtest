// @vitest-environment node

import { beforeEach, describe, expect, it, vi } from 'vitest';

import { matchesWebsiteToolDomain } from './NativeHostManager';

vi.mock('./mcpHub', () => ({
  getMcpHubInstance: vi.fn(),
}));

vi.mock('./page-code-context', () => ({
  resolveCurrentPageCodebaseContext: vi.fn(),
}));

const getMcpHubInstanceMock = vi.fn();
const resolveCurrentPageCodebaseContextMock = vi.fn();

beforeEach(async () => {
  getMcpHubInstanceMock.mockReset();
  resolveCurrentPageCodebaseContextMock.mockReset();

  const mcpHubModule = await import('./mcpHub');
  vi.mocked(mcpHubModule.getMcpHubInstance).mockImplementation(getMcpHubInstanceMock);

  const pageCodeContextModule = await import('./page-code-context');
  vi.mocked(pageCodeContextModule.resolveCurrentPageCodebaseContext).mockImplementation(
    resolveCurrentPageCodebaseContextMock
  );
});

describe('matchesWebsiteToolDomain', () => {
  it('允许通过 outer doc host 匹配 webedit iframe 工具', () => {
    const tool = {
      name: 'website_tool_webedit_midea_com_tab1045_webedit_get_context',
      description: '[WebEdit iframe:webedit.midea.com via doc.midea.com Tab] 读取当前上下文',
    };

    expect(matchesWebsiteToolDomain(tool, 'doc.midea.com')).toBe(true);
  });

  it('允许直接通过 webedit host 关键字匹配工具', () => {
    const tool = {
      name: 'website_tool_webedit_midea_com_tab1045_webedit_get_context',
      description: '[WebEdit iframe:webedit.midea.com via doc.midea.com Tab] 读取当前上下文',
    };

    expect(matchesWebsiteToolDomain(tool, 'webedit')).toBe(true);
    expect(matchesWebsiteToolDomain(tool, 'webedit.midea.com')).toBe(true);
  });

  it('允许匹配 runtime 里的原始 webedit 工具名', () => {
    const tool = {
      name: 'webedit_read_document_text',
      description: '[WebEdit iframe:webedit.midea.com via doc.midea.com • Tab 1045824940] 读取正文文本',
    };

    expect(matchesWebsiteToolDomain(tool, 'doc.midea.com')).toBe(true);
    expect(matchesWebsiteToolDomain(tool, 'webedit')).toBe(true);
  });

  it('不会把无关网站工具误判成当前域名工具', () => {
    const tool = {
      name: 'website_tool_example_com_tab9_search_products',
      description: '[example.com Tab] 搜索商品',
    };

    expect(matchesWebsiteToolDomain(tool, 'doc.midea.com')).toBe(false);
  });
});

describe('website tool introspection helpers', () => {
  it('list_website_tools 在传入 tabId 时只返回锁定 tab 的 runtime 工具', async () => {
    getMcpHubInstanceMock.mockReturnValue({
      listWebsiteRuntimeTools: vi.fn().mockReturnValue([
        {
          domain: 'doc.midea.com',
          dataId: 'tab-11',
          url: 'https://doc.midea.com/a',
          tabId: 11,
          isClosed: false,
          tool: {
            name: 'webedit_get_selection',
            description: '读取选区',
            inputSchema: { type: 'object', properties: {} },
          },
        },
        {
          domain: 'doc.midea.com',
          dataId: 'tab-22',
          url: 'https://doc.midea.com/b',
          tabId: 22,
          isClosed: false,
          tool: {
            name: 'webedit_get_selection',
            description: '读取别的 tab 选区',
            inputSchema: { type: 'object', properties: {} },
          },
        },
      ]),
    });

    const nativeHostManagerModule = (await import('./NativeHostManager')) as any;
    const handlers = new Map<string, (args: any) => Promise<any>>();
    const server = {
      tool: vi.fn(
        (
          name: string,
          _description: string,
          _schema: Record<string, unknown>,
          handler: (args: any) => Promise<any>
        ) => {
          handlers.set(name, handler);
        }
      ),
    };
    const client = {
      listTools: vi.fn().mockResolvedValue({ tools: [] }),
      callTool: vi.fn(),
    };

    nativeHostManagerModule.setupIntrospectionTools(server, client);
    const listWebsiteTools = handlers.get('list_website_tools');

    expect(listWebsiteTools).toBeTypeOf('function');

    const result = await listWebsiteTools?.({ domain: 'webedit', tabId: 11 });
    const payload = JSON.parse(result.content[0].text);

    expect(payload.toolCount).toBe(1);
    expect(payload.tools).toHaveLength(1);
    expect(payload.tools[0]?.tabId).toBe(11);
  });

  it('call_website_tool 执行原始 webedit 工具时会透传 lockedTabId', async () => {
    const executeWebsiteToolOnActiveTab = vi.fn().mockResolvedValue({
      content: [{ type: 'text', text: '{"ok":true}' }],
      isError: false,
    });
    getMcpHubInstanceMock.mockReturnValue({
      executeWebsiteToolOnActiveTab,
    });

    const nativeHostManagerModule = (await import('./NativeHostManager')) as any;
    const handlers = new Map<string, (args: any) => Promise<any>>();
    const server = {
      tool: vi.fn(
        (
          name: string,
          _description: string,
          _schema: Record<string, unknown>,
          handler: (args: any) => Promise<any>
        ) => {
          handlers.set(name, handler);
        }
      ),
    };
    const client = {
      listTools: vi.fn().mockResolvedValue({ tools: [] }),
      callTool: vi.fn(),
    };

    nativeHostManagerModule.setupIntrospectionTools(server, client);
    const callWebsiteTool = handlers.get('call_website_tool');

    expect(callWebsiteTool).toBeTypeOf('function');

    await callWebsiteTool?.({
      toolName: 'webedit_get_selection',
      arguments: {},
      lockedTabId: 77,
    });

    expect(executeWebsiteToolOnActiveTab).toHaveBeenCalledWith('webedit_get_selection', {}, 77);
  });
});

describe('page code context tool', () => {
  it('注册 resolve_current_page_codebase_context 工具', async () => {
    const nativeHostManagerModule = (await import('./NativeHostManager')) as any;
    const handlers = new Map<string, (args: any) => Promise<any>>();
    const server = {
      tool: vi.fn(
        (
          name: string,
          _description: string,
          _schema: Record<string, unknown>,
          handler: (args: any) => Promise<any>
        ) => {
          handlers.set(name, handler);
        }
      ),
    };
    const client = {
      listTools: vi.fn().mockResolvedValue({ tools: [] }),
      callTool: vi.fn(),
    };

    nativeHostManagerModule.setupIntrospectionTools(server, client);

    expect(handlers.has('resolve_current_page_codebase_context')).toBe(true);
  });

  it('handler 会透传浏览器上下文参数', async () => {
    resolveCurrentPageCodebaseContextMock.mockResolvedValue({
      context: {
        title: 'Order Center',
        url: 'https://example.com/orders',
        pageTextSummary: [],
        apiCandidates: [],
        resourceHints: [],
        frameHints: { includeFrames: true, frameCount: 2 },
      },
      resolution: null,
    });

    const nativeHostManagerModule = (await import('./NativeHostManager')) as any;
    const handlers = new Map<string, (args: any) => Promise<any>>();
    const server = {
      tool: vi.fn(
        (
          name: string,
          _description: string,
          _schema: Record<string, unknown>,
          handler: (args: any) => Promise<any>
        ) => {
          handlers.set(name, handler);
        }
      ),
    };
    const client = {
      listTools: vi.fn().mockResolvedValue({ tools: [] }),
      callTool: vi.fn(),
    };

    nativeHostManagerModule.setupIntrospectionTools(server, client);
    const handler = handlers.get('resolve_current_page_codebase_context');

    expect(handler).toBeTypeOf('function');

    const result = await handler?.({
      tabId: 77,
      windowId: 9,
      maxChars: 4321,
      includeFrames: true,
    });

    expect(resolveCurrentPageCodebaseContextMock).toHaveBeenCalledWith({
      tabId: 77,
      windowId: 9,
      maxChars: 4321,
      includeFrames: true,
      ensureCompanionReady: expect.any(Function),
    });
    expect(JSON.parse(result.content[0].text)).toEqual({
      context: {
        title: 'Order Center',
        url: 'https://example.com/orders',
        pageTextSummary: [],
        apiCandidates: [],
        resourceHints: [],
        frameHints: { includeFrames: true, frameCount: 2 },
      },
      resolution: null,
    });
  });

  it('handler 在 resolveCurrentPageCodebaseContext 抛错时返回 createErrorResponse 风格结果', async () => {
    resolveCurrentPageCodebaseContextMock.mockRejectedValue(
      new Error('page-code-analysis route unavailable at /page-code-analysis/resolve: 404 Not Found')
    );

    const nativeHostManagerModule = (await import('./NativeHostManager')) as any;
    const handlers = new Map<string, (args: any) => Promise<any>>();
    const server = {
      tool: vi.fn(
        (
          name: string,
          _description: string,
          _schema: Record<string, unknown>,
          handler: (args: any) => Promise<any>
        ) => {
          handlers.set(name, handler);
        }
      ),
    };
    const client = {
      listTools: vi.fn().mockResolvedValue({ tools: [] }),
      callTool: vi.fn(),
    };

    nativeHostManagerModule.setupIntrospectionTools(server, client);
    const handler = handlers.get('resolve_current_page_codebase_context');

    const result = await handler?.({
      tabId: 15,
      includeFrames: false,
    });

    expect(result).toEqual({
      content: [
        {
          type: 'text',
          text: 'page-code-analysis route unavailable at /page-code-analysis/resolve: 404 Not Found',
        },
      ],
      isError: true,
    });
  });
});
