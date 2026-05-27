// @vitest-environment node

import { beforeEach, describe, expect, it, vi } from 'vitest';

import { BGSWRouter } from '../routers';
import {
  createWindowTakeoverService,
  resetWindowTakeoverServiceForTests,
} from './window-takeover';

describe('createWindowTakeoverService', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  function createService(overrides: Parameters<typeof createWindowTakeoverService>[0] = {}) {
    return createWindowTakeoverService({
      sendTabMessage: async () => undefined,
      ...overrides,
    });
  }

  it('starts takeover state and exposes it through getState', async () => {
    const notifications: unknown[] = [];
    const service = createService({
      now: () => 1_000,
      sendRuntimeMessage: async (message) => {
        notifications.push(message);
      },
    });

    const state = await service.start({
      sessionId: 'session-1',
      runId: 'run-1',
      windowId: 7,
      lockedTabId: 101,
      lockedUrl: 'https://webedit.midea.com/moewebv7/document-cloud?editId=1',
    });

    expect(state).toMatchObject({
      sessionId: 'session-1',
      runId: 'run-1',
      windowId: 7,
      lockedTabId: 101,
      status: 'active',
      startedAt: 1_000,
    });
    expect(service.getState()).toMatchObject({
      sessionId: 'session-1',
      runId: 'run-1',
      status: 'active',
    });
    expect(notifications).toContainEqual(
      expect.objectContaining({
        type: 'agent_v2_window_takeover_state_changed',
        payload: expect.objectContaining({
          runId: 'run-1',
          status: 'active',
        }),
      })
    );
  });

  it('requests confirmation when user activates another tab in the locked window', async () => {
    const notifications: unknown[] = [];
    const service = createService({
      now: () => 1_000,
      sendRuntimeMessage: async (message) => {
        notifications.push(message);
      },
    });

    await service.start({
      sessionId: 'session-1',
      runId: 'run-1',
      windowId: 7,
      lockedTabId: 101,
      lockedUrl: 'https://webedit.midea.com/moewebv7/document-cloud?editId=1',
    });

    const result = await service.handleTabActivated({ tabId: 202, windowId: 7 });

    expect(result).toEqual({ kind: 'confirmation_required' });
    expect(notifications).toContainEqual(
      expect.objectContaining({
        type: 'agent_v2_window_takeover_confirmation_required',
        payload: expect.objectContaining({
          runId: 'run-1',
          sessionId: 'session-1',
          attemptedTabId: 202,
        }),
      })
    );
  });

  it('does not emit duplicate confirmation messages while one leave request is already pending', async () => {
    const notifications: unknown[] = [];
    const service = createService({
      now: () => 1_000,
      sendRuntimeMessage: async (message) => {
        notifications.push(message);
      },
    });

    await service.start({
      sessionId: 'session-1',
      runId: 'run-1',
      windowId: 7,
      lockedTabId: 101,
      lockedUrl: 'https://webedit.midea.com/moewebv7/document-cloud?editId=1',
    });

    await expect(service.handleTabActivated({ tabId: 202, windowId: 7 })).resolves.toEqual({
      kind: 'confirmation_required',
    });
    await expect(service.handleTabActivated({ tabId: 202, windowId: 7 })).resolves.toEqual({
      kind: 'confirmation_required',
    });

    expect(
      notifications.filter(
        (message) =>
          typeof message === 'object' &&
          message !== null &&
          (message as { type?: string }).type === 'agent_v2_window_takeover_confirmation_required'
      )
    ).toHaveLength(1);
  });

  it('consumes allowed navigation and skips confirmation for AI tab switch', async () => {
    const notifications: unknown[] = [];
    const service = createService({
      now: () => 1_000,
      sendRuntimeMessage: async (message) => {
        notifications.push(message);
      },
    });

    await service.start({
      sessionId: 'session-1',
      runId: 'run-1',
      windowId: 7,
      lockedTabId: 101,
      lockedUrl: 'https://webedit.midea.com/moewebv7/document-cloud?editId=1',
    });

    service.allowNavigation({
      windowId: 7,
      fromTabId: 101,
      toTabId: 202,
      reason: 'ai-tab-switch',
      expiresAt: 1_500,
    });

    const result = await service.handleTabActivated({ tabId: 202, windowId: 7 });

    expect(result).toEqual({ kind: 'allowed' });
    expect(notifications).not.toContainEqual(
      expect.objectContaining({
        type: 'agent_v2_window_takeover_confirmation_required',
      })
    );
  });

  it('allows the follow-up tab URL update after an AI tab switch', async () => {
    const notifications: unknown[] = [];
    const service = createService({
      now: () => 1_000,
      sendRuntimeMessage: async (message) => {
        notifications.push(message);
      },
    });

    await service.start({
      sessionId: 'session-1',
      runId: 'run-1',
      windowId: 7,
      lockedTabId: 101,
      lockedUrl: 'https://webedit.midea.com/moewebv7/document-cloud?editId=1',
    });

    service.allowNavigation({
      windowId: 7,
      fromTabId: 101,
      toTabId: 202,
      reason: 'ai-tab-switch',
      expiresAt: 1_500,
    });

    await expect(service.handleTabActivated({ tabId: 202, windowId: 7 })).resolves.toEqual({
      kind: 'allowed',
    });

    await expect(
      service.handleTabUpdated({
        tabId: 202,
        windowId: 7,
        url: 'extension://example/sidepanel.html?route=/file-preview',
      })
    ).resolves.toEqual({ kind: 'allowed' });

    expect(notifications).not.toContainEqual(
      expect.objectContaining({
        type: 'agent_v2_window_takeover_confirmation_required',
      })
    );
  });

  it('marks the session interrupted after confirming leave', async () => {
    const notifications: unknown[] = [];
    const service = createService({
      now: () => 1_000,
      sendRuntimeMessage: async (message) => {
        notifications.push(message);
      },
    });

    await service.start({
      sessionId: 'session-1',
      runId: 'run-1',
      windowId: 7,
      lockedTabId: 101,
      lockedUrl: 'https://webedit.midea.com/moewebv7/document-cloud?editId=1',
    });
    await service.handleTabActivated({ tabId: 202, windowId: 7 });

    const result = await service.resolveLeaveDecision({
      decision: 'leave',
      attemptedTabId: 202,
    });

    expect(result).toEqual({ kind: 'stopped', status: 'interrupted' });
    expect(service.getState()).toMatchObject({
      status: 'interrupted',
    });
    expect(notifications).toContainEqual(
      expect.objectContaining({
        type: 'agent_v2_window_takeover_state_changed',
        payload: expect.objectContaining({
          status: 'interrupted',
        }),
      })
    );
  });

  it('restores the locked tab when the user chooses stay', async () => {
    const activateTab = vi.fn().mockResolvedValue(undefined);
    const service = createService({
      now: () => 1_000,
      activateTab,
      sendRuntimeMessage: async () => undefined,
    });

    await service.start({
      sessionId: 'session-1',
      runId: 'run-1',
      windowId: 7,
      lockedTabId: 101,
      lockedUrl: 'https://webedit.midea.com/moewebv7/document-cloud?editId=1',
    });
    await service.handleTabActivated({ tabId: 202, windowId: 7 });

    const result = await service.resolveLeaveDecision({
      decision: 'stay',
      attemptedTabId: 202,
    });

    expect(result).toEqual({ kind: 'resumed', status: 'active' });
    expect(activateTab).toHaveBeenCalledWith(101);
  });

  it('does not emit a second confirmation while restoring the locked tab after stay', async () => {
    const notifications: unknown[] = [];
    let service: ReturnType<typeof createService>;

    const activateTab = vi.fn(async () => {
      await service.handleTabActivated({ tabId: 202, windowId: 7 });
    });

    service = createService({
      now: () => 1_000,
      activateTab,
      sendRuntimeMessage: async (message) => {
        notifications.push(message);
      },
    });

    await service.start({
      sessionId: 'session-1',
      runId: 'run-1',
      windowId: 7,
      lockedTabId: 101,
      lockedUrl: 'https://webedit.midea.com/moewebv7/document-cloud?editId=1',
    });
    await service.handleTabActivated({ tabId: 202, windowId: 7 });

    await expect(
      service.resolveLeaveDecision({
        decision: 'stay',
        attemptedTabId: 202,
      })
    ).resolves.toEqual({ kind: 'resumed', status: 'active' });

    expect(
      notifications.filter(
        (message) =>
          typeof message === 'object' &&
          message !== null &&
          (message as { type?: string }).type === 'agent_v2_window_takeover_confirmation_required'
      )
    ).toHaveLength(1);
  });

  it('requests confirmation again when the user leaves after stay restoration completes', async () => {
    const notifications: unknown[] = [];
    const service = createService({
      now: () => 1_000,
      activateTab: async () => undefined,
      sendRuntimeMessage: async (message) => {
        notifications.push(message);
      },
    });

    await service.start({
      sessionId: 'session-1',
      runId: 'run-1',
      windowId: 7,
      lockedTabId: 101,
      lockedUrl: 'https://webedit.midea.com/moewebv7/document-cloud?editId=1',
    });
    await service.handleTabActivated({ tabId: 202, windowId: 7 });
    await service.resolveLeaveDecision({
      decision: 'stay',
      attemptedTabId: 202,
    });
    await service.handleTabActivated({ tabId: 101, windowId: 7 });
    await service.handleTabActivated({ tabId: 202, windowId: 7 });

    const confirmationMessages = notifications.filter(
      (message) =>
        typeof message === 'object' &&
        message !== null &&
        (message as { type?: string }).type === 'agent_v2_window_takeover_confirmation_required'
    );
    expect(confirmationMessages).toHaveLength(2);
    expect(
      confirmationMessages.map(
        (message) => (message as { payload: { requestId: number } }).payload.requestId
      )
    ).toEqual([1, 2]);
  });

  it('ignores a stale leave decision request id after a new confirmation is created', async () => {
    const service = createService({
      now: () => 1_000,
      activateTab: async () => undefined,
      sendRuntimeMessage: async () => undefined,
    });

    await service.start({
      sessionId: 'session-1',
      runId: 'run-1',
      windowId: 7,
      lockedTabId: 101,
      lockedUrl: 'https://webedit.midea.com/moewebv7/document-cloud?editId=1',
    });
    await service.handleTabActivated({ tabId: 202, windowId: 7 });
    await service.resolveLeaveDecision({
      decision: 'stay',
      attemptedTabId: 202,
      requestId: 1,
    });
    await service.handleTabActivated({ tabId: 101, windowId: 7 });
    await service.handleTabActivated({ tabId: 202, windowId: 7 });

    await expect(
      service.resolveLeaveDecision({
        decision: 'stay',
        attemptedTabId: 202,
        requestId: 1,
      })
    ).resolves.toEqual({ kind: 'ignored' });
    await expect(
      service.resolveLeaveDecision({
        decision: 'stay',
        attemptedTabId: 202,
        requestId: 2,
      })
    ).resolves.toEqual({ kind: 'resumed', status: 'active' });
  });

  it('requests confirmation when the locked tab navigates away', async () => {
    const notifications: unknown[] = [];
    const service = createService({
      now: () => 1_000,
      sendRuntimeMessage: async (message) => {
        notifications.push(message);
      },
    });

    await service.start({
      sessionId: 'session-1',
      runId: 'run-1',
      windowId: 7,
      lockedTabId: 101,
      lockedUrl: 'https://webedit.midea.com/moewebv7/document-cloud?editId=1',
    });

    const result = await service.handleTabUpdated({
      tabId: 101,
      windowId: 7,
      url: 'https://example.com/other',
    });

    expect(result).toEqual({ kind: 'confirmation_required' });
    expect(notifications).toContainEqual(
      expect.objectContaining({
        type: 'agent_v2_window_takeover_confirmation_required',
        payload: expect.objectContaining({
          reason: 'tab_navigated',
        }),
      })
    );
  });

  it('defers trusted page-link navigation until the user confirms leaving', async () => {
    const notifications: unknown[] = [];
    const navigateTab = vi.fn().mockResolvedValue(undefined);
    const sendTabMessage = vi.fn().mockResolvedValue(undefined);
    const service = createService({
      now: () => 1_000,
      navigateTab,
      sendTabMessage,
      sendRuntimeMessage: async (message) => {
        notifications.push(message);
      },
    });

    await service.start({
      sessionId: 'session-1',
      runId: 'run-1',
      windowId: 7,
      lockedTabId: 101,
      lockedUrl: 'https://webedit.midea.com/moewebv7/document-cloud?editId=1',
    });

    const result = await service.handleNavigationAttempt({
      tabId: 101,
      windowId: 7,
      url: 'https://doc.midea.com/next-page',
    });

    expect(result).toEqual({ kind: 'confirmation_required' });
    expect(navigateTab).not.toHaveBeenCalled();
    await service.resolveLeaveDecision({
      decision: 'leave',
      attemptedTabId: 101,
    });

    expect(navigateTab).toHaveBeenCalledWith(101, 'https://doc.midea.com/next-page');
    expect(sendTabMessage).toHaveBeenCalledWith(
      101,
      expect.objectContaining({
        type: 'agent_v2_window_takeover_content_state',
      })
    );
  });

  it('does not emit duplicate confirmation messages for repeated page navigation attempts', async () => {
    const notifications: unknown[] = [];
    const service = createService({
      now: () => 1_000,
      sendRuntimeMessage: async (message) => {
        notifications.push(message);
      },
    });

    await service.start({
      sessionId: 'session-1',
      runId: 'run-1',
      windowId: 7,
      lockedTabId: 101,
      lockedUrl: 'https://webedit.midea.com/moewebv7/document-cloud?editId=1',
    });

    await expect(
      service.handleNavigationAttempt({
        tabId: 101,
        windowId: 7,
        url: 'https://doc.midea.com/next-page',
      })
    ).resolves.toEqual({ kind: 'confirmation_required' });
    await expect(
      service.handleNavigationAttempt({
        tabId: 101,
        windowId: 7,
        url: 'https://doc.midea.com/next-page',
      })
    ).resolves.toEqual({ kind: 'confirmation_required' });

    expect(
      notifications.filter(
        (message) =>
          typeof message === 'object' &&
          message !== null &&
          (message as { type?: string }).type === 'agent_v2_window_takeover_confirmation_required'
      )
    ).toHaveLength(1);
  });

  it('requests confirmation when polling detects a manual tab switch', async () => {
    let guardTick: (() => void) | null = null;
    const notifications: unknown[] = [];
    const queryActiveTabInWindow = vi
      .fn()
      .mockResolvedValueOnce({ id: 202, windowId: 7, url: 'https://example.com/other' });

    const service = createService({
      now: () => 1_000,
      queryActiveTabInWindow,
      setGuardInterval: (callback) => {
        guardTick = callback;
        return 1;
      },
      clearGuardInterval: () => {
        guardTick = null;
      },
      sendRuntimeMessage: async (message) => {
        notifications.push(message);
      },
    });

    await service.start({
      sessionId: 'session-1',
      runId: 'run-1',
      windowId: 7,
      lockedTabId: 101,
      lockedUrl: 'https://webedit.midea.com/moewebv7/document-cloud?editId=1',
    });

    expect(guardTick).not.toBeNull();
    await guardTick?.();
    await Promise.resolve();

    expect(notifications[1]).toMatchObject({
      type: 'agent_v2_window_takeover_confirmation_required',
      payload: expect.objectContaining({
        attemptedTabId: 202,
        reason: 'tab_activated',
      }),
    });
  });
});

describe('windowTakeoverRouter', () => {
  beforeEach(() => {
    resetWindowTakeoverServiceForTests();
    const runtime = {
      lastError: undefined as { message: string } | undefined,
      sendMessage: vi.fn((_message: unknown, callback?: () => void) => {
        runtime.lastError = undefined;
        callback?.();
      }),
    };
    vi.stubGlobal('chrome', {
      runtime,
    });
  });

  it('exposes takeover procedures through the background router chain', async () => {
    const caller = BGSWRouter.createCaller({});

    const state = await caller.windowTakeover.start({
      sessionId: 'session-router',
      runId: 'run-router',
      windowId: 9,
      lockedTabId: 501,
      lockedUrl: 'https://webedit.midea.com/moewebv7/document-cloud?editId=9',
    });

    expect(state).toMatchObject({
      sessionId: 'session-router',
      runId: 'run-router',
      status: 'active',
    });

    await caller.windowTakeover.allowNavigation({
      windowId: 9,
      fromTabId: 501,
      toTabId: 502,
      reason: 'ai-tab-switch',
      expiresAt: Date.now() + 1_000,
    });

    expect(await caller.windowTakeover.getState()).toMatchObject({
      lockedTabId: 501,
      status: 'active',
    });
  });

  it('does not block takeover start when runtime messaging closes without a response', async () => {
    resetWindowTakeoverServiceForTests();
    const runtime = {
      lastError: undefined as { message: string } | undefined,
      sendMessage: vi.fn((_message: unknown, callback?: () => void) => {
        runtime.lastError = {
          message: 'The message port closed before a response was received.',
        };
        callback?.();
        runtime.lastError = undefined;
      }),
    };
    vi.stubGlobal('chrome', { runtime });

    const caller = BGSWRouter.createCaller({});

    await expect(
      caller.windowTakeover.start({
        sessionId: 'session-port-closed',
        runId: 'run-port-closed',
        windowId: 10,
        lockedTabId: 601,
        lockedUrl: 'https://webedit.midea.com/moewebv7/document-cloud?editId=10',
      })
    ).resolves.toMatchObject({
      sessionId: 'session-port-closed',
      runId: 'run-port-closed',
      status: 'active',
    });
  });
});
