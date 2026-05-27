export const AGENT_V2_WINDOW_TAKEOVER_STATE_CHANGED = 'agent_v2_window_takeover_state_changed';
export const AGENT_V2_WINDOW_TAKEOVER_BLOCKED = 'agent_v2_window_takeover_blocked';
export const AGENT_V2_WINDOW_TAKEOVER_CONFIRMATION_REQUIRED =
  'agent_v2_window_takeover_confirmation_required';
const AGENT_V2_WINDOW_TAKEOVER_REQUEST = 'agent_v2_window_takeover_request';

export type WindowTakeoverStatus = 'active' | 'interrupting' | 'interrupted' | 'released';
export type WindowTakeoverLeaveReason = 'tab_activated' | 'tab_navigated' | 'tab_removed';

export type WindowTakeoverState = {
  sessionId: string;
  runId: string;
  windowId: number;
  lockedTabId: number;
  lockedUrl?: string;
  status: WindowTakeoverStatus;
  startedAt: number;
};

export type WindowTakeoverStateChangedMessage = {
  type: typeof AGENT_V2_WINDOW_TAKEOVER_STATE_CHANGED;
  payload: WindowTakeoverState;
};

export type WindowTakeoverBlockedMessage = {
  type: typeof AGENT_V2_WINDOW_TAKEOVER_BLOCKED;
  payload: {
    sessionId: string;
    runId: string;
    windowId: number;
    lockedTabId: number;
    attemptedTabId: number;
    reason: WindowTakeoverLeaveReason;
  };
};

export type WindowTakeoverConfirmationRequiredMessage = {
  type: typeof AGENT_V2_WINDOW_TAKEOVER_CONFIRMATION_REQUIRED;
  payload: {
    sessionId: string;
    runId: string;
    windowId: number;
    lockedTabId: number;
    requestId: number;
    attemptedTabId: number;
    reason: WindowTakeoverLeaveReason;
  };
};

type WindowTakeoverRequestMap = {
  start: {
    sessionId: string;
    runId: string;
    windowId: number;
    lockedTabId: number;
    lockedUrl?: string;
  };
  stop: undefined;
  getState: undefined;
  allowNavigation: {
    windowId: number;
    fromTabId?: number;
    toTabId?: number;
    reason: 'ai-tab-switch' | 'ai-navigation' | 'ai-refresh' | 'ai-close';
    expiresAt: number;
  };
  resolveLeaveDecision: {
    decision: 'stay' | 'leave';
    attemptedTabId: number;
    requestId?: number;
  };
};

type WindowTakeoverResponseMap = {
  start: WindowTakeoverState;
  stop: WindowTakeoverState | null;
  getState: WindowTakeoverState | null;
  allowNavigation: WindowTakeoverRequestMap['allowNavigation'];
  resolveLeaveDecision:
    | { kind: 'ignored' }
    | { kind: 'resumed'; status: WindowTakeoverStatus }
    | { kind: 'stopped'; status: 'interrupted' };
};

export type WindowTakeoverRequestType = keyof WindowTakeoverRequestMap;

type WindowTakeoverRequestMessage<TType extends WindowTakeoverRequestType> = {
  type: typeof AGENT_V2_WINDOW_TAKEOVER_REQUEST;
  payload: {
    requestType: TType;
    input: WindowTakeoverRequestMap[TType];
  };
};

function sendWindowTakeoverRequest<TType extends WindowTakeoverRequestType>(
  requestType: TType,
  input: WindowTakeoverRequestMap[TType]
): Promise<WindowTakeoverResponseMap[TType]> {
  return new Promise((resolve, reject) => {
    try {
      chrome.runtime.sendMessage(
        {
          type: AGENT_V2_WINDOW_TAKEOVER_REQUEST,
          payload: {
            requestType,
            input,
          },
        } as WindowTakeoverRequestMessage<TType>,
        (response?: { ok: boolean; data?: WindowTakeoverResponseMap[TType]; error?: string }) => {
          const runtimeError = chrome.runtime.lastError;
          if (runtimeError) {
            reject(new Error(runtimeError.message));
            return;
          }

          if (!response?.ok) {
            reject(new Error(response?.error || 'Window takeover request failed'));
            return;
          }

          resolve(response.data as WindowTakeoverResponseMap[TType]);
        }
      );
    } catch (error) {
      reject(error);
    }
  });
}

export function startWindowTakeover(input: WindowTakeoverRequestMap['start']) {
  return sendWindowTakeoverRequest('start', input);
}

export function stopWindowTakeover() {
  return sendWindowTakeoverRequest('stop', undefined);
}

export function getWindowTakeoverState() {
  return sendWindowTakeoverRequest('getState', undefined);
}

export function allowWindowTakeoverNavigation(input: WindowTakeoverRequestMap['allowNavigation']) {
  return sendWindowTakeoverRequest('allowNavigation', input);
}

export function resolveWindowTakeoverLeaveDecision(
  input: WindowTakeoverRequestMap['resolveLeaveDecision']
) {
  return sendWindowTakeoverRequest('resolveLeaveDecision', input);
}

export function isWindowTakeoverStateChangedMessage(
  message: unknown
): message is WindowTakeoverStateChangedMessage {
  return (
    typeof message === 'object' &&
    message !== null &&
    (message as { type?: unknown }).type === AGENT_V2_WINDOW_TAKEOVER_STATE_CHANGED &&
    typeof (message as { payload?: { runId?: unknown } }).payload?.runId === 'string'
  );
}

export function isWindowTakeoverConfirmationRequiredMessage(
  message: unknown
): message is WindowTakeoverConfirmationRequiredMessage {
  return (
    typeof message === 'object' &&
    message !== null &&
    (message as { type?: unknown }).type === AGENT_V2_WINDOW_TAKEOVER_CONFIRMATION_REQUIRED &&
    typeof (message as { payload?: { runId?: unknown } }).payload?.runId === 'string'
  );
}

export function isWindowTakeoverBlockedMessage(
  message: unknown
): message is WindowTakeoverBlockedMessage {
  return (
    typeof message === 'object' &&
    message !== null &&
    (message as { type?: unknown }).type === AGENT_V2_WINDOW_TAKEOVER_BLOCKED &&
    typeof (message as { payload?: { runId?: unknown } }).payload?.runId === 'string'
  );
}
