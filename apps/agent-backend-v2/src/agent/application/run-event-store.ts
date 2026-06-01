import type { AgentEvent } from '../domain/events.ts';

type RunEventRecord = {
  events: AgentEvent[];
  closed: boolean;
  updatedAt: number;
  listeners: Set<() => void>;
};

type RunEventStoreOptions = {
  maxEventsPerRun?: number;
  retentionMs?: number;
  now?: () => number;
};

export type RunEventStore = {
  append(event: AgentEvent): void;
  stream(
    runId: string,
    input?: {
      afterSequence?: number;
      signal?: AbortSignal;
    }
  ): AsyncIterable<AgentEvent>;
};

const DEFAULT_MAX_EVENTS_PER_RUN = 500;
const DEFAULT_RETENTION_MS = 10 * 60 * 1000;

function isTerminalEvent(event: AgentEvent) {
  return event.type === 'run.completed' || event.type === 'run.failed' || event.type === 'run.aborted';
}

export function createRunEventStore(options: RunEventStoreOptions = {}): RunEventStore {
  const maxEventsPerRun = options.maxEventsPerRun ?? DEFAULT_MAX_EVENTS_PER_RUN;
  const retentionMs = options.retentionMs ?? DEFAULT_RETENTION_MS;
  const now = options.now ?? (() => Date.now());
  const records = new Map<string, RunEventRecord>();

  function pruneExpired() {
    const current = now();
    for (const [runId, record] of records.entries()) {
      if (!record.closed) {
        continue;
      }
      if (current - record.updatedAt > retentionMs) {
        records.delete(runId);
      }
    }
  }

  function getOrCreateRecord(runId: string) {
    const existing = records.get(runId);
    if (existing) {
      return existing;
    }
    const created: RunEventRecord = {
      events: [],
      closed: false,
      updatedAt: now(),
      listeners: new Set(),
    };
    records.set(runId, created);
    return created;
  }

  function append(event: AgentEvent) {
    pruneExpired();
    const record = getOrCreateRecord(event.runId);
    if (!record.events.some((existing) => existing.eventId === event.eventId)) {
      record.events.push(event);
      if (record.events.length > maxEventsPerRun) {
        record.events.splice(0, record.events.length - maxEventsPerRun);
      }
    }
    record.closed = record.closed || isTerminalEvent(event);
    record.updatedAt = now();
    for (const listener of [...record.listeners]) {
      listener();
    }
  }

  async function* stream(
    runId: string,
    input: {
      afterSequence?: number;
      signal?: AbortSignal;
    } = {}
  ) {
    pruneExpired();
    let cursor = input.afterSequence ?? 0;

    while (true) {
      const record = records.get(runId);
      if (!record) {
        return;
      }

      const pendingEvents = record.events.filter((event) => event.sequence > cursor);
      if (pendingEvents.length > 0) {
        for (const event of pendingEvents) {
          cursor = Math.max(cursor, event.sequence);
          yield event;
        }
        continue;
      }

      if (record.closed || input.signal?.aborted) {
        return;
      }

      await new Promise<void>((resolve) => {
        const onWake = () => {
          cleanup();
          resolve();
        };
        const onAbort = () => {
          cleanup();
          resolve();
        };
        const cleanup = () => {
          record.listeners.delete(onWake);
          input.signal?.removeEventListener('abort', onAbort);
        };

        record.listeners.add(onWake);
        input.signal?.addEventListener('abort', onAbort, { once: true });
      });
    }
  }

  return {
    append,
    stream,
  };
}
