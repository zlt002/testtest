// @vitest-environment node

import { describe, expect, it, vi } from 'vitest';
import { createDomAnalysisCdpService } from './dom-analysis-cdp';

describe('createDomAnalysisCdpService', () => {
  it('attaches network listeners and records request evidence within a time window', async () => {
    const attach = vi.fn().mockResolvedValue(undefined);
    const detach = vi.fn().mockResolvedValue(undefined);
    const sendCommand = vi.fn().mockResolvedValue(undefined);
    const eventListeners = new Set<
      Parameters<typeof createDomAnalysisCdpService>[0]['debuggerApi']['onEvent']['addListener']
    >();
    const detachListeners = new Set<
      Parameters<typeof createDomAnalysisCdpService>[0]['debuggerApi']['onDetach']['addListener']
    >();
    const debuggerApi = {
      attach,
      detach,
      sendCommand,
      onEvent: {
        addListener: vi.fn((listener) => {
          eventListeners.add(listener);
        }),
        removeListener: vi.fn((listener) => {
          eventListeners.delete(listener);
        }),
      },
      onDetach: {
        addListener: vi.fn((listener) => {
          detachListeners.add(listener);
        }),
        removeListener: vi.fn((listener) => {
          detachListeners.delete(listener);
        }),
      },
    };

    const service = createDomAnalysisCdpService({
      debuggerApi,
      now: () => 0,
    });

    await service.startCaptureForTab(42);

    expect(attach).toHaveBeenCalledWith({ tabId: 42 }, '1.3');
    expect(sendCommand).toHaveBeenCalledWith({ tabId: 42 }, 'Network.enable');

    for (const listener of eventListeners) {
      listener(
        { tabId: 42 },
        'Network.requestWillBeSent',
        {
          requestId: 'req-1',
          type: 'XHR',
          wallTime: 12.5,
          request: {
            url: 'https://example.com/api/orders?page=1',
            method: 'POST',
          },
          initiator: {
            type: 'script',
          },
        }
      );
      listener(
        { tabId: 42 },
        'Network.responseReceived',
        {
          requestId: 'req-1',
          type: 'XHR',
          response: {
            status: 200,
          },
        }
      );
      listener(
        { tabId: 42 },
        'Network.loadingFinished',
        {
          requestId: 'req-1',
          timestamp: 13.2,
        }
      );
      listener(
        { tabId: 42 },
        'Network.requestWillBeSent',
        {
          requestId: 'req-2',
          type: 'Fetch',
          wallTime: 25,
          request: {
            url: 'https://example.com/api/late',
            method: 'GET',
          },
          initiator: {
            type: 'other',
          },
        }
      );
    }

    expect(
      service.getNetworkEvidenceForTab(42, {
        startTime: 12_000,
        endTime: 20_000,
      })
    ).toEqual([
      expect.objectContaining({
        requestId: 'req-1',
        url: 'https://example.com/api/orders?page=1',
        method: 'POST',
        status: 200,
        resourceType: 'XHR',
        startedAt: 12_500,
        finishedAt: 13_200,
        initiatorHint: 'script',
      }),
    ]);

    await service.stopCaptureForTab(42);

    expect(detach).toHaveBeenCalledWith({ tabId: 42 });
  });

  it('rolls back tab state and listeners when Network.enable fails', async () => {
    const attach = vi.fn().mockResolvedValue(undefined);
    const detach = vi.fn().mockResolvedValue(undefined);
    const sendCommand = vi.fn().mockRejectedValue(new Error('enable failed'));
    const eventListeners = new Set<
      Parameters<typeof createDomAnalysisCdpService>[0]['debuggerApi']['onEvent']['addListener']
    >();
    const detachListeners = new Set<
      Parameters<typeof createDomAnalysisCdpService>[0]['debuggerApi']['onDetach']['addListener']
    >();
    const debuggerApi = {
      attach,
      detach,
      sendCommand,
      onEvent: {
        addListener: vi.fn((listener) => {
          eventListeners.add(listener);
        }),
        removeListener: vi.fn((listener) => {
          eventListeners.delete(listener);
        }),
      },
      onDetach: {
        addListener: vi.fn((listener) => {
          detachListeners.add(listener);
        }),
        removeListener: vi.fn((listener) => {
          detachListeners.delete(listener);
        }),
      },
    };

    const service = createDomAnalysisCdpService({
      debuggerApi,
      now: () => 0,
    });

    await expect(service.startCaptureForTab(7)).rejects.toThrow('enable failed');

    expect(detach).toHaveBeenCalledWith({ tabId: 7 });
    expect(service.getNetworkEvidenceForTab(7, { startTime: 0, endTime: 1 })).toEqual([]);
    expect(debuggerApi.onEvent.removeListener).toHaveBeenCalledTimes(1);
    expect(debuggerApi.onDetach.removeListener).toHaveBeenCalledTimes(1);
    expect(eventListeners.size).toBe(0);
    expect(detachListeners.size).toBe(0);
  });

  it('removes global listeners after external debugger detach leaves no active tabs', async () => {
    const attach = vi.fn().mockResolvedValue(undefined);
    const detach = vi.fn().mockResolvedValue(undefined);
    const sendCommand = vi.fn().mockResolvedValue(undefined);
    const eventListeners = new Set<
      Parameters<typeof createDomAnalysisCdpService>[0]['debuggerApi']['onEvent']['addListener']
    >();
    const detachListeners = new Set<
      Parameters<typeof createDomAnalysisCdpService>[0]['debuggerApi']['onDetach']['addListener']
    >();
    const debuggerApi = {
      attach,
      detach,
      sendCommand,
      onEvent: {
        addListener: vi.fn((listener) => {
          eventListeners.add(listener);
        }),
        removeListener: vi.fn((listener) => {
          eventListeners.delete(listener);
        }),
      },
      onDetach: {
        addListener: vi.fn((listener) => {
          detachListeners.add(listener);
        }),
        removeListener: vi.fn((listener) => {
          detachListeners.delete(listener);
        }),
      },
    };

    const service = createDomAnalysisCdpService({
      debuggerApi,
      now: () => 0,
    });

    await service.startCaptureForTab(9);
    expect(eventListeners.size).toBe(1);
    expect(detachListeners.size).toBe(1);

    for (const listener of detachListeners) {
      listener({ tabId: 9 }, 'target_closed');
    }

    expect(debuggerApi.onEvent.removeListener).toHaveBeenCalledTimes(1);
    expect(debuggerApi.onDetach.removeListener).toHaveBeenCalledTimes(1);
    expect(eventListeners.size).toBe(0);
    expect(detachListeners.size).toBe(0);
    expect(service.getNetworkEvidenceForTab(9, { startTime: 0, endTime: 1 })).toEqual([]);
  });

  it('throws a clear error when debugger api is unavailable', async () => {
    const service = createDomAnalysisCdpService({
      debuggerApi: {} as any,
      now: () => 0,
    });

    await expect(service.startCaptureForTab(1)).rejects.toThrow(
      '当前扩展未启用 chrome.debugger 权限，无法采集 DOM 网络证据'
    );
  });
});
