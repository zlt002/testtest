// @vitest-environment node

import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  AGENT_V2_PROJECT_SELECTED_MESSAGE,
  AGENT_V2_CURRENT_SESSION_STORAGE_KEY,
  AGENT_V2_SESSION_SELECTED_MESSAGE,
  AGENT_V2_SESSION_SELECTION_STORAGE_KEY,
  AGENT_V2_WORKSPACE_INTENT_STORAGE_KEY,
  clearAgentV2SessionSelectedTabs,
  clearAgentV2CurrentSession,
  clearAgentV2WorkspaceIntent,
  isAgentV2ProjectSelectedMessage,
  publishAgentV2ProjectSelection,
  publishAgentV2CurrentSession,
  publishAgentV2SessionSelection,
  publishAgentV2WorkspaceIntent,
  readAgentV2CurrentSession,
  readAgentV2ProjectSelection,
  readAgentV2SessionSelectedTabs,
  readAgentV2SessionSelection,
  readAgentV2WorkspaceIntent,
  writeAgentV2SessionSelectedTabs,
} from './session-selection';
import { DEFAULT_SELECTED_TAB_SOURCE } from '../session-tab-selection';

const storage = new Map<string, unknown>();
const sendMessage = vi.fn(async () => undefined);

beforeEach(() => {
  storage.clear();
  sendMessage.mockClear();
  vi.stubGlobal('chrome', {
    storage: {
      local: {
        get: vi.fn(async (key: string) => ({ [key]: storage.get(key) })),
        set: vi.fn(async (value: Record<string, unknown>) => {
          for (const [key, storedValue] of Object.entries(value)) {
            storage.set(key, storedValue);
          }
        }),
        remove: vi.fn(async (key: string) => {
          storage.delete(key);
        }),
      },
    },
    runtime: {
      sendMessage,
    },
  });
});

describe('project selection', () => {
  it('publishes and reads the selected project path', async () => {
    storage.set(AGENT_V2_SESSION_SELECTION_STORAGE_KEY, {
      sessionId: 'old-session',
      selectedAt: '2026-05-11T00:00:00.000Z',
    });

    await publishAgentV2ProjectSelection({
      projectPath: 'C:\\Users\\Administrator\\Desktop\\mpcb',
    });

    expect(storage.has(AGENT_V2_SESSION_SELECTION_STORAGE_KEY)).toBe(false);
    expect(sendMessage).toHaveBeenCalledWith({
      type: AGENT_V2_PROJECT_SELECTED_MESSAGE,
      payload: expect.objectContaining({
        projectPath: 'C:\\Users\\Administrator\\Desktop\\mpcb',
      }),
    });
    expect(await readAgentV2ProjectSelection()).toEqual(
      expect.objectContaining({
        projectPath: 'C:\\Users\\Administrator\\Desktop\\mpcb',
      })
    );
  });

  it('preserves new session project selections for same-project resets', async () => {
    await publishAgentV2ProjectSelection({
      projectPath: 'C:\\Users\\Administrator\\Desktop\\mpcb',
      kind: 'new_session',
    });

    expect(sendMessage).toHaveBeenCalledWith({
      type: AGENT_V2_PROJECT_SELECTED_MESSAGE,
      payload: expect.objectContaining({
        projectPath: 'C:\\Users\\Administrator\\Desktop\\mpcb',
        kind: 'new_session',
      }),
    });
    expect(await readAgentV2ProjectSelection()).toEqual(
      expect.objectContaining({
        projectPath: 'C:\\Users\\Administrator\\Desktop\\mpcb',
        kind: 'new_session',
      })
    );
  });

  it('recognizes project selection messages', () => {
    expect(
      isAgentV2ProjectSelectedMessage({
        type: AGENT_V2_PROJECT_SELECTED_MESSAGE,
        payload: {
          projectPath: 'C:\\repo',
          selectedAt: '2026-05-11T00:00:00.000Z',
        },
      })
    ).toBe(true);
  });
});

describe('session selection', () => {
  it('consumes the selected session after reading it', async () => {
    await publishAgentV2SessionSelection({
      sessionId: 'old-session',
      projectPath: 'C:\\Users\\Administrator\\Desktop\\mpcb',
      title: '当前工作区是什么项目呢',
    });

    expect(sendMessage).toHaveBeenCalledWith({
      type: AGENT_V2_SESSION_SELECTED_MESSAGE,
      payload: expect.objectContaining({
        sessionId: 'old-session',
        projectPath: 'C:\\Users\\Administrator\\Desktop\\mpcb',
        title: '当前工作区是什么项目呢',
      }),
    });

    expect(await readAgentV2SessionSelection()).toEqual(
      expect.objectContaining({
        sessionId: 'old-session',
        projectPath: 'C:\\Users\\Administrator\\Desktop\\mpcb',
        title: '当前工作区是什么项目呢',
      })
    );
    expect(storage.has(AGENT_V2_SESSION_SELECTION_STORAGE_KEY)).toBe(false);
    expect(await readAgentV2SessionSelection()).toBeNull();
  });

  it('sanitizes generated prompt metadata in selected session titles', async () => {
    await publishAgentV2SessionSelection({
      sessionId: 'dirty-session',
      projectPath: 'C:\\Users\\Administrator\\Desktop\\mpcb',
      title: [
        '<attachments>',
        '- name=image.png | mimeType=image/png | kind=image',
        '</attachments>',
        '',
        '<user_original_request>',
        '图片内容是啥呢',
        '</user_original_request>',
      ].join('\n'),
    });

    expect(await readAgentV2SessionSelection()).toEqual(
      expect.objectContaining({
        sessionId: 'dirty-session',
        title: '图片内容是啥呢',
      })
    );
  });

  it('keeps the current session readable without consuming it', async () => {
    await publishAgentV2CurrentSession({
      sessionId: 'current-session',
      projectPath: 'C:\\Users\\Administrator\\Desktop\\mpcb',
      title: '定位信息：选择器 tbody...',
    });

    expect(await readAgentV2CurrentSession()).toEqual(
      expect.objectContaining({
        sessionId: 'current-session',
        projectPath: 'C:\\Users\\Administrator\\Desktop\\mpcb',
        title: '定位信息：选择器 tbody...',
      })
    );
    expect(await readAgentV2CurrentSession()).toEqual(
      expect.objectContaining({
        sessionId: 'current-session',
      })
    );

    await clearAgentV2CurrentSession();

    expect(storage.has(AGENT_V2_CURRENT_SESSION_STORAGE_KEY)).toBe(false);
    expect(await readAgentV2CurrentSession()).toBeNull();
  });

  it('sanitizes generated prompt metadata in current session titles', async () => {
    await publishAgentV2CurrentSession({
      sessionId: 'current-session',
      projectPath: 'C:\\Users\\Administrator\\Desktop\\mpcb',
      title: [
        '<project_workspace>',
        '当前项目根目录：C:\\Users\\Administrator\\Desktop\\mpcb',
        '</project_workspace>',
        '',
        '真正标题',
      ].join('\n'),
    });

    expect(await readAgentV2CurrentSession()).toEqual(
      expect.objectContaining({
        sessionId: 'current-session',
        title: '真正标题',
      })
    );
  });

  it('falls back to the explicit skill name when session title only contains auto context', async () => {
    await publishAgentV2CurrentSession({
      sessionId: 'skill-session',
      projectPath: 'C:\\Users\\Administrator\\Desktop\\mpcb',
      title: [
        '<webmcp_explicit_skill name="/ewankb-server-query">',
        '你必须优先遵循下面这个 skill，严格按其中要求执行：',
        '# /ewankb-server-query',
        '</webmcp_explicit_skill>',
      ].join('\n'),
    });

    expect(await readAgentV2CurrentSession()).toEqual(
      expect.objectContaining({
        sessionId: 'skill-session',
        title: '/ewankb-server-query',
      })
    );
  });
});

describe('workspace intent', () => {
  it('stores and clears the pending new session intent', async () => {
    await publishAgentV2WorkspaceIntent({ kind: 'new_session' });

    expect(await readAgentV2WorkspaceIntent()).toEqual(
      expect.objectContaining({
        kind: 'new_session',
      })
    );

    await clearAgentV2WorkspaceIntent();
    expect(storage.has(AGENT_V2_WORKSPACE_INTENT_STORAGE_KEY)).toBe(false);
    expect(await readAgentV2WorkspaceIntent()).toBeNull();
  });
});

describe('session selected tabs', () => {
  it('stores and reads selected tabs by session id', async () => {
    await writeAgentV2SessionSelectedTabs({
      sessionId: 'session-a',
      selectedTabIds: [11, 12],
      primaryTabId: 12,
      source: DEFAULT_SELECTED_TAB_SOURCE,
      updatedAt: '2026-05-24T00:00:00.000Z',
    });

    expect(await readAgentV2SessionSelectedTabs('session-a')).toEqual({
      sessionId: 'session-a',
      selectedTabIds: [11, 12],
      primaryTabId: 12,
      source: DEFAULT_SELECTED_TAB_SOURCE,
      updatedAt: '2026-05-24T00:00:00.000Z',
    });
    expect(await readAgentV2SessionSelectedTabs('session-b')).toBeNull();
    expect(storage.get('agentV2.sessionSelectedTabs:session-a')).toEqual({
      sessionId: 'session-a',
      selectedTabIds: [11, 12],
      primaryTabId: 12,
      source: DEFAULT_SELECTED_TAB_SOURCE,
      updatedAt: '2026-05-24T00:00:00.000Z',
    });
    expect(storage.has('agentV2.sessionSelectedTabs')).toBe(false);
  });

  it('clears only the matching session selected tabs entry', async () => {
    await writeAgentV2SessionSelectedTabs({
      sessionId: 'session-a',
      selectedTabIds: [11],
      primaryTabId: 11,
      source: DEFAULT_SELECTED_TAB_SOURCE,
      updatedAt: '2026-05-24T00:00:00.000Z',
    });
    await writeAgentV2SessionSelectedTabs({
      sessionId: 'session-b',
      selectedTabIds: [18],
      primaryTabId: 18,
      source: DEFAULT_SELECTED_TAB_SOURCE,
      updatedAt: '2026-05-24T00:01:00.000Z',
    });

    await clearAgentV2SessionSelectedTabs('session-a');

    expect(await readAgentV2SessionSelectedTabs('session-a')).toBeNull();
    expect(storage.has('agentV2.sessionSelectedTabs:session-a')).toBe(false);
    expect(await readAgentV2SessionSelectedTabs('session-b')).toEqual({
      sessionId: 'session-b',
      selectedTabIds: [18],
      primaryTabId: 18,
      source: DEFAULT_SELECTED_TAB_SOURCE,
      updatedAt: '2026-05-24T00:01:00.000Z',
    });
    expect(storage.get('agentV2.sessionSelectedTabs:session-b')).toEqual({
      sessionId: 'session-b',
      selectedTabIds: [18],
      primaryTabId: 18,
      source: DEFAULT_SELECTED_TAB_SOURCE,
      updatedAt: '2026-05-24T00:01:00.000Z',
    });
  });

  it('does not overwrite another session entry when writing a new session selection', async () => {
    storage.set('agentV2.sessionSelectedTabs:session-a', {
      sessionId: 'session-a',
      selectedTabIds: [11],
      primaryTabId: 11,
      source: DEFAULT_SELECTED_TAB_SOURCE,
      updatedAt: '2026-05-24T00:00:00.000Z',
    });

    await writeAgentV2SessionSelectedTabs({
      sessionId: 'session-b',
      selectedTabIds: [18],
      primaryTabId: 18,
      source: DEFAULT_SELECTED_TAB_SOURCE,
      updatedAt: '2026-05-24T00:01:00.000Z',
    });

    expect(storage.get('agentV2.sessionSelectedTabs:session-a')).toEqual({
      sessionId: 'session-a',
      selectedTabIds: [11],
      primaryTabId: 11,
      source: DEFAULT_SELECTED_TAB_SOURCE,
      updatedAt: '2026-05-24T00:00:00.000Z',
    });
    expect(storage.get('agentV2.sessionSelectedTabs:session-b')).toEqual({
      sessionId: 'session-b',
      selectedTabIds: [18],
      primaryTabId: 18,
      source: DEFAULT_SELECTED_TAB_SOURCE,
      updatedAt: '2026-05-24T00:01:00.000Z',
    });
  });
});
