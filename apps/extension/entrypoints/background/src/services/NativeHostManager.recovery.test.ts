// @vitest-environment node

import { beforeEach, describe, expect, it, vi } from 'vitest';

const connectMock = vi.fn();
const listToolsMock = vi.fn().mockResolvedValue({ tools: [] });
const callToolMock = vi.fn();
const serverConnectMock = vi.fn().mockResolvedValue(undefined);
const clientConnectMock = vi.fn().mockResolvedValue(undefined);
const postMessageMock = vi.fn();
const disconnectMock = vi.fn();
const onMessageAddListenerMock = vi.fn();
const onDisconnectAddListenerMock = vi.fn();
const storageGetMock = vi.fn().mockResolvedValue({});
const storageSetMock = vi.fn().mockResolvedValue(undefined);
const runtimeSendMessageMock = vi.fn().mockResolvedValue(undefined);

vi.mock('@modelcontextprotocol/sdk/server/mcp.js', () => ({
  McpServer: vi.fn().mockImplementation(() => ({
    connect: serverConnectMock,
    tool: vi.fn(),
  })),
}));

vi.mock('@modelcontextprotocol/sdk/client/index.js', () => ({
  Client: vi.fn().mockImplementation(() => ({
    connect: clientConnectMock,
    listTools: listToolsMock,
    callTool: callToolMock,
  })),
}));

vi.mock('./mcpHub', () => ({
  __esModule: true,
  default: vi.fn().mockImplementation(() => ({})),
  getMcpHubInstance: vi.fn(),
}));

vi.mock('./page-code-context', () => ({
  resolveCurrentPageCodebaseContext: vi.fn(),
}));

vi.mock('./read-current-page-content', () => ({
  readCurrentPageContent: vi.fn(),
}));

describe('ensureCompanionReady recovery', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();

    postMessageMock.mockReset();
    disconnectMock.mockReset();
    onMessageAddListenerMock.mockReset();
    onDisconnectAddListenerMock.mockReset();
    storageGetMock.mockReset().mockResolvedValue({});
    storageSetMock.mockReset().mockResolvedValue(undefined);
    runtimeSendMessageMock.mockReset().mockResolvedValue(undefined);
    connectMock.mockReset();
    serverConnectMock.mockReset().mockResolvedValue(undefined);
    clientConnectMock.mockReset().mockResolvedValue(undefined);
    listToolsMock.mockReset().mockResolvedValue({ tools: [] });
    callToolMock.mockReset();

    const portFactory = () => ({
      onMessage: { addListener: onMessageAddListenerMock },
      onDisconnect: { addListener: onDisconnectAddListenerMock },
      postMessage: postMessageMock,
      disconnect: disconnectMock,
    });

    connectMock.mockImplementation(() => portFactory());

    vi.stubGlobal('fetch', vi.fn());
    vi.stubGlobal('chrome', {
      runtime: {
        connectNative: connectMock,
        sendMessage: runtimeSendMessageMock,
        lastError: undefined,
      },
      storage: {
        local: {
          get: storageGetMock,
          set: storageSetMock,
        },
      },
    });
  });

  it('reconnects when the native port exists but companion health probe fails', async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce({ ok: false } as Response)
      .mockResolvedValueOnce({ ok: true, json: async () => ({ ok: true }) } as Response);

    const nativeHostModule = await import('./NativeHostManager');

    await nativeHostModule.connectNativeHost();
    const discovery = await nativeHostModule.ensureCompanionReady();

    expect(disconnectMock).toHaveBeenCalledTimes(1);
    expect(connectMock).toHaveBeenCalledTimes(2);
    expect(postMessageMock).toHaveBeenCalledTimes(2);
    expect(discovery.capabilities).toEqual({ ok: true });
  });
});
