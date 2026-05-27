// @vitest-environment node

import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  AGENT_V2_ACTIVE_RUN_SESSION_STORAGE_KEY,
  clearAgentV2ActiveRunSession,
  publishAgentV2ActiveRunSession,
  readAgentV2ActiveRunSession,
  type AgentV2ActiveRunSession,
} from './active-run-session';

function createStorageArea() {
  const storage = new Map<string, unknown>();

  return {
    get: vi.fn(async (key: string) => ({ [key]: storage.get(key) })),
    set: vi.fn(async (value: Record<string, unknown>) => {
      for (const [key, storedValue] of Object.entries(value)) {
        storage.set(key, storedValue);
      }
    }),
    remove: vi.fn(async (key: string) => {
      storage.delete(key);
    }),
  };
}

describe('active run session storage', () => {
  beforeEach(() => {
    const local = createStorageArea();
    vi.stubGlobal('chrome', {
      storage: { local },
    });
  });

  it('writes and reads the active run session record', async () => {
    const payload: AgentV2ActiveRunSession = {
      sessionId: 'session-1',
      projectPath: '/tmp/project-a',
      runId: 'run-1',
      status: 'streaming',
      updatedAt: '2026-05-22T10:00:00.000Z',
    };

    await publishAgentV2ActiveRunSession(payload);

    await expect(readAgentV2ActiveRunSession()).resolves.toEqual(payload);
  });

  it('returns null for invalid records', async () => {
    await chrome.storage.local.set({
      [AGENT_V2_ACTIVE_RUN_SESSION_STORAGE_KEY]: {
        sessionId: 1,
      },
    });

    await expect(readAgentV2ActiveRunSession()).resolves.toBeNull();
  });

  it('clears the active run session record', async () => {
    await publishAgentV2ActiveRunSession({
      sessionId: 'session-1',
      projectPath: '/tmp/project-a',
      runId: 'run-1',
      status: 'connecting',
      updatedAt: '2026-05-22T10:00:00.000Z',
    });

    await clearAgentV2ActiveRunSession();

    await expect(readAgentV2ActiveRunSession()).resolves.toBeNull();
  });
});
