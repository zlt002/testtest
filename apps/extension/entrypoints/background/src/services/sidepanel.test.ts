// @vitest-environment node

import { beforeEach, describe, expect, it, vi } from 'vitest';

describe('initSidepanelHandlers', () => {
  const addListener = vi.fn();
  const getCurrentWindow = vi.fn();
  const openSidePanel = vi.fn(async () => undefined);
  const setPanelBehavior = vi.fn(() => Promise.resolve());
  const storageGet = vi.fn(async () => ({}));
  const storageRemove = vi.fn(async () => undefined);

  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();

    vi.stubGlobal('chrome', {
      runtime: {
        onMessage: {
          addListener,
        },
      },
      windows: {
        getCurrent: getCurrentWindow,
      },
      sidePanel: {
        open: openSidePanel,
        setPanelBehavior,
      },
      storage: {
        local: {
          get: storageGet,
          remove: storageRemove,
        },
      },
    });
  });

  it('reopens the pending side panel after extension reload', async () => {
    storageGet.mockResolvedValueOnce({
      'webmcp:pending-sidepanel-reopen': {
        windowId: 23,
        requestedAt: Date.now(),
      },
    });

    const { initSidepanelHandlers } = await import('./sidepanel');
    initSidepanelHandlers();
    await Promise.resolve();
    await Promise.resolve();

    expect(storageGet).toHaveBeenCalledWith('webmcp:pending-sidepanel-reopen');
    expect(storageRemove).toHaveBeenCalledWith('webmcp:pending-sidepanel-reopen');
    expect(openSidePanel).toHaveBeenCalledWith({ windowId: 23 });
  });
});
