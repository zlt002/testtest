export type WindowTakeoverStatus = 'active' | 'interrupting' | 'interrupted' | 'released';
const AGENT_V2_WINDOW_TAKEOVER_REQUEST = 'agent_v2_window_takeover_request';
const AGENT_V2_WINDOW_TAKEOVER_NAVIGATION_ATTEMPT = 'agent_v2_window_takeover_navigation_attempt';
const AGENT_V2_WINDOW_TAKEOVER_CONTENT_STATE = 'agent_v2_window_takeover_content_state';
const STAY_RESTORE_SUPPRESSION_MS = 5_000;

export type WindowTakeoverState = {
  sessionId: string;
  runId: string;
  windowId: number;
  lockedTabId: number;
  lockedUrl?: string;
  status: WindowTakeoverStatus;
  startedAt: number;
};

export type AllowedNavigation = {
  windowId: number;
  fromTabId?: number;
  toTabId?: number;
  reason: 'ai-tab-switch' | 'ai-navigation' | 'ai-refresh' | 'ai-close';
  expiresAt: number;
};

type LeaveReason = 'tab_activated' | 'tab_navigated' | 'tab_removed';

type PendingLeaveRequest = {
  requestId: number;
  attemptedTabId: number;
  reason: LeaveReason;
  intendedUrl?: string;
};

type StaySuppression = {
  attemptedTabId: number;
  windowId: number;
  expiresAt: number;
};

type WindowTakeoverMessage =
  | {
      type: 'agent_v2_window_takeover_state_changed';
      payload: WindowTakeoverState;
    }
  | {
      type: 'agent_v2_window_takeover_confirmation_required';
      payload: {
        sessionId: string;
        runId: string;
        windowId: number;
        lockedTabId: number;
        requestId: number;
        attemptedTabId: number;
        reason: LeaveReason;
      };
    };

type WindowTakeoverDeps = {
  now?: () => number;
  sendRuntimeMessage?: (message: WindowTakeoverMessage) => Promise<void>;
  activateTab?: (tabId: number) => Promise<void>;
  navigateTab?: (tabId: number, url: string) => Promise<void>;
  sendTabMessage?: (tabId: number, message: unknown) => Promise<void>;
  queryActiveTabInWindow?: (windowId: number) => Promise<chrome.tabs.Tab | undefined>;
  setGuardInterval?: (callback: () => void, ms: number) => ReturnType<typeof setInterval>;
  clearGuardInterval?: (handle: ReturnType<typeof setInterval>) => void;
};

function isIgnorableRuntimeMessageError(error: unknown): boolean {
  return (
    error instanceof Error &&
    (error.message.includes('Receiving end does not exist') ||
      error.message.includes('No SW') ||
      error.message.includes('message port closed'))
  );
}

function toDebugJson(value: unknown) {
  return JSON.stringify(
    value,
    (_key, innerValue) => {
      if (innerValue instanceof Error) {
        return {
          name: innerValue.name,
          message: innerValue.message,
          stack: innerValue.stack,
        };
      }
      return innerValue;
    },
    0
  );
}

function createDefaultRuntimeMessageSender() {
  return (message: WindowTakeoverMessage): Promise<void> => {
    if (typeof chrome === 'undefined' || !chrome.runtime?.sendMessage) {
      return Promise.resolve();
    }

    return new Promise<void>((resolve, reject) => {
      try {
        chrome.runtime.sendMessage(message, () => {
          const runtimeError = chrome.runtime.lastError;
          if (!runtimeError) {
            resolve();
            return;
          }

          const error = new Error(runtimeError.message);
          if (isIgnorableRuntimeMessageError(error)) {
            resolve();
            return;
          }

          reject(error);
        });
      } catch (error) {
        if (isIgnorableRuntimeMessageError(error)) {
          resolve();
          return;
        }
        reject(error);
      }
    });
  };
}

export function createWindowTakeoverService(deps: WindowTakeoverDeps = {}) {
  const now = deps.now ?? Date.now;
  const sendRuntimeMessage = deps.sendRuntimeMessage ?? createDefaultRuntimeMessageSender();
  const activateTab =
    deps.activateTab ??
    (async (tabId: number) => {
      if (typeof chrome === 'undefined' || !chrome.tabs?.update) {
        return;
      }
      await chrome.tabs.update(tabId, { active: true });
    });
  const navigateTab =
    deps.navigateTab ??
    (async (tabId: number, url: string) => {
      if (typeof chrome === 'undefined' || !chrome.tabs?.update) {
        return;
      }
      await chrome.tabs.update(tabId, { url });
    });
  const sendTabMessage =
    deps.sendTabMessage ??
    (async (tabId: number, message: unknown) => {
      if (typeof chrome === 'undefined' || !chrome.tabs?.sendMessage) {
        return;
      }
      try {
        await chrome.tabs.sendMessage(tabId, message);
      } catch (error) {
        if (isIgnorableRuntimeMessageError(error)) {
          return;
        }
        throw error;
      }
    });
  const queryActiveTabInWindow =
    deps.queryActiveTabInWindow ??
    (async (windowId: number) => {
      if (typeof chrome === 'undefined' || !chrome.tabs?.query) {
        return undefined;
      }
      const [activeTab] = await chrome.tabs.query({ active: true, windowId });
      return activeTab;
    });
  const setGuardInterval =
    deps.setGuardInterval ?? ((callback: () => void, ms: number) => setInterval(callback, ms));
  const clearGuardInterval =
    deps.clearGuardInterval ?? ((handle: ReturnType<typeof setInterval>) => clearInterval(handle));

  let activeState: WindowTakeoverState | null = null;
  let pendingLeaveRequest: PendingLeaveRequest | null = null;
  const allowedNavigations: AllowedNavigation[] = [];
  let staySuppression: StaySuppression | null = null;
  let guardIntervalHandle: ReturnType<typeof setInterval> | null = null;
  let isGuardCheckRunning = false;
  let debugSequence = 0;
  let nextLeaveRequestId = 1;

  const logDebug = (event: string, payload?: Record<string, unknown>) => {
    const entry = {
      seq: ++debugSequence,
      at: now(),
      event,
      activeState,
      pendingLeaveRequest,
      staySuppression,
      allowedNavigations: [...allowedNavigations],
      ...payload,
    };
    console.debug('[takeover:bg]', entry);
    console.debug('[takeover:bg:json]', toDebugJson(entry));
  };

  const broadcast = async (message: WindowTakeoverMessage) => {
    await sendRuntimeMessage(message);
  };

  const syncContentTakeoverState = async (
    tabId: number,
    payload: { active: boolean; runId: string }
  ) => {
    await sendTabMessage(tabId, {
      type: AGENT_V2_WINDOW_TAKEOVER_CONTENT_STATE,
      payload,
    });
  };

  const pruneExpiredNavigations = () => {
    const currentTime = now();
    for (let index = allowedNavigations.length - 1; index >= 0; index -= 1) {
      if (allowedNavigations[index]?.expiresAt < currentTime) {
        allowedNavigations.splice(index, 1);
      }
    }
  };

  const consumeAllowedNavigation = (input: { tabId: number; windowId: number }) => {
    pruneExpiredNavigations();

    const matchIndex = allowedNavigations.findIndex((navigation) => {
      if (navigation.windowId !== input.windowId) {
        return false;
      }
      if (navigation.toTabId != null && navigation.toTabId !== input.tabId) {
        return false;
      }
      if (navigation.fromTabId != null && navigation.fromTabId !== activeState?.lockedTabId) {
        return false;
      }
      return true;
    });

    if (matchIndex === -1) {
      return null;
    }

    const [matchedNavigation] = allowedNavigations.splice(matchIndex, 1);
    return matchedNavigation ?? null;
  };

  const queueFollowupNavigationAllowance = (
    navigation: AllowedNavigation,
    tabId: number,
    reason: AllowedNavigation['reason']
  ) => {
    pruneExpiredNavigations();
    allowedNavigations.push({
      windowId: navigation.windowId,
      toTabId: tabId,
      reason,
      expiresAt: navigation.expiresAt,
    });
  };

  const updateState = async (nextState: WindowTakeoverState) => {
    logDebug('update-state', { nextState });
    activeState = nextState;
    await broadcast({
      type: 'agent_v2_window_takeover_state_changed',
      payload: nextState,
    });
    return nextState;
  };

  const isStaySuppressed = (attemptedTabId: number, windowId: number) => {
    if (!staySuppression) {
      return false;
    }

    if (staySuppression.expiresAt < now()) {
      staySuppression = null;
      return false;
    }

    return (
      staySuppression.attemptedTabId === attemptedTabId && staySuppression.windowId === windowId
    );
  };

  const clearStaySuppression = (reason: string) => {
    if (!staySuppression) {
      return;
    }
    logDebug('clear-stay-suppression', { reason });
    staySuppression = null;
  };

  const requestConfirmation = async (
    attemptedTabId: number,
    reason: LeaveReason,
    options: { intendedUrl?: string } = {}
  ) => {
    if (!activeState) {
      logDebug('skip-confirmation:no-active-state', {
        attemptedTabId,
        reason,
      });
      return { kind: 'ignored' as const };
    }

    if (isStaySuppressed(attemptedTabId, activeState.windowId)) {
      logDebug('skip-confirmation:stay-suppression', {
        attemptedTabId,
        reason,
      });
      return { kind: 'ignored' as const };
    }

    if (pendingLeaveRequest) {
      const isSamePendingRequest =
        pendingLeaveRequest.attemptedTabId === attemptedTabId &&
        pendingLeaveRequest.reason === reason;

      logDebug('confirmation-already-pending', {
        attemptedTabId,
        reason,
        isSamePendingRequest,
      });

      if (isSamePendingRequest) {
        return { kind: 'confirmation_required' as const };
      }

      return { kind: 'ignored' as const };
    }

    logDebug('request-confirmation', {
      attemptedTabId,
      reason,
    });
    pendingLeaveRequest = {
      requestId: nextLeaveRequestId,
      attemptedTabId,
      reason,
      ...(options.intendedUrl ? { intendedUrl: options.intendedUrl } : {}),
    };
    nextLeaveRequestId += 1;

    await broadcast({
      type: 'agent_v2_window_takeover_confirmation_required',
      payload: {
        sessionId: activeState.sessionId,
        runId: activeState.runId,
        windowId: activeState.windowId,
        lockedTabId: activeState.lockedTabId,
        requestId: pendingLeaveRequest.requestId,
        attemptedTabId,
        reason,
      },
    });

    return { kind: 'confirmation_required' as const };
  };

  const stopGuardLoop = () => {
    if (guardIntervalHandle == null) {
      return;
    }
    clearGuardInterval(guardIntervalHandle);
    guardIntervalHandle = null;
  };

  const runGuardCheck = async () => {
    if (isGuardCheckRunning || !activeState || activeState.status !== 'active') {
      logDebug('guard-skip', {
        isGuardCheckRunning,
        activeStateStatus: activeState?.status ?? null,
      });
      return;
    }

    isGuardCheckRunning = true;
    try {
      const currentState = activeState;
      const activeTab = await queryActiveTabInWindow(currentState.windowId);
      logDebug('guard-active-tab-snapshot', {
        currentState,
        activeTab: activeTab
          ? {
              id: activeTab.id,
              windowId: activeTab.windowId,
              url: activeTab.url,
            }
          : null,
      });
      if (!activeTab || typeof activeTab.id !== 'number') {
        return;
      }

      if (activeTab.id === currentState.lockedTabId) {
        clearStaySuppression('guard-locked-tab-active');
        return;
      }

      const input = { tabId: activeTab.id, windowId: currentState.windowId };
      const allowedNavigation = consumeAllowedNavigation(input);
      if (allowedNavigation) {
        logDebug('guard-consume-allowed-tab-activation', {
          input,
          allowedNavigation,
        });
        if (allowedNavigation.reason === 'ai-tab-switch') {
          queueFollowupNavigationAllowance(allowedNavigation, input.tabId, 'ai-navigation');
        }
        activeState = {
          ...currentState,
          lockedTabId: allowedNavigation.toTabId ?? input.tabId,
        };
        return;
      }

      if (pendingLeaveRequest) {
        logDebug('guard-skip:pending-leave-request', {
          input,
        });
        return;
      }
      await requestConfirmation(activeTab.id, 'tab_activated');
    } catch (error) {
      console.debug('[takeover:bg] guard check failed', error);
    } finally {
      isGuardCheckRunning = false;
    }
  };

  const startGuardLoop = () => {
    stopGuardLoop();
    guardIntervalHandle = setGuardInterval(() => {
      void runGuardCheck();
    }, 400);
  };

  return {
    async start(input: Omit<WindowTakeoverState, 'status' | 'startedAt'>) {
      logDebug('start-takeover', { input });
      pendingLeaveRequest = null;
      allowedNavigations.length = 0;
      staySuppression = null;

      const nextState = await updateState({
        ...input,
        status: 'active',
        startedAt: now(),
      });
      await syncContentTakeoverState(input.lockedTabId, {
        active: true,
        runId: input.runId,
      });
      startGuardLoop();
      return nextState;
    },

    getState() {
      return activeState;
    },

    allowNavigation(input: AllowedNavigation) {
      logDebug('allow-navigation', { input });
      pruneExpiredNavigations();
      allowedNavigations.push(input);
      return input;
    },

    async handleTabActivated(input: { tabId: number; windowId: number }) {
      logDebug('handle-tab-activated', {
        input,
      });
      if (!activeState || activeState.status !== 'active') {
        return { kind: 'ignored' as const };
      }

      if (input.windowId !== activeState.windowId) {
        return { kind: 'ignored' as const };
      }

      if (input.tabId === activeState.lockedTabId) {
        clearStaySuppression('locked-tab-activated');
        return { kind: 'ignored' as const };
      }

      const allowedNavigation = consumeAllowedNavigation(input);
      if (allowedNavigation) {
        logDebug('consume-allowed-tab-activation', {
          input,
          allowedNavigation,
        });
        if (allowedNavigation.reason === 'ai-tab-switch') {
          queueFollowupNavigationAllowance(allowedNavigation, input.tabId, 'ai-navigation');
        }
        activeState = {
          ...activeState,
          lockedTabId: allowedNavigation.toTabId ?? input.tabId,
        };
        return { kind: 'allowed' as const };
      }

      return requestConfirmation(input.tabId, 'tab_activated');
    },

    async handleTabUpdated(input: { tabId: number; windowId: number; url?: string }) {
      logDebug('handle-tab-updated', {
        input,
      });
      if (!activeState || activeState.status !== 'active') {
        return { kind: 'ignored' as const };
      }

      if (input.windowId !== activeState.windowId || input.tabId !== activeState.lockedTabId) {
        return { kind: 'ignored' as const };
      }

      if (!input.url || !activeState.lockedUrl || input.url === activeState.lockedUrl) {
        return { kind: 'ignored' as const };
      }

      const allowedNavigation = consumeAllowedNavigation(input);
      if (allowedNavigation) {
        logDebug('consume-allowed-tab-update', {
          input,
          allowedNavigation,
        });
        activeState = {
          ...activeState,
          lockedUrl: input.url,
        };
        return { kind: 'allowed' as const };
      }

      return requestConfirmation(input.tabId, 'tab_navigated');
    },

    async handleNavigationAttempt(input: { tabId: number; windowId: number; url: string }) {
      logDebug('handle-navigation-attempt', {
        input,
      });
      if (!activeState || activeState.status !== 'active') {
        return { kind: 'ignored' as const };
      }

      if (input.windowId !== activeState.windowId || input.tabId !== activeState.lockedTabId) {
        return { kind: 'ignored' as const };
      }

      return requestConfirmation(input.tabId, 'tab_navigated', { intendedUrl: input.url });
    },

    async handleTabRemoved(input: { tabId: number; windowId?: number }) {
      logDebug('handle-tab-removed', {
        input,
      });
      if (!activeState || activeState.status !== 'active') {
        return { kind: 'ignored' as const };
      }

      if (input.tabId !== activeState.lockedTabId) {
        return { kind: 'ignored' as const };
      }

      return requestConfirmation(input.tabId, 'tab_removed');
    },

    async resolveLeaveDecision(input: {
      decision: 'stay' | 'leave';
      attemptedTabId: number;
      requestId?: number;
    }) {
      logDebug('resolve-leave-decision:start', {
        input,
      });
      if (!activeState || activeState.status !== 'active' || !pendingLeaveRequest) {
        return { kind: 'ignored' as const };
      }

      if (pendingLeaveRequest.attemptedTabId !== input.attemptedTabId) {
        return { kind: 'ignored' as const };
      }

      if (input.requestId != null && pendingLeaveRequest.requestId !== input.requestId) {
        return { kind: 'ignored' as const };
      }

      if (input.decision === 'stay') {
        const attemptedTabId = pendingLeaveRequest.attemptedTabId;
        pendingLeaveRequest = null;
        staySuppression = {
          attemptedTabId,
          windowId: activeState.windowId,
          expiresAt: now() + STAY_RESTORE_SUPPRESSION_MS,
        };
        logDebug('resolve-leave-decision:stay-set-suppression', {
          attemptedTabId,
          lockedTabId: activeState.lockedTabId,
        });

        if (attemptedTabId !== activeState.lockedTabId) {
          logDebug('resolve-leave-decision:stay-activate-locked-tab', {
            targetTabId: activeState.lockedTabId,
          });
          await activateTab(activeState.lockedTabId);
          logDebug('resolve-leave-decision:stay-activate-locked-tab:done', {
            targetTabId: activeState.lockedTabId,
          });
        }
        return { kind: 'resumed' as const, status: activeState.status };
      }

      const intendedUrl = pendingLeaveRequest.intendedUrl;

      await updateState({
        ...activeState,
        status: 'interrupting',
      });

      pendingLeaveRequest = null;
      allowedNavigations.length = 0;
      staySuppression = null;

      await updateState({
        ...activeState,
        status: 'interrupted',
      });
      stopGuardLoop();

      await syncContentTakeoverState(activeState.lockedTabId, {
        active: false,
        runId: activeState.runId,
      });

      if (intendedUrl) {
        await navigateTab(activeState.lockedTabId, intendedUrl);
      }

      return { kind: 'stopped' as const, status: 'interrupted' as const };
    },

    async stop() {
      logDebug('stop-takeover');
      if (!activeState) {
        return null;
      }

      pendingLeaveRequest = null;
      allowedNavigations.length = 0;
      staySuppression = null;
      stopGuardLoop();

      const nextState = await updateState({
        ...activeState,
        status: 'released',
      });
      await syncContentTakeoverState(activeState.lockedTabId, {
        active: false,
        runId: activeState.runId,
      });
      return nextState;
    },
  };
}

export let windowTakeoverService = createWindowTakeoverService();

export function resetWindowTakeoverServiceForTests(): void {
  windowTakeoverService = createWindowTakeoverService();
}

let listenersInitialized = false;

export function initWindowTakeoverListeners() {
  if (listenersInitialized || typeof chrome === 'undefined') {
    return;
  }

  chrome.tabs?.onActivated?.addListener((activeInfo) => {
    console.debug('[takeover:bg] listener tabs.onActivated', activeInfo);
    console.debug(
      '[takeover:bg:json]',
      toDebugJson({
        event: 'listener-tabs.onActivated',
        activeInfo,
      })
    );
    void windowTakeoverService.handleTabActivated({
      tabId: activeInfo.tabId,
      windowId: activeInfo.windowId,
    });
  });

  chrome.tabs?.onUpdated?.addListener((tabId, changeInfo, tab) => {
    if (!tab?.windowId || !changeInfo.url) {
      return;
    }
    console.debug('[takeover:bg] listener tabs.onUpdated', {
      tabId,
      changeInfo,
      windowId: tab.windowId,
      tabUrl: tab.url,
    });
    console.debug(
      '[takeover:bg:json]',
      toDebugJson({
        event: 'listener-tabs.onUpdated',
        tabId,
        changeInfo,
        windowId: tab.windowId,
        tabUrl: tab.url,
      })
    );

    void windowTakeoverService.handleTabUpdated({
      tabId,
      windowId: tab.windowId,
      url: changeInfo.url,
    });
  });

  chrome.tabs?.onRemoved?.addListener((tabId, removeInfo) => {
    console.debug('[takeover:bg] listener tabs.onRemoved', {
      tabId,
      removeInfo,
    });
    console.debug(
      '[takeover:bg:json]',
      toDebugJson({
        event: 'listener-tabs.onRemoved',
        tabId,
        removeInfo,
      })
    );
    void windowTakeoverService.handleTabRemoved({
      tabId,
      windowId: removeInfo.windowId,
    });
  });

  chrome.runtime?.onMessage?.addListener((message, _sender, sendResponse) => {
    if (
      !message ||
      typeof message !== 'object' ||
      (message as { type?: unknown }).type !== AGENT_V2_WINDOW_TAKEOVER_REQUEST
    ) {
      return false;
    }

    const payload = (
      message as {
        payload?: {
          requestType?: 'start' | 'stop' | 'getState' | 'allowNavigation' | 'resolveLeaveDecision';
          input?: unknown;
        };
      }
    ).payload;

    const respond = (task: Promise<unknown>) => {
      task
        .then((data) => sendResponse({ ok: true, data }))
        .catch((error) =>
          sendResponse({
            ok: false,
            error: error instanceof Error ? error.message : String(error),
          })
        );
    };

    switch (payload?.requestType) {
      case 'start':
        console.debug('[takeover:bg] runtime request start', payload.input);
        respond(
          windowTakeoverService.start(
            payload.input as Omit<WindowTakeoverState, 'status' | 'startedAt'>
          )
        );
        return true;
      case 'stop':
        console.debug('[takeover:bg] runtime request stop');
        respond(windowTakeoverService.stop());
        return true;
      case 'getState':
        console.debug('[takeover:bg] runtime request getState');
        sendResponse({ ok: true, data: windowTakeoverService.getState() });
        return true;
      case 'allowNavigation':
        console.debug('[takeover:bg] runtime request allowNavigation', payload.input);
        sendResponse({
          ok: true,
          data: windowTakeoverService.allowNavigation(payload.input as AllowedNavigation),
        });
        return true;
      case 'resolveLeaveDecision':
        console.debug('[takeover:bg] runtime request resolveLeaveDecision', payload.input);
        respond(
          windowTakeoverService.resolveLeaveDecision(
            payload.input as {
              decision: 'stay' | 'leave';
              attemptedTabId: number;
            }
          )
        );
        return true;
      default:
        sendResponse({ ok: false, error: 'Unknown window takeover request type' });
        return true;
    }
  });

  chrome.runtime?.onMessage?.addListener((message, sender, sendResponse) => {
    if (
      !message ||
      typeof message !== 'object' ||
      (message as { type?: unknown }).type !== AGENT_V2_WINDOW_TAKEOVER_NAVIGATION_ATTEMPT
    ) {
      return false;
    }

    const tabId = sender.tab?.id;
    const windowId = sender.tab?.windowId;
    const url = (message as { payload?: { url?: unknown } }).payload?.url;
    if (!tabId || !windowId || typeof url !== 'string' || url.trim().length === 0) {
      sendResponse({ ok: false, error: 'Invalid navigation attempt payload' });
      return true;
    }

    void windowTakeoverService
      .handleNavigationAttempt({ tabId, windowId, url })
      .then((data) => sendResponse({ ok: true, data }))
      .catch((error) =>
        sendResponse({
          ok: false,
          error: error instanceof Error ? error.message : String(error),
        })
      );
    return true;
  });

  listenersInitialized = true;
}
