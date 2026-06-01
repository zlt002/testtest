import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { clearAgentV2ActiveRunSession, publishAgentV2ActiveRunSession } from './active-run-session';
import { createAgentV2Client, normalizeRunAttachmentsForRequest } from './client';
import { projectAgentEventsToMessages, projectToolDisplayRecords } from './project-events';
import {
  attachSubagentsToConversationItems,
  projectConversationRunItems,
  summarizeSubagentWaitingState,
} from './run-cards';
import { localizeUserFacingError, localizeUserFacingMessage } from '../user-facing-error';
import {
  buildWebEditWorkflowInstruction,
  isWebEditBrowserContext,
  resolveWebEditPromptMode,
} from './webeditPrompt';
import type {
  AgentV2StopReason,
  AgentEvent,
  BrowserContext,
  DisplayMessage,
  ImageAttachment,
  InteractionDecision,
  SessionRunStateRecord,
  SessionSubagentSnapshot,
  SessionAttachment,
  SessionHistoryResponse,
} from './types';
import type { ThinkingMode } from './types';

export type AgentV2ChatStatus = 'idle' | 'connecting' | 'streaming' | 'error';

const DEFAULT_CONTEXT_WINDOW = 160000;

function tokenCountFromUsage(value: unknown): number {
  if (!value || typeof value !== 'object') {
    return 0;
  }

  const usage = value as Record<string, unknown>;
  const tokenValues = [
    usage.input_tokens,
    usage.cache_creation_input_tokens,
    usage.cache_read_input_tokens,
    usage.output_tokens,
  ];
  return tokenValues.reduce<number>((total, tokenValue) => {
    return total + (typeof tokenValue === 'number' && Number.isFinite(tokenValue) ? tokenValue : 0);
  }, 0);
}

function attachmentsToDisplayImages(
  attachments: SessionAttachment[] | undefined
): ImageAttachment[] | undefined {
  const images = (attachments || [])
    .filter(
      (attachment) =>
        attachment.kind === 'image' &&
        attachment.mimeType.startsWith('image/') &&
        ((typeof attachment.previewUrl === 'string' && attachment.previewUrl.length > 0) ||
          (typeof attachment.data === 'string' && attachment.data.length > 0))
    )
    .map((attachment) => ({
      id: attachment.id,
      name: attachment.name,
      mimeType: attachment.mimeType,
      ...(typeof attachment.previewUrl === 'string' && attachment.previewUrl.length > 0
        ? { previewUrl: attachment.previewUrl }
        : {}),
      ...(typeof attachment.data === 'string' && attachment.data.length > 0
        ? { data: attachment.data }
        : {}),
    }));

  return images.length > 0 ? images : undefined;
}

function activeRunStatusFromEvent(event: AgentEvent): 'connecting' | 'streaming' {
  return event.type === 'run.started' || event.type === 'session.bound'
    ? 'connecting'
    : 'streaming';
}

function isTerminalRunEvent(event: AgentEvent): boolean {
  return (
    event.type === 'run.completed' || event.type === 'run.failed' || event.type === 'run.aborted'
  );
}

export function useAgentV2Chat(options: { baseUrl: string; endpoint: string }) {
  const { baseUrl, endpoint } = options;
  const client = useMemo(() => createAgentV2Client({ baseUrl, endpoint }), [baseUrl, endpoint]);
  const [status, setStatus] = useState<AgentV2ChatStatus>('idle');
  const [error, setError] = useState<string | null>(null);
  const [localMessages, setLocalMessages] = useState<DisplayMessage[]>([]);
  const [events, setEvents] = useState<AgentEvent[]>([]);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [activeRunId, setActiveRunId] = useState<string | null>(null);
  const [subagentRunId, setSubagentRunId] = useState<string | null>(null);
  const [activeProjectPath, setActiveProjectPath] = useState<string | null>(null);
  const [activeRunStartedAt, setActiveRunStartedAt] = useState<string | null>(null);
  const [subagents, setSubagents] = useState<SessionSubagentSnapshot[]>([]);
  const abortControllerRef = useRef<AbortController | null>(null);
  const autoStoppedRunIdRef = useRef<string | null>(null);
  const eventsRef = useRef<AgentEvent[]>([]);

  const eventMessages = useMemo(() => projectAgentEventsToMessages(events), [events]);
  const allMessages = useMemo(
    () => [...localMessages, ...eventMessages],
    [localMessages, eventMessages]
  );
  const messages = useMemo(
    () =>
      allMessages
        .filter(
          (message) =>
            message.kind !== 'run_status' &&
            message.kind !== 'tool_call' &&
            message.kind !== 'tool_result'
        )
        .sort((a, b) => {
          const timeDelta = new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime();
          if (timeDelta !== 0) {
            return timeDelta;
          }
          return (a.sequence ?? 0) - (b.sequence ?? 0);
        }),
    [allMessages]
  );
  const tools = useMemo(() => projectToolDisplayRecords(allMessages), [allMessages]);
  const conversationItems = useMemo(
    () =>
      attachSubagentsToConversationItems({
        items: projectConversationRunItems(allMessages),
        runId: subagentRunId,
        subagents,
      }),
    [allMessages, subagentRunId, subagents]
  );
  const activeRunLastActivityAt = useMemo(() => {
    if (!activeRunId) {
      return null;
    }

    let latest = 0;
    for (const event of events) {
      if (event.runId !== activeRunId || isTerminalRunEvent(event)) {
        continue;
      }
      latest = Math.max(latest, new Date(event.timestamp).getTime());
    }

    return latest > 0 ? new Date(latest).toISOString() : activeRunStartedAt;
  }, [activeRunId, activeRunStartedAt, events]);
  const contextPercent = useMemo(() => {
    const tokenTotal = events.reduce((total, event) => {
      if (event.type !== 'run.completed' && event.type !== 'usage.updated') {
        return total;
      }
      return total + tokenCountFromUsage(event.payload.usage);
    }, 0);
    return Math.min(100, (tokenTotal / DEFAULT_CONTEXT_WINDOW) * 100);
  }, [events]);

  useEffect(() => {
    eventsRef.current = events;
  }, [events]);

  const reset = useCallback(() => {
    abortControllerRef.current?.abort();
    abortControllerRef.current = null;
    setStatus('idle');
    setError(null);
    setLocalMessages([]);
    setEvents([]);
    eventsRef.current = [];
    setSessionId(null);
    setActiveRunId(null);
    setSubagentRunId(null);
    setActiveProjectPath(null);
    setActiveRunStartedAt(null);
    setSubagents([]);
    autoStoppedRunIdRef.current = null;
  }, []);

  const loadHistory = useCallback((history: SessionHistoryResponse) => {
    abortControllerRef.current?.abort();
    abortControllerRef.current = null;
    setStatus('idle');
    setError(null);
    setLocalMessages(history.messages);
    setEvents([]);
    eventsRef.current = [];
    setSessionId(history.sessionId);
    setActiveRunId(null);
    setSubagentRunId(null);
    setActiveProjectPath(null);
    setSubagents([]);
    setActiveRunStartedAt(null);
    autoStoppedRunIdRef.current = null;
  }, []);

  const restoreSessionRunState = useCallback((runState: SessionRunStateRecord | null) => {
    if (!runState?.hasActiveStream) {
      setActiveRunId(null);
      setStatus('idle');
      autoStoppedRunIdRef.current = null;
      void clearAgentV2ActiveRunSession();
      return;
    }

    setSessionId(runState.sessionId);
    setActiveRunId(runState.runId);
    setSubagentRunId(runState.runId);
    setActiveProjectPath(runState.projectPath || null);
    setActiveRunStartedAt(runState.startedAt);
    setError(null);
    autoStoppedRunIdRef.current = null;
    const activeStatus = runState.status === 'connecting' ? 'connecting' : 'streaming';
    setStatus(activeStatus);
    void publishAgentV2ActiveRunSession({
      sessionId: runState.sessionId,
      projectPath: runState.projectPath,
      runId: runState.runId,
      status: activeStatus,
      updatedAt: new Date().toISOString(),
    });
  }, []);

  const processIncomingEvent = useCallback(
    (
      event: AgentEvent,
      input?: {
        projectPath?: string;
        localAssistantId?: string;
        localUserId?: string;
      }
    ) => {
      if (input?.localAssistantId) {
        setLocalMessages((current) =>
          current.filter((message) => message.id !== input.localAssistantId)
        );
      }
      setStatus(activeRunStatusFromEvent(event));
      setEvents((current) => {
        if (current.some((existing) => existing.eventId === event.eventId)) {
          return current;
        }
        const next = [...current, event];
        eventsRef.current = next;
        return next;
      });
      if (event.runId && event.sessionId && !isTerminalRunEvent(event)) {
        void publishAgentV2ActiveRunSession({
          sessionId: event.sessionId,
          projectPath: input?.projectPath,
          runId: event.runId,
          status: activeRunStatusFromEvent(event),
          updatedAt: new Date().toISOString(),
        });
      }
      if (event.runId) {
        setActiveRunId(event.runId);
        setSubagentRunId(event.runId);
        if (event.type === 'run.started') {
          setActiveRunStartedAt(event.timestamp);
        }
        if (input?.localUserId) {
          setLocalMessages((current) =>
            current.map((message) =>
              message.id === input.localUserId && !message.runId
                ? {
                    ...message,
                    runId: event.runId,
                    sessionId: event.sessionId || message.sessionId,
                  }
                : message
            )
          );
        }
      }
      if (event.sessionId) {
        setSessionId(event.sessionId);
      }
      if (event.type === 'run.completed' || event.type === 'run.aborted') {
        setStatus('idle');
        setActiveRunId(null);
        autoStoppedRunIdRef.current = null;
        void clearAgentV2ActiveRunSession();
      }
      if (event.type === 'run.failed') {
        setStatus('error');
        setActiveRunId(null);
        autoStoppedRunIdRef.current = null;
        void clearAgentV2ActiveRunSession();
        const authGuidance =
          typeof event.payload.authGuidance === 'string' ? event.payload.authGuidance : null;
        setError(
          authGuidance ||
            localizeUserFacingMessage(
              typeof event.payload.error === 'string' ? event.payload.error : 'Agent run failed'
            )
        );
      }
    },
    []
  );

  const appendAssistantMessage = useCallback(
    (text: string) => {
      const content = text.trim();
      if (!content) {
        return;
      }

      setLocalMessages((current) => [
        ...current,
        {
          id: `local-assistant-${crypto.randomUUID()}`,
          sessionId: sessionId || '',
          role: 'assistant',
          kind: 'text',
          text: content,
          timestamp: new Date().toISOString(),
        },
      ]);
    },
    [sessionId]
  );

  const sendMessage = useCallback(
    async (
      prompt: string,
      input?: {
        browserContext?: BrowserContext;
        projectPath?: string;
        preferredBrowserTool?: string;
        permissionMode?: 'default' | 'plan' | 'acceptEdits' | 'bypassPermissions';
        effort?: ThinkingMode;
        attachments?: SessionAttachment[];
        images?: ImageAttachment[];
      }
    ) => {
      const trimmed = prompt.trim();
      if (!trimmed || status === 'connecting' || status === 'streaming') {
        return;
      }

      const runPrompt = (() => {
        if (!input?.browserContext) {
          return trimmed;
        }

        const toolName =
          input.preferredBrowserTool || 'mcp__browser_extension__read_current_page_content';
        const blocks =
          input.browserContext.source === 'selected-tabs'
            ? [
                '<webmcp_browser_tool_instruction>',
                '当前请求来自浏览器 sidepanel，并带有用户显式勾选的 tabs 上下文。',
                `如果用户要求读取、总结、检查、操作这些已勾选页面，优先使用 ${toolName}，并将操作限制在 browser_context.allowedTabIds 内。`,
                '如果目标标签页不在 browser_context.allowedTabIds 中，先停止执行并提醒用户勾选对应标签页。',
                `不要把这些页面 URL 当作普通远程网页去 WebFetch，除非 ${toolName} 调用失败。`,
                '</webmcp_browser_tool_instruction>',
              ]
            : [
                '<webmcp_browser_tool_instruction>',
                '当前请求来自浏览器 sidepanel，并带有当前 tab 上下文。',
                `如果用户要求读取、总结、检查、操作“当前页面”或“当前网页”，优先使用 ${toolName}，并传入 browser_context 里的 tabId/windowId。`,
                `不要把当前页面 URL 当作普通远程网页去 WebFetch，除非 ${toolName} 调用失败。`,
                '</webmcp_browser_tool_instruction>',
              ];

        if (
          input.browserContext.source !== 'selected-tabs' &&
          isWebEditBrowserContext(input.browserContext)
        ) {
          const webEditPromptMode = resolveWebEditPromptMode(input.browserContext, trimmed);
          if (webEditPromptMode !== 'none') {
            blocks.push(buildWebEditWorkflowInstruction(input.browserContext, webEditPromptMode));
          }
        }

        return [blocks.join('\n'), '', trimmed].join('\n');
      })();

      const controller = new AbortController();
      const attachments = normalizeRunAttachmentsForRequest(input);
      const displayImages = input?.images?.length
        ? input.images
        : attachmentsToDisplayImages(attachments);
      abortControllerRef.current = controller;
      setActiveProjectPath(input?.projectPath || null);
      setActiveRunStartedAt(new Date().toISOString());
      setSubagents([]);
      setSubagentRunId(null);
      autoStoppedRunIdRef.current = null;
      const localUserId = `local-user-${crypto.randomUUID()}`;
      const localAssistantId = `local-assistant-${crypto.randomUUID()}`;
      let hasReceivedEvent = false;
      setStatus('connecting');
      setError(null);
      setLocalMessages((current) => [
        ...current,
        {
          id: localUserId,
          sessionId: sessionId || '',
          role: 'user',
          kind: 'text',
          text: trimmed,
          images: displayImages,
          timestamp: new Date().toISOString(),
        },
        {
          id: localAssistantId,
          sessionId: sessionId || '',
          role: 'assistant',
          kind: 'text',
          text: '姝ｅ湪澶勭悊...',
          timestamp: new Date().toISOString(),
        },
      ]);

      const onEvent = (event: AgentEvent) => {
        if (controller.signal.aborted) {
          return;
        }

        hasReceivedEvent = true;
        processIncomingEvent(event, {
          projectPath: input?.projectPath,
          localAssistantId,
          localUserId,
        });
      };

      try {
        if (sessionId) {
          await client.continueRun(
            {
              sessionId,
              prompt: runPrompt,
              browserContext: input?.browserContext,
              projectPath: input?.projectPath,
              permissionMode: input?.permissionMode,
              effort: input?.effort,
              attachments,
              signal: controller.signal,
            },
            onEvent
          );
        } else {
          await client.startRun(
            {
              prompt: runPrompt,
              browserContext: input?.browserContext,
              projectPath: input?.projectPath,
              permissionMode: input?.permissionMode,
              effort: input?.effort,
              attachments,
              signal: controller.signal,
            },
            onEvent
          );
        }
        setStatus((current) => (current === 'error' ? current : 'idle'));
      } catch (runError) {
        if (controller.signal.aborted) {
          setLocalMessages((current) =>
            current.filter((message) => message.id !== localAssistantId)
          );
          setActiveRunId(null);
          setStatus('idle');
          await clearAgentV2ActiveRunSession().catch((clearError) => {
            console.debug('[agent-v2] failed to clear active run session after abort:', clearError);
          });
          return;
        }
        setLocalMessages((current) => current.filter((message) => message.id !== localAssistantId));
        setStatus('error');
        setError(localizeUserFacingError(runError));
      } finally {
        if (!hasReceivedEvent) {
          setLocalMessages((current) =>
            current.filter((message) => message.id !== localAssistantId)
          );
        }
        if (abortControllerRef.current === controller) {
          abortControllerRef.current = null;
        }
      }
    },
    [client, processIncomingEvent, sessionId, status]
  );

  const resumeRun = useCallback(
    async (runState: SessionRunStateRecord | null) => {
      if (!runState?.hasActiveStream) {
        return;
      }

      abortControllerRef.current?.abort();
      const controller = new AbortController();
      abortControllerRef.current = controller;
      setError(null);

      const afterSequence = eventsRef.current
        .filter((event) => event.runId === runState.runId)
        .reduce((maxSequence, event) => Math.max(maxSequence, event.sequence), 0);

      try {
        await client.resumeRunStream(
          runState.runId,
          {
            afterSequence,
            signal: controller.signal,
          },
          (event) => {
            if (controller.signal.aborted) {
              return;
            }
            processIncomingEvent(event, {
              projectPath: runState.projectPath,
            });
          }
        );
        setStatus((current) => (current === 'error' ? current : 'idle'));
      } catch (runError) {
        if (controller.signal.aborted) {
          setActiveRunId(null);
          setStatus('idle');
          await clearAgentV2ActiveRunSession().catch((clearError) => {
            console.debug('[agent-v2] failed to clear active run session after resume abort:', clearError);
          });
          return;
        }
        setStatus('error');
        setError(localizeUserFacingError(runError));
      } finally {
        if (abortControllerRef.current === controller) {
          abortControllerRef.current = null;
        }
      }
    },
    [client, processIncomingEvent]
  );

  useEffect(() => {
    if (!sessionId || !activeProjectPath || !activeRunId) {
      return;
    }

    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | null = null;
    let cancelled = false;

    const poll = async () => {
      try {
        const response = await client.getSessionSubagents(sessionId, {
          projectPath: activeProjectPath,
          signal: controller.signal,
        });
        if (!cancelled) {
          const startedAtMs = activeRunStartedAt ? new Date(activeRunStartedAt).getTime() : 0;
          setSubagents(
            response.subagents.filter((subagent) => {
              const candidate = subagent.startedAt || subagent.updatedAt;
              const candidateMs = candidate ? new Date(candidate).getTime() : 0;
              return !startedAtMs || candidateMs >= startedAtMs;
            })
          );
        }
      } catch (error) {
        if (!controller.signal.aborted) {
          console.debug('[agent-v2] failed to poll subagents:', error);
        }
      } finally {
        if (!cancelled) {
          timer = setTimeout(() => {
            void poll();
          }, 1500);
        }
      }
    };

    void poll();
    return () => {
      cancelled = true;
      controller.abort();
      if (timer) {
        clearTimeout(timer);
      }
    };
  }, [activeProjectPath, activeRunId, activeRunStartedAt, client, sessionId]);

  const stop = useCallback(
    async (reason?: AgentV2StopReason) => {
      abortControllerRef.current?.abort();
      if (activeRunId) {
        await Promise.resolve(client.abortRun(activeRunId)).catch((abortError) => {
          console.debug('[agent-v2] abort failed:', abortError);
        });
      }
      setActiveRunId(null);
      setStatus('idle');
      await clearAgentV2ActiveRunSession().catch((clearError) => {
        console.debug('[agent-v2] failed to clear active run session on stop:', clearError);
      });
      if (reason === 'window_takeover_user_left') {
        setError('当前运行因离开目标页面而中断');
      } else if (reason === 'subagent_timeout') {
        setError('检测到子代理持续失联，系统已自动停止当前运行，避免你继续空等。');
      }
    },
    [activeRunId, client]
  );

  useEffect(() => {
    if (!activeRunId || (status !== 'connecting' && status !== 'streaming')) {
      return;
    }

    const waitingSummary = summarizeSubagentWaitingState(subagents, Date.now(), {
      parentLastActivityAt: activeRunLastActivityAt,
    });
    if (!waitingSummary.shouldAutoStop) {
      return;
    }
    if (autoStoppedRunIdRef.current === activeRunId) {
      return;
    }

    autoStoppedRunIdRef.current = activeRunId;
    void stop('subagent_timeout');
  }, [activeRunId, activeRunLastActivityAt, status, stop, subagents]);

  const resolveInteraction = useCallback(
    async (input: { runId: string; requestId: string; decision: InteractionDecision }) => {
      await client.resolveInteraction(input);
    },
    [client]
  );

  return {
    messages,
    tools,
    conversationItems,
    contextPercent,
    status,
    error,
    sessionId,
    activeRunId,
    sendMessage,
    resolveInteraction,
    stop,
    reset,
    loadHistory,
    restoreSessionRunState,
    resumeRun,
    appendAssistantMessage,
  };
}
