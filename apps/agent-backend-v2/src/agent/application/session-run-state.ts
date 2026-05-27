export type SessionRunStateStatus =
  | 'connecting'
  | 'streaming'
  | 'completed'
  | 'failed'
  | 'aborted';

export type SessionRunState = {
  sessionId: string;
  projectPath: string;
  runId: string;
  status: SessionRunStateStatus;
  startedAt: string;
  lastEventAt: string;
  latestSequence: number;
  latestPreviewText?: string;
  hasActiveStream: boolean;
  lastError?: string;
};

export type SessionRunStateUpsertInput = {
  sessionId: string;
  projectPath: string;
  runId: string;
  status: SessionRunStateStatus;
  latestSequence: number;
  startedAt?: string;
  lastEventAt?: string;
  latestPreviewText?: string;
  hasActiveStream?: boolean;
  lastError?: string;
};

export type SessionRunStateFinishInput = {
  runId?: string;
  latestSequence?: number;
  lastEventAt?: string;
  latestPreviewText?: string;
  lastError?: string;
};

export type SessionRunStateStore = {
  upsert(input: SessionRunStateUpsertInput): SessionRunState;
  markFinished(
    sessionId: string,
    status: Extract<SessionRunStateStatus, 'completed' | 'failed' | 'aborted'>,
    input?: SessionRunStateFinishInput
  ): SessionRunState | null;
  get(sessionId: string): SessionRunState | null;
  listByProject(projectPath: string): SessionRunState[];
  pruneExpired(): number;
};

type SessionRunStateStoreOptions = {
  now?: () => string;
  retentionMs?: number;
};

const DEFAULT_RETENTION_MS = 120_000;

function normalizeProjectPath(projectPath: string) {
  return projectPath.replace(/\\/g, '/');
}

function isTerminalStatus(status: SessionRunStateStatus) {
  return status === 'completed' || status === 'failed' || status === 'aborted';
}

function inferActiveStream(status: SessionRunStateStatus, hasActiveStream?: boolean) {
  if (typeof hasActiveStream === 'boolean') {
    return hasActiveStream;
  }
  return !isTerminalStatus(status);
}

function toTimestamp(value: string) {
  const timestamp = Date.parse(value);
  return Number.isNaN(timestamp) ? null : timestamp;
}

function compareTimestamps(left: string, right: string) {
  const leftTimestamp = toTimestamp(left);
  const rightTimestamp = toTimestamp(right);

  if (leftTimestamp === null && rightTimestamp === null) {
    return left.localeCompare(right);
  }
  if (leftTimestamp === null) {
    return -1;
  }
  if (rightTimestamp === null) {
    return 1;
  }
  return leftTimestamp - rightTimestamp;
}

function pickLaterTimestamp(left: string, right: string) {
  return compareTimestamps(left, right) >= 0 ? left : right;
}

function cloneState(state: SessionRunState): SessionRunState {
  return { ...state };
}

export function createSessionRunStateStore(
  options: SessionRunStateStoreOptions = {}
): SessionRunStateStore {
  const now = options.now ?? (() => new Date().toISOString());
  const retentionMs = options.retentionMs ?? DEFAULT_RETENTION_MS;
  const records = new Map<string, SessionRunState>();

  function buildFreshState(
    input: SessionRunStateUpsertInput,
    timestamp: string
  ): SessionRunState {
    const startedAt = input.startedAt ?? input.lastEventAt ?? timestamp;
    const lastEventAt = input.lastEventAt ?? timestamp;

    return {
      sessionId: input.sessionId,
      projectPath: input.projectPath,
      runId: input.runId,
      status: input.status,
      startedAt,
      lastEventAt,
      latestSequence: input.latestSequence,
      latestPreviewText: input.latestPreviewText,
      hasActiveStream: inferActiveStream(input.status, input.hasActiveStream),
      lastError: input.lastError,
    };
  }

  function upsert(input: SessionRunStateUpsertInput) {
    const timestamp = now();
    const current = records.get(input.sessionId);

    if (!current || current.runId !== input.runId) {
      const created = buildFreshState(input, timestamp);
      records.set(input.sessionId, created);
      return cloneState(created);
    }

    const incomingLastEventAt = input.lastEventAt ?? timestamp;
    const latestSequence = Math.max(current.latestSequence, input.latestSequence);
    const isFresherEvent =
      input.latestSequence > current.latestSequence ||
      (input.latestSequence === current.latestSequence &&
        compareTimestamps(incomingLastEventAt, current.lastEventAt) >= 0);

    const next: SessionRunState = {
      ...current,
      latestSequence,
    };

    if (isFresherEvent) {
      next.projectPath = input.projectPath;
      next.lastEventAt = incomingLastEventAt;
      next.status = input.status;
      next.latestPreviewText =
        input.latestPreviewText === undefined ? current.latestPreviewText : input.latestPreviewText;
      next.lastError = input.lastError === undefined ? current.lastError : input.lastError;
      next.hasActiveStream = inferActiveStream(input.status, input.hasActiveStream);
    }

    records.set(input.sessionId, next);
    return cloneState(next);
  }

  function markFinished(
    sessionId: string,
    status: Extract<SessionRunStateStatus, 'completed' | 'failed' | 'aborted'>,
    input: SessionRunStateFinishInput = {}
  ) {
    const current = records.get(sessionId);
    if (!current) {
      return null;
    }
    if (input.runId !== undefined && current.runId !== input.runId) {
      return cloneState(current);
    }

    const timestamp = now();
    const incomingLastEventAt = input.lastEventAt ?? timestamp;
    const next: SessionRunState = {
      ...current,
      status,
      latestSequence:
        input.latestSequence === undefined
          ? current.latestSequence
          : Math.max(current.latestSequence, input.latestSequence),
      lastEventAt: pickLaterTimestamp(current.lastEventAt, incomingLastEventAt),
      latestPreviewText:
        input.latestPreviewText === undefined ? current.latestPreviewText : input.latestPreviewText,
      lastError: input.lastError === undefined ? current.lastError : input.lastError,
      hasActiveStream: false,
    };

    records.set(sessionId, next);
    return cloneState(next);
  }

  function get(sessionId: string) {
    const record = records.get(sessionId);
    return record ? cloneState(record) : null;
  }

  function listByProject(projectPath: string) {
    const normalizedProjectPath = normalizeProjectPath(projectPath);

    return [...records.values()]
      .filter((record) => normalizeProjectPath(record.projectPath) === normalizedProjectPath)
      .sort((left, right) => {
        if (left.hasActiveStream !== right.hasActiveStream) {
          return left.hasActiveStream ? -1 : 1;
        }

        const lastEventComparison = compareTimestamps(right.lastEventAt, left.lastEventAt);
        if (lastEventComparison !== 0) {
          return lastEventComparison;
        }

        const startedAtComparison = compareTimestamps(right.startedAt, left.startedAt);
        if (startedAtComparison !== 0) {
          return startedAtComparison;
        }

        const sessionComparison = left.sessionId.localeCompare(right.sessionId);
        if (sessionComparison !== 0) {
          return sessionComparison;
        }

        return left.runId.localeCompare(right.runId);
      })
      .map(cloneState);
  }

  function pruneExpired() {
    const currentTimestamp = toTimestamp(now());
    if (currentTimestamp === null) {
      return 0;
    }

    let prunedCount = 0;
    for (const [sessionId, record] of records.entries()) {
      if (record.hasActiveStream || !isTerminalStatus(record.status)) {
        continue;
      }

      const lastEventTimestamp = toTimestamp(record.lastEventAt);
      if (lastEventTimestamp === null) {
        continue;
      }

      if (currentTimestamp - lastEventTimestamp > retentionMs) {
        records.delete(sessionId);
        prunedCount += 1;
      }
    }

    return prunedCount;
  }

  return {
    upsert,
    markFinished,
    get,
    listByProject,
    pruneExpired,
  };
}
