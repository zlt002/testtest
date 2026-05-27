import { describe, expect, it } from 'vitest';

import {
  AGENT_V2_WINDOW_TAKEOVER_BLOCKED,
  AGENT_V2_WINDOW_TAKEOVER_CONFIRMATION_REQUIRED,
  AGENT_V2_WINDOW_TAKEOVER_STATE_CHANGED,
  isWindowTakeoverBlockedMessage,
  isWindowTakeoverConfirmationRequiredMessage,
  isWindowTakeoverStateChangedMessage,
} from './window-takeover';

describe('window takeover message guards', () => {
  it('recognizes state changed messages', () => {
    expect(
      isWindowTakeoverStateChangedMessage({
        type: AGENT_V2_WINDOW_TAKEOVER_STATE_CHANGED,
        payload: {
          sessionId: 'session-1',
          runId: 'run-1',
          windowId: 7,
          lockedTabId: 101,
          status: 'active',
          startedAt: 1,
        },
      })
    ).toBe(true);
  });

  it('recognizes confirmation required messages', () => {
    expect(
      isWindowTakeoverConfirmationRequiredMessage({
        type: AGENT_V2_WINDOW_TAKEOVER_CONFIRMATION_REQUIRED,
        payload: {
          sessionId: 'session-1',
          runId: 'run-1',
          windowId: 7,
          lockedTabId: 101,
          attemptedTabId: 202,
          reason: 'tab_activated',
        },
      })
    ).toBe(true);
  });

  it('recognizes blocked messages', () => {
    expect(
      isWindowTakeoverBlockedMessage({
        type: AGENT_V2_WINDOW_TAKEOVER_BLOCKED,
        payload: {
          sessionId: 'session-1',
          runId: 'run-1',
          windowId: 7,
          lockedTabId: 101,
          attemptedTabId: 202,
          reason: 'tab_activated',
        },
      })
    ).toBe(true);
  });
});
