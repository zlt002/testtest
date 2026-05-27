import { isWebEditIframeCandidate } from './iframe-origin';

export type WebEditIframeCandidateState =
  | 'discovered'
  | 'eligible'
  | 'waiting_ready'
  | 'ready_confirmed'
  | 'connecting'
  | 'connected'
  | 'rejected'
  | 'cooldown';

export type WebEditIframeCandidateMatchedBy =
  | 'office-iframe'
  | 'src-origin'
  | 'ready-event';

export type WebEditIframeCandidateFailureReason =
  | 'origin_mismatch'
  | 'content_window_unavailable'
  | 'ready_not_received'
  | 'server_ready_source_unmatched'
  | 'transport_connect_failed'
  | (string & {});

export type WebEditIframeCandidate = {
  key: string;
  state: WebEditIframeCandidateState;
  priority: number;
  failureCount: number;
  retryAt?: number;
  reason?: string;
  matchedBy?: WebEditIframeCandidateMatchedBy;
  id?: string | null;
  srcOrigin?: string | null;
  runtimeOrigin?: string | null;
  eventOrigin?: string | null;
};

type TransitionFailAction = {
  type: 'fail';
  reason: WebEditIframeCandidateFailureReason;
  now: number;
  cooldownMs: number;
};

type TransitionPromoteAction = {
  type: 'promote';
  state:
    | 'eligible'
    | 'waiting_ready'
    | 'ready_confirmed'
    | 'connecting'
    | 'connected'
    | 'rejected';
  reason?: string;
  matchedBy?: WebEditIframeCandidateMatchedBy;
  now?: number;
};

export type WebEditIframeCandidateTransitionAction =
  | TransitionFailAction
  | TransitionPromoteAction;

export function rankWebEditIframeCandidate(input: {
  id?: string | null;
  srcOrigin?: string | null;
  hasReadyMatch?: boolean;
}): number {
  if (input.hasReadyMatch) {
    return 120;
  }

  if (input.id === 'office-iframe') {
    return 100;
  }

  if (input.srcOrigin === 'https://webedit.midea.com') {
    return 80;
  }

  if (isWebEditIframeCandidate({ id: input.id, src: input.srcOrigin ?? undefined })) {
    return 80;
  }

  return 0;
}

export function createWebEditIframeCandidateRegistry(now: () => number = Date.now) {
  const store = new Map<string, WebEditIframeCandidate>();

  return {
    now,
    get(key: string): WebEditIframeCandidate | undefined {
      return store.get(key);
    },
    delete(key: string): void {
      store.delete(key);
    },
    upsert(candidate: WebEditIframeCandidate): WebEditIframeCandidate {
      const next = { ...candidate };
      store.set(candidate.key, next);
      return next;
    },
    list(): WebEditIframeCandidate[] {
      return [...store.values()].sort((left, right) => {
        if (left.state === 'connected' && right.state !== 'connected') return -1;
        if (right.state === 'connected' && left.state !== 'connected') return 1;

        if (left.priority !== right.priority) {
          return right.priority - left.priority;
        }

        const leftRetry = left.retryAt ?? 0;
        const rightRetry = right.retryAt ?? 0;
        return leftRetry - rightRetry;
      });
    },
    selectPrimary(): WebEditIframeCandidate | null {
      const nowAtSelection = now();

      for (const candidate of this.list()) {
        if (candidate.state === 'connected') {
          return candidate;
        }

        if (candidate.state === 'cooldown' && candidate.retryAt && candidate.retryAt > nowAtSelection) {
          continue;
        }

        if (candidate.state === 'rejected') {
          continue;
        }

        return candidate;
      }

      return null;
    },
  };
}

export function transitionWebEditIframeCandidate(
  current: WebEditIframeCandidate,
  action: WebEditIframeCandidateTransitionAction
): WebEditIframeCandidate {
  if (action.type === 'fail') {
    return {
      ...current,
      state: 'cooldown',
      reason: action.reason,
      failureCount: current.failureCount + 1,
      retryAt: action.now + action.cooldownMs,
    };
  }

  const next: WebEditIframeCandidate = {
    ...current,
    state: action.state,
    reason: action.reason,
  };

  if (action.matchedBy) {
    next.matchedBy = action.matchedBy;
  }

  if (action.state === 'rejected') {
    next.retryAt = undefined;
  }

  return next;
}
