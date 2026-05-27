// @vitest-environment node

import { beforeEach, describe, expect, it, vi } from 'vitest';

const initWebMCPInjector = vi.fn();
const initNativeHostListener = vi.fn();
const initCompanionStatusBadge = vi.fn();
const initSidepanelHandlers = vi.fn();
const initPageEditListeners = vi.fn();
const initWindowTakeoverListeners = vi.fn();
const initUiClientPortListener = vi.fn();
const initExternalExtensionPortListener = vi.fn();
const createChromeHandler = vi.fn();
const connectNativeHost = vi.fn();
const ensureCompanionReady = vi.fn();
const fetchMock = vi.fn();
const defineBackground = vi.fn((config) => config);
const addCommandListener = vi.fn();
const addActionClickListener = vi.fn();
const addMessageListener = vi.fn();
const createPageEditCommandListener = vi.fn(() => vi.fn());
const pageEditService = {
  toggleForActiveTab: vi.fn(),
};

vi.mock('@modelcontextprotocol/sdk/server/mcp.js', () => ({
  McpServer: vi.fn().mockImplementation(() => ({})),
}));

vi.mock('./src/services/WebMCPInjector', () => ({
  initWebMCPInjector,
}));

vi.mock('./src/services/NativeHostManager', () => ({
  connectNativeHost,
  ensureCompanionReady,
  initNativeHostListener,
}));

vi.mock('./src/services/CompanionStatusBadge', () => ({
  initCompanionStatusBadge,
}));

vi.mock('./src/services/page-capture-stylesheet-fetch-bootstrap', () => ({}));

vi.mock('./src/services/page-edit', () => ({
  createPageEditCommandListener,
  initPageEditListeners,
  pageEditService,
}));

vi.mock('./src/services/ports/ExternalExtensionPortManager', () => ({
  initExternalExtensionPortListener,
}));

vi.mock('./src/services/ports/UiClientPortManager', () => ({
  initUiClientPortListener,
}));

vi.mock('./src/services/sidepanel', () => ({
  initSidepanelHandlers,
}));

vi.mock('./src/services/window-takeover', () => ({
  initWindowTakeoverListeners,
}));

vi.mock('./src/services/mcpHub', () => ({
  default: vi.fn().mockImplementation(() => ({})),
}));

vi.mock('./trpc-browser/adapter', () => ({
  createChromeHandler,
}));

vi.mock('./src/routers', () => ({
  BGSWRouter: { mocked: true },
}));

describe('background main', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    initWebMCPInjector.mockReset();
    ensureCompanionReady.mockReset();
    pageEditService.toggleForActiveTab.mockReset();
    defineBackground.mockClear();
    fetchMock.mockReset();
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      json: vi.fn().mockResolvedValue({ ok: true, status: 'completed' }),
    });

    vi.stubGlobal('chrome', {
      userScripts: {
        getScripts: vi.fn(() => {
          throw new Error('userScripts unavailable');
        }),
        configureWorld: vi.fn(),
      },
      runtime: {
        onMessage: { addListener: addMessageListener },
      },
      commands: {
        onCommand: { addListener: addCommandListener },
      },
      action: {
        onClicked: { addListener: addActionClickListener },
      },
    });
    vi.stubGlobal('defineBackground', defineBackground);
    vi.stubGlobal('fetch', fetchMock);
  });

  it('registers the BGSW chrome handler even when userScripts is unavailable', async () => {
    const module = await import('./index');

    expect(module.default).toBeTruthy();
    module.default.main();

    expect(createChromeHandler).toHaveBeenCalledTimes(1);
  });

  it('propagates later startup errors after import-time bootstrap has completed', async () => {
    initWebMCPInjector.mockImplementation(() => {
      throw new Error('startup failed');
    });

    const module = await import('./index');

    expect(module.default).toBeTruthy();
    expect(() => module.default.main()).toThrow('startup failed');
  });

  it('ensures companion readiness when the action icon is clicked', async () => {
    ensureCompanionReady.mockResolvedValue(undefined);

    const module = await import('./index');
    module.default.main();

    const clickHandler = addActionClickListener.mock.calls[0]?.[0];
    expect(clickHandler).toBeTypeOf('function');

    await clickHandler?.();

    expect(fetchMock).not.toHaveBeenCalled();
    expect(ensureCompanionReady).toHaveBeenCalledTimes(1);
    expect(pageEditService.toggleForActiveTab).toHaveBeenCalledTimes(1);
    expect(ensureCompanionReady.mock.invocationCallOrder[0]).toBeLessThan(
      pageEditService.toggleForActiveTab.mock.invocationCallOrder[0]
    );
  });

  it('does not trigger accr sync when the action icon is clicked', async () => {
    ensureCompanionReady.mockResolvedValue(undefined);

    const module = await import('./index');
    module.default.main();

    const clickHandler = addActionClickListener.mock.calls[0]?.[0];
    expect(clickHandler).toBeTypeOf('function');

    await clickHandler?.();

    expect(fetchMock).not.toHaveBeenCalled();
    expect(ensureCompanionReady).toHaveBeenCalledTimes(1);
    expect(pageEditService.toggleForActiveTab).toHaveBeenCalledTimes(1);
  });

  it('keeps page edit click flow without waiting for accr sync', async () => {
    ensureCompanionReady.mockResolvedValue(undefined);

    const module = await import('./index');
    module.default.main();

    const clickHandler = addActionClickListener.mock.calls[0]?.[0];
    expect(clickHandler).toBeTypeOf('function');

    await clickHandler?.();

    expect(fetchMock).not.toHaveBeenCalled();
    expect(ensureCompanionReady).toHaveBeenCalledTimes(1);
    expect(pageEditService.toggleForActiveTab).toHaveBeenCalledTimes(1);
  });

  it('warns and keeps page edit click flow when companion readiness fails', async () => {
    ensureCompanionReady.mockRejectedValue(new Error('companion offline'));
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const module = await import('./index');
    module.default.main();

    const clickHandler = addActionClickListener.mock.calls[0]?.[0];
    expect(clickHandler).toBeTypeOf('function');

    await clickHandler?.();

    expect(fetchMock).not.toHaveBeenCalled();
    expect(ensureCompanionReady).toHaveBeenCalledTimes(1);
    expect(pageEditService.toggleForActiveTab).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledWith(
      '[native] Failed to ensure companion readiness on action click:',
      expect.objectContaining({
        message: 'companion offline',
      })
    );

    warn.mockRestore();
  });
});
