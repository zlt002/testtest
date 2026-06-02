// @vitest-environment node

import { act, renderHook, waitFor } from '@testing-library/react';
import { JSDOM } from 'jsdom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AgentEvent } from './types';

const clientMocks = vi.hoisted(() => ({
  startRun: vi.fn(),
  continueRun: vi.fn(),
  resumeRunStream: vi.fn(),
  getSessionSubagents: vi.fn(async () => ({ sessionId: 'session-1', subagents: [] })),
  abortRun: vi.fn(async () => undefined),
}));

const activeRunSessionMocks = vi.hoisted(() => ({
  publishAgentV2ActiveRunSession: vi.fn(async () => undefined),
  clearAgentV2ActiveRunSession: vi.fn(async () => undefined),
}));

vi.mock('./client', async () => {
  const actual = await vi.importActual<typeof import('./client')>('./client');
  return {
    ...actual,
    createAgentV2Client: () => ({
      startRun: clientMocks.startRun,
      continueRun: clientMocks.continueRun,
      resumeRunStream: clientMocks.resumeRunStream,
      getSessionSubagents: clientMocks.getSessionSubagents,
      abortRun: clientMocks.abortRun,
    }),
  };
});

vi.mock('./active-run-session', () => ({
  publishAgentV2ActiveRunSession: activeRunSessionMocks.publishAgentV2ActiveRunSession,
  clearAgentV2ActiveRunSession: activeRunSessionMocks.clearAgentV2ActiveRunSession,
}));

import { useAgentV2Chat } from './useAgentV2Chat';

describe('useAgentV2Chat', () => {
  const dom = new JSDOM('<!doctype html><html><body></body></html>', {
    url: 'https://example.com',
  });

  vi.stubGlobal('TextEncoder', globalThis.TextEncoder);
  vi.stubGlobal('TextDecoder', globalThis.TextDecoder);
  vi.stubGlobal('window', dom.window);
  vi.stubGlobal('document', dom.window.document);
  vi.stubGlobal('navigator', dom.window.navigator);
  vi.stubGlobal('HTMLElement', dom.window.HTMLElement);
  vi.stubGlobal('crypto', dom.window.crypto);

  beforeEach(() => {
    vi.clearAllMocks();
    clientMocks.resumeRunStream.mockReset();
    clientMocks.getSessionSubagents.mockResolvedValue({ sessionId: 'session-1', subagents: [] });
  });

  it('prefers structured auth guidance over upstream 403 details', async () => {
    clientMocks.startRun.mockImplementationOnce(
      async (_input: unknown, onEvent: (event: AgentEvent) => void) => {
        onEvent({
          eventId: 'event-1',
          runId: 'run-1',
          sessionId: 'session-1',
          sequence: 1,
          type: 'run.failed',
          timestamp: '2026-05-20T10:00:00.000Z',
          payload: {
            error:
              'Failed to authenticate. API Error: 403 {"error":{"type":"forbidden","message":"Request not allowed"}}',
            authGuidance:
              '当前未检测到本地 Claude Code，请联系管理员申请官方模型 Key，并在侧边栏模型设置中填写后重试。',
          },
        });
      }
    );

    const { result } = renderHook(() =>
      useAgentV2Chat({ baseUrl: 'http://localhost:3000', endpoint: '/api/agent-v2' })
    );

    await act(async () => {
      await result.current.sendMessage('你好');
    });

    await waitFor(() => {
      expect(result.current.error).toContain('官方模型 Key');
    });
    expect(result.current.error).not.toContain('Request not allowed');
  });

  it('将运行时抛出的英文连接异常转成中文错误', async () => {
    clientMocks.startRun.mockRejectedValueOnce(
      new Error('Could not establish connection. Receiving end does not exist.')
    );

    const { result } = renderHook(() =>
      useAgentV2Chat({ baseUrl: 'http://localhost:3000', endpoint: '/api/agent-v2' })
    );

    await act(async () => {
      await result.current.sendMessage('你好');
    });

    await waitFor(() => {
      expect(result.current.error).toBe('无法连接到目标页面，请刷新页面或重新打开侧边栏后重试。');
    });
  });

  it.each(['run.started', 'session.bound'] as const)(
    'writes connecting active run session state for %s events',
    async (eventType) => {
      clientMocks.startRun.mockImplementationOnce(
        async (_input: unknown, onEvent: (event: AgentEvent) => void) => {
          onEvent({
            eventId: 'event-1',
            runId: 'run-1',
            sessionId: 'session-1',
            sequence: 1,
            type: eventType,
            timestamp: '2026-05-22T10:00:00.000Z',
            payload: {},
          });
        }
      );

      const { result } = renderHook(() =>
        useAgentV2Chat({ baseUrl: 'http://localhost:3000', endpoint: '/api/agent-v2' })
      );

      await act(async () => {
        await result.current.sendMessage('你好', {
          projectPath: '/tmp/project-a',
        });
      });

      await waitFor(() => {
        expect(activeRunSessionMocks.publishAgentV2ActiveRunSession).toHaveBeenCalledWith(
          expect.objectContaining({
            sessionId: 'session-1',
            projectPath: '/tmp/project-a',
            runId: 'run-1',
            status: 'connecting',
          })
        );
      });
    }
  );

  it.each([
    ['run.completed', 'idle'],
    ['run.failed', 'error'],
    ['run.aborted', 'idle'],
  ] as const)('clears active run session for terminal event %s', async (eventType, expectedStatus) => {
    clientMocks.startRun.mockImplementationOnce(
      async (_input: unknown, onEvent: (event: AgentEvent) => void) => {
        onEvent({
          eventId: 'event-1',
          runId: 'run-1',
          sessionId: 'session-1',
          sequence: 1,
          type: eventType,
          timestamp: '2026-05-22T10:00:00.000Z',
          payload: eventType === 'run.failed' ? { error: 'failed' } : {},
        });
      }
    );

    const { result } = renderHook(() =>
      useAgentV2Chat({ baseUrl: 'http://localhost:3000', endpoint: '/api/agent-v2' })
    );

    await act(async () => {
      await result.current.sendMessage('你好');
    });

    await waitFor(() => {
      expect(result.current.status).toBe(expectedStatus);
    });
    expect(activeRunSessionMocks.publishAgentV2ActiveRunSession).not.toHaveBeenCalled();
    expect(activeRunSessionMocks.clearAgentV2ActiveRunSession).toHaveBeenCalled();
  });

  it('restoreSessionRunState writes active run session when restoring a stream', async () => {
    const { result } = renderHook(() =>
      useAgentV2Chat({ baseUrl: 'http://localhost:3000', endpoint: '/api/agent-v2' })
    );

    act(() => {
      result.current.restoreSessionRunState({
        sessionId: 'session-1',
        projectPath: '/tmp/project-a',
        runId: 'run-1',
        status: 'streaming',
        startedAt: '2026-05-22T10:00:00.000Z',
        lastEventAt: '2026-05-22T10:00:01.000Z',
        latestSequence: 2,
        hasActiveStream: true,
      });
    });

    await waitFor(() => {
      expect(activeRunSessionMocks.publishAgentV2ActiveRunSession).toHaveBeenCalledWith(
        expect.objectContaining({
          sessionId: 'session-1',
          projectPath: '/tmp/project-a',
          runId: 'run-1',
          status: 'streaming',
        })
      );
    });
  });

  it('restoreSessionRunState preserves connecting status when restoring a connecting stream', async () => {
    const { result } = renderHook(() =>
      useAgentV2Chat({ baseUrl: 'http://localhost:3000', endpoint: '/api/agent-v2' })
    );

    act(() => {
      result.current.restoreSessionRunState({
        sessionId: 'session-connecting',
        projectPath: '/tmp/project-connecting',
        runId: 'run-connecting',
        status: 'connecting',
        startedAt: '2026-05-22T10:00:00.000Z',
        lastEventAt: '2026-05-22T10:00:01.000Z',
        latestSequence: 1,
        hasActiveStream: true,
      });
    });

    await waitFor(() => {
      expect(result.current.status).toBe('connecting');
    });
    expect(activeRunSessionMocks.publishAgentV2ActiveRunSession).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionId: 'session-connecting',
        projectPath: '/tmp/project-connecting',
        runId: 'run-connecting',
        status: 'connecting',
      })
    );
  });

  it('resumeRun replays buffered events and continues streaming until completion', async () => {
    const runState = {
      sessionId: 'session-restore',
      projectPath: '/tmp/project-restore',
      runId: 'run-restore',
      status: 'streaming' as const,
      startedAt: '2026-05-22T10:00:00.000Z',
      lastEventAt: '2026-05-22T10:00:01.000Z',
      latestSequence: 2,
      hasActiveStream: true,
    };

    clientMocks.resumeRunStream.mockImplementationOnce(
      async (
        runId: string,
        input: { afterSequence?: number },
        onEvent: (event: AgentEvent) => void
      ) => {
        expect(runId).toBe('run-restore');
        expect(input.afterSequence).toBe(0);
        onEvent({
          eventId: 'event-restore-1',
          runId: 'run-restore',
          sessionId: 'session-restore',
          sequence: 1,
          type: 'run.started',
          timestamp: '2026-05-22T10:00:00.000Z',
          payload: {},
        });
        onEvent({
          eventId: 'event-restore-2',
          runId: 'run-restore',
          sessionId: 'session-restore',
          sequence: 2,
          type: 'assistant.message.delta',
          timestamp: '2026-05-22T10:00:01.000Z',
          payload: { text: '恢复中的输出' },
        });
        onEvent({
          eventId: 'event-restore-3',
          runId: 'run-restore',
          sessionId: 'session-restore',
          sequence: 3,
          type: 'run.completed',
          timestamp: '2026-05-22T10:00:02.000Z',
          payload: {},
        });
      }
    );

    const { result } = renderHook(() =>
      useAgentV2Chat({ baseUrl: 'http://localhost:3000', endpoint: '/api/agent-v2' })
    );

    act(() => {
      result.current.restoreSessionRunState(runState);
    });

    await act(async () => {
      await result.current.resumeRun(runState);
    });

    await waitFor(() => {
      expect(result.current.status).toBe('idle');
    });
    expect(clientMocks.resumeRunStream).toHaveBeenCalledWith(
      'run-restore',
      expect.objectContaining({
        afterSequence: 0,
      }),
      expect.any(Function)
    );
    expect(result.current.messages.some((message) => message.text?.includes('恢复中的输出'))).toBe(
      true
    );
    expect(activeRunSessionMocks.clearAgentV2ActiveRunSession).toHaveBeenCalled();
  });

  it('resumeRun shows a localized message when the backend does not support resume streaming', async () => {
    const runState = {
      sessionId: 'session-restore',
      projectPath: '/tmp/project-restore',
      runId: 'run-restore',
      status: 'streaming' as const,
      startedAt: '2026-05-22T10:00:00.000Z',
      lastEventAt: '2026-05-22T10:00:01.000Z',
      latestSequence: 2,
      hasActiveStream: true,
    };

    clientMocks.resumeRunStream.mockRejectedValueOnce(
      new Error('Failed to resume Agent V2 run stream: 404')
    );

    const { result } = renderHook(() =>
      useAgentV2Chat({ baseUrl: 'http://localhost:3000', endpoint: '/api/agent-v2' })
    );

    act(() => {
      result.current.restoreSessionRunState(runState);
    });

    await act(async () => {
      await result.current.resumeRun(runState);
    });

    await waitFor(() => {
      expect(result.current.status).toBe('error');
    });
    expect(result.current.error).toBe('恢复进行中的会话失败，请重启本地服务或稍后重试（状态码 404）。');
  });

  it('restoreSessionRunState clears active run session when no stream exists', async () => {
    const { result } = renderHook(() =>
      useAgentV2Chat({ baseUrl: 'http://localhost:3000', endpoint: '/api/agent-v2' })
    );

    act(() => {
      result.current.restoreSessionRunState(null);
    });

    await waitFor(() => {
      expect(result.current.status).toBe('idle');
    });
    expect(result.current.activeRunId).toBeNull();
    expect(activeRunSessionMocks.clearAgentV2ActiveRunSession).toHaveBeenCalledTimes(1);
    expect(activeRunSessionMocks.publishAgentV2ActiveRunSession).not.toHaveBeenCalled();
  });

  it('stop aborts the current run and clears active run session', async () => {
    clientMocks.startRun.mockImplementationOnce(
      async (input: unknown, onEvent: (event: AgentEvent) => void) => {
        onEvent({
          eventId: 'event-1',
          runId: 'run-1',
          sessionId: 'session-1',
          sequence: 1,
          type: 'run.started',
          timestamp: '2026-05-22T10:00:00.000Z',
          payload: {},
        });

        await new Promise<void>((resolve) => {
          (input as { signal: AbortSignal }).signal.addEventListener('abort', () => resolve(), {
            once: true,
          });
        });

        onEvent({
          eventId: 'event-2',
          runId: 'run-1',
          sessionId: 'session-1',
          sequence: 2,
          type: 'assistant.message.delta',
          timestamp: '2026-05-22T10:00:01.000Z',
          payload: { text: 'late event' },
        });

        throw new Error('aborted');
      }
    );

    const { result } = renderHook(() =>
      useAgentV2Chat({ baseUrl: 'http://localhost:3000', endpoint: '/api/agent-v2' })
    );

    act(() => {
      void result.current.sendMessage('你好');
    });

    await waitFor(() => {
      expect(result.current.activeRunId).toBe('run-1');
    });

    await act(async () => {
      await result.current.stop();
    });

    await waitFor(() => {
      expect(result.current.status).toBe('idle');
    });
    expect(result.current.activeRunId).toBeNull();
    expect(clientMocks.abortRun).toHaveBeenCalledWith('run-1');
    expect(activeRunSessionMocks.publishAgentV2ActiveRunSession).toHaveBeenCalledTimes(1);
    expect(activeRunSessionMocks.clearAgentV2ActiveRunSession).toHaveBeenCalled();
  });

  it('automatically stops the run when all running subagents remain orphaned for too long', async () => {
    const nowSpy = vi.spyOn(Date, 'now').mockReturnValue(
      new Date('2026-05-11T00:02:30.000Z').getTime()
    );
    try {

      clientMocks.startRun.mockImplementationOnce(
        async (input: unknown, onEvent: (event: AgentEvent) => void) => {
          onEvent({
            eventId: 'event-1',
            runId: 'run-1',
            sessionId: 'session-1',
            sequence: 1,
            type: 'run.started',
            timestamp: '2026-05-11T00:00:00.000Z',
            payload: {},
          });

          await new Promise<void>((resolve) => {
            (input as { signal: AbortSignal }).signal.addEventListener('abort', () => resolve(), {
              once: true,
            });
          });

          throw new Error('aborted');
        }
      );
      clientMocks.getSessionSubagents.mockResolvedValue({
        sessionId: 'session-1',
        subagents: [
          {
            agentId: 'agent-1',
            title: 'Search metrics',
            status: 'running',
            startedAt: '2026-05-11T00:00:00.000Z',
            updatedAt: '2026-05-11T00:00:10.000Z',
            latestSummary: '正在搜索资料',
            latestToolName: 'WebSearch',
            messageCount: 3,
            toolCount: 10,
            activities: [],
          },
        ],
      });

      const { result } = renderHook(() =>
        useAgentV2Chat({ baseUrl: 'http://localhost:3000', endpoint: '/api/agent-v2' })
      );

      act(() => {
        void result.current.sendMessage('继续执行', {
          projectPath: '/tmp/project-subagent-timeout',
        });
      });

      await waitFor(() => {
        expect(result.current.activeRunId).toBe('run-1');
      });

      await waitFor(() => {
        expect(result.current.activeRunId).toBeNull();
      });
      expect(clientMocks.abortRun).toHaveBeenCalledWith('run-1');
      expect(result.current.error).toContain('自动停止当前运行');
    } finally {
      nowSpy.mockRestore();
    }
  });

  it('does not auto-stop when the parent run has newer activity than the orphaned subagent', async () => {
    const nowSpy = vi.spyOn(Date, 'now').mockReturnValue(
      new Date('2026-05-11T00:02:30.000Z').getTime()
    );
    try {
      clientMocks.startRun.mockImplementationOnce(
        async (_input: unknown, onEvent: (event: AgentEvent) => void) => {
          onEvent({
            eventId: 'event-1',
            runId: 'run-1',
            sessionId: 'session-1',
            sequence: 1,
            type: 'run.started',
            timestamp: '2026-05-11T00:00:00.000Z',
            payload: {},
          });
          onEvent({
            eventId: 'event-2',
            runId: 'run-1',
            sessionId: 'session-1',
            sequence: 2,
            type: 'assistant.message.delta',
            timestamp: '2026-05-11T00:02:20.000Z',
            payload: { delta: '父代理继续整理主结果' },
          });

          await new Promise(() => {
            // keep stream open for assertion window
          });
        }
      );
      clientMocks.getSessionSubagents.mockResolvedValue({
        sessionId: 'session-1',
        subagents: [
          {
            agentId: 'agent-1',
            title: 'Search metrics',
            status: 'running',
            startedAt: '2026-05-11T00:00:00.000Z',
            updatedAt: '2026-05-11T00:00:10.000Z',
            latestSummary: '正在搜索资料',
            latestToolName: 'WebSearch',
            messageCount: 3,
            toolCount: 10,
            activities: [],
          },
        ],
      });

      const { result } = renderHook(() =>
        useAgentV2Chat({ baseUrl: 'http://localhost:3000', endpoint: '/api/agent-v2' })
      );

      act(() => {
        void result.current.sendMessage('继续执行', {
          projectPath: '/tmp/project-parent-progress',
        });
      });

      await waitFor(() => {
        expect(result.current.activeRunId).toBe('run-1');
      });

      await new Promise((resolve) => setTimeout(resolve, 50));

      expect(clientMocks.abortRun).not.toHaveBeenCalledWith('run-1');
      expect(result.current.error).toBeNull();
      expect(result.current.activeRunId).toBe('run-1');
    } finally {
      nowSpy.mockRestore();
    }
  });

  it('keeps uploaded image preview URLs on local user messages', async () => {
    clientMocks.startRun.mockImplementationOnce(async () => undefined);

    const { result } = renderHook(() =>
      useAgentV2Chat({ baseUrl: 'http://localhost:3000', endpoint: '/api/agent-v2' })
    );

    await act(async () => {
      await result.current.sendMessage('分析这张截图', {
        attachments: [
          {
            id: 'attachment-1',
            sessionFileId: 'session-file-1',
            name: 'screenshot.png',
            mimeType: 'image/png',
            size: 1234,
            kind: 'image',
            storage: 'uploaded',
            previewUrl: 'blob:https://example.com/screenshot-1',
          },
        ],
      });
    });

    expect(result.current.messages[0]).toMatchObject({
      role: 'user',
      text: '分析这张截图',
      images: [
        {
          id: 'attachment-1',
          name: 'screenshot.png',
          mimeType: 'image/png',
          previewUrl: 'blob:https://example.com/screenshot-1',
        },
      ],
    });
  });

  it('keeps uploaded document attachments on local user messages', async () => {
    clientMocks.startRun.mockImplementationOnce(async () => undefined);

    const { result } = renderHook(() =>
      useAgentV2Chat({ baseUrl: 'http://localhost:3000', endpoint: '/api/agent-v2' })
    );

    await act(async () => {
      await result.current.sendMessage('看看这个文档内容', {
        attachments: [
          {
            id: 'attachment-doc-1',
            sessionFileId: 'session-file-doc-1',
            name: '功能说明.docx',
            mimeType:
              'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
            size: 345678,
            kind: 'document',
            storage: 'uploaded',
          },
        ],
      });
    });

    expect(result.current.messages[0]).toMatchObject({
      role: 'user',
      text: '看看这个文档内容',
      attachments: [
        {
          id: 'attachment-doc-1',
          name: '功能说明.docx',
          mimeType:
            'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
          size: 345678,
          kind: 'document',
        },
      ],
    });
  });

  it('shows a local assistant placeholder before the first run event arrives', async () => {
    let resolveStartRun: (() => void) | null = null;
    clientMocks.startRun.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          resolveStartRun = resolve;
        })
    );

    const { result } = renderHook(() =>
      useAgentV2Chat({ baseUrl: 'http://localhost:3000', endpoint: '/api/agent-v2' })
    );

    act(() => {
      void result.current.sendMessage('浣犲ソ');
    });

    await waitFor(() => {
      expect(result.current.messages).toHaveLength(2);
    });
    expect(result.current.messages[0]).toMatchObject({
      role: 'user',
      text: '浣犲ソ',
    });
    expect(result.current.messages[1]).toMatchObject({
      role: 'assistant',
      text: '姝ｅ湪澶勭悊...',
    });

    await act(async () => {
      resolveStartRun?.();
    });
  });

  it('builds selected-tab browser instructions from explicit tab context', async () => {
    clientMocks.startRun.mockImplementationOnce(async () => undefined);

    const { result } = renderHook(() =>
      useAgentV2Chat({ baseUrl: 'http://localhost:3000', endpoint: '/api/agent-v2' })
    );

    await act(async () => {
      await result.current.sendMessage('总结这些标签页', {
        browserContext: {
          source: 'selected-tabs',
          tabId: 12,
          windowId: 3,
          title: 'GitHub',
          url: 'https://github.com',
          primaryTabId: 12,
          allowedTabIds: [11, 12],
          selectedTabs: [
            {
              tabId: 11,
              windowId: 3,
              title: 'Baidu',
              url: 'https://www.baidu.com',
            },
            {
              tabId: 12,
              windowId: 3,
              title: 'GitHub',
              url: 'https://github.com',
            },
          ],
        },
      });
    });

    expect(clientMocks.startRun).toHaveBeenCalledTimes(1);
    const startRunInput = clientMocks.startRun.mock.calls[0]?.[0] as { prompt: string };
    expect(startRunInput.prompt).toContain('显式勾选');
    expect(startRunInput.prompt).toContain('allowedTabIds');
    expect(startRunInput.prompt).not.toContain('当前 tab 上下文');
  });

  it('does not append single-tab webedit workflow instructions in selected-tabs mode', async () => {
    clientMocks.startRun.mockImplementationOnce(async () => undefined);

    const { result } = renderHook(() =>
      useAgentV2Chat({ baseUrl: 'http://localhost:3000', endpoint: '/api/agent-v2' })
    );

    await act(async () => {
      await result.current.sendMessage('请帮我继续处理这些已勾选页面', {
        browserContext: {
          source: 'selected-tabs',
          tabId: 12,
          windowId: 3,
          title: 'WebEdit',
          url: 'https://webedit.midea.com/moewebv7/document-cloud?editId=current',
          primaryTabId: 12,
          allowedTabIds: [11, 12],
          selectedTabs: [
            {
              tabId: 12,
              windowId: 3,
              title: 'WebEdit',
              url: 'https://webedit.midea.com/moewebv7/document-cloud?editId=current',
            },
          ],
        },
      });
    });

    const startRunInput = clientMocks.startRun.mock.calls[0]?.[0] as { prompt: string };
    expect(startRunInput.prompt).toContain('显式勾选');
    expect(startRunInput.prompt).not.toContain('当前标签页');
    expect(startRunInput.prompt).not.toContain('browser_context.tabId/windowId');
  });
});
