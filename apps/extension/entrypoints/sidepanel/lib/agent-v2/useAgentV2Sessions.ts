import { useCallback, useMemo, useRef, useState } from 'react';
import { createAgentV2Client } from './client';
import type { ClaudeProjectSummary, ClaudeSessionSummary, SessionHistoryResponse } from './types';

export type AgentV2SessionsStatus = 'idle' | 'loading' | 'error';

export function useAgentV2Sessions(options: { baseUrl: string; endpoint: string }) {
  const { baseUrl, endpoint } = options;
  const client = useMemo(() => createAgentV2Client({ baseUrl, endpoint }), [baseUrl, endpoint]);
  const [projects, setProjects] = useState<ClaudeProjectSummary[]>([]);
  const [sessions, setSessions] = useState<ClaudeSessionSummary[]>([]);
  const [status, setStatus] = useState<AgentV2SessionsStatus>('idle');
  const [error, setError] = useState<string | null>(null);
  const sessionsRequestIdRef = useRef(0);
  const projectsRequestIdRef = useRef(0);
  const historyRequestIdRef = useRef(0);

  const refresh = useCallback(
    async (input?: { projectPath?: string; signal?: AbortSignal }) => {
      const requestId = ++sessionsRequestIdRef.current;
      setStatus('loading');
      setError(null);
      try {
        const nextSessions = await client.listProjectSessions(input);
        if (sessionsRequestIdRef.current === requestId) {
          setSessions(nextSessions);
          setStatus('idle');
        }
      } catch (refreshError) {
        if (input?.signal?.aborted || sessionsRequestIdRef.current !== requestId) {
          return;
        }
        setStatus('error');
        setError(refreshError instanceof Error ? refreshError.message : String(refreshError));
      }
    },
    [client]
  );

  const refreshProjects = useCallback(
    async (input?: { forceRefresh?: boolean }) => {
      const requestId = ++projectsRequestIdRef.current;
      setStatus('loading');
      setError(null);
      try {
        const nextProjects = await client.listProjects(input);
        if (projectsRequestIdRef.current === requestId) {
          setProjects(nextProjects);
          setStatus('idle');
        }
      } catch (refreshError) {
        if (projectsRequestIdRef.current !== requestId) {
          return;
        }
        setStatus('error');
        setError(refreshError instanceof Error ? refreshError.message : String(refreshError));
      }
    },
    [client]
  );

  const clearSessions = useCallback(() => {
    sessionsRequestIdRef.current += 1;
    setSessions([]);
  }, []);

  const loadHistory = useCallback(
    async (
      sessionId: string,
      input?: { projectPath?: string }
    ): Promise<SessionHistoryResponse | null> => {
      const requestId = ++historyRequestIdRef.current;
      setStatus('loading');
      setError(null);
      try {
        const history = await client.getSessionHistory(sessionId, input);
        if (historyRequestIdRef.current === requestId) {
          setStatus('idle');
        }
        return history;
      } catch (historyError) {
        if (historyRequestIdRef.current !== requestId) {
          return null;
        }
        setStatus('error');
        setError(historyError instanceof Error ? historyError.message : String(historyError));
        return null;
      }
    },
    [client]
  );

  return {
    projects,
    sessions,
    status,
    error,
    refresh,
    refreshProjects,
    clearSessions,
    loadHistory,
  };
}
