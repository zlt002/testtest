import type { PickedElementContext } from '@/entrypoints/lib/page-picker';
import type { CaptureSessionMeta } from '@mcp-b/dom-analysis-contracts';

export const DOM_ANALYSIS_SESSION_TTL_MS = 5 * 60 * 1000;
export type DomAnalysisSessionMode =
  | 'interactive'
  | 'selection-interactive'
  | 'selection-display';

export type DomAnalysisSession = {
  sessionId: string;
  tabId: number;
  mode: DomAnalysisSessionMode;
  startedAt: number;
  capturedAt: number | null;
  targetElement: PickedElementContext | null;
};

type StartSessionInput = {
  tabId: number;
  mode?: DomAnalysisSessionMode;
  startedAt?: number;
  targetElement?: PickedElementContext | null;
};

type CompleteSessionInput = {
  capturedAt?: number;
  targetElement: PickedElementContext;
};

type CreateDomAnalysisSessionStoreOptions = {
  createId?: () => string;
  now?: () => number;
  ttlMs?: number;
};

export type DomAnalysisSessionStore = ReturnType<typeof createDomAnalysisSessionStore>;

export function normalizeDomAnalysisCaptureSessionMode(
  mode: DomAnalysisSessionMode | CaptureSessionMeta['mode']
): CaptureSessionMeta['mode'] {
  if (mode === 'selection-interactive' || mode === 'selection-display') {
    return 'interactive';
  }

  return mode;
}

export function createDomAnalysisSessionStore(
  options: CreateDomAnalysisSessionStoreOptions = {}
) {
  const sessions = new Map<string, DomAnalysisSession>();
  const createId = options.createId ?? (() => crypto.randomUUID());
  const now = options.now ?? (() => Date.now());
  const ttlMs = options.ttlMs ?? DOM_ANALYSIS_SESSION_TTL_MS;

  const cleanupExpiredSessions = (currentTime = now()) => {
    for (const [sessionId, session] of sessions.entries()) {
      if (currentTime - session.startedAt > ttlMs) {
        sessions.delete(sessionId);
      }
    }
  };

  return {
    startSession(input: StartSessionInput): DomAnalysisSession {
      cleanupExpiredSessions(input.startedAt ?? now());
      const session: DomAnalysisSession = {
        sessionId: createId(),
        tabId: input.tabId,
        mode: input.mode ?? 'interactive',
        startedAt: input.startedAt ?? now(),
        capturedAt: null,
        targetElement: input.targetElement ?? null,
      };
      sessions.set(session.sessionId, session);
      return session;
    },

    completeSession(sessionId: string, input: CompleteSessionInput): CaptureSessionMeta {
      cleanupExpiredSessions(input.capturedAt ?? now());
      const session = sessions.get(sessionId);
      if (!session) {
        throw new Error(`未找到 DOM 分析会话: ${sessionId}`);
      }

      session.capturedAt = input.capturedAt ?? now();
      session.targetElement = input.targetElement;

      return {
        sessionId: session.sessionId,
        tabId: session.tabId,
        capturedAt: session.capturedAt,
        mode: normalizeDomAnalysisCaptureSessionMode(session.mode),
      };
    },

    getSession(sessionId: string): DomAnalysisSession | undefined {
      cleanupExpiredSessions();
      return sessions.get(sessionId);
    },

    listSessions(): DomAnalysisSession[] {
      cleanupExpiredSessions();
      return Array.from(sessions.values());
    },

    deleteSession(sessionId: string): void {
      sessions.delete(sessionId);
    },
  };
}

export const domAnalysisSessionStore = createDomAnalysisSessionStore();
