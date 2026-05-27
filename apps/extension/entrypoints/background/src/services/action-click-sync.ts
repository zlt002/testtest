export type ActionClickSyncMode = 'remote' | 'local-debug';

export type ActionClickSyncStatus =
  | 'completed'
  | 'failed'
  | 'timeout'
  | 'unavailable';

export type ActionClickSyncResult = {
  ok: boolean;
  status: ActionClickSyncStatus;
  mode?: ActionClickSyncMode;
  error?: string;
};

export type ActionClickSyncResponse = {
  ok: boolean;
  status: number;
  json(): Promise<unknown>;
};

export type ActionClickSyncClient = {
  post(input: { signal: AbortSignal }): Promise<ActionClickSyncResponse>;
};

type SyncPayload = {
  ok?: boolean;
  status?: string;
  mode?: ActionClickSyncMode;
  error?: string;
};

function toFailedResult(responseStatus: number, payload: SyncPayload | undefined): ActionClickSyncResult {
  return {
    ok: false,
    status: 'failed',
    mode: payload?.mode,
    error: payload?.error ?? `HTTP ${responseStatus}`,
  };
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === 'AbortError';
}

async function runWithTimeout(
  post: ActionClickSyncClient['post'],
  timeoutMs: number,
): Promise<{ response: ActionClickSyncResponse; payload: SyncPayload | undefined }> {
  const controller = new AbortController();
  const timeoutError = new DOMException(`sync timed out after ${timeoutMs}ms`, 'AbortError');
  let timeoutId: ReturnType<typeof setTimeout> | undefined;

  const timeoutPromise = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => {
      controller.abort();
      reject(timeoutError);
    }, timeoutMs);
  });

  try {
    return await Promise.race([
      (async () => {
        const response = await post({ signal: controller.signal });
        const payload = (await response.json()) as SyncPayload | undefined;

        return { response, payload };
      })(),
      timeoutPromise,
    ]);
  } finally {
    if (timeoutId !== undefined) {
      clearTimeout(timeoutId);
    }
  }
}

export function createActionClickSyncService(input: {
  post: ActionClickSyncClient['post'];
  timeoutMs: number;
}) {
  let inflight: Promise<ActionClickSyncResult> | null = null;

  async function run(): Promise<ActionClickSyncResult> {
    try {
      const { response, payload } = await runWithTimeout(input.post, input.timeoutMs);

      if (response.ok && payload?.ok && payload.status === 'completed') {
        return {
          ok: true,
          status: 'completed',
          mode: payload.mode,
        };
      }

      return toFailedResult(response.status, payload);
    } catch (error) {
      if (isAbortError(error)) {
        return {
          ok: false,
          status: 'timeout',
          error: `sync timed out after ${input.timeoutMs}ms`,
        };
      }

      return {
        ok: false,
        status: 'unavailable',
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  return {
    syncOnActionClick(): Promise<ActionClickSyncResult> {
      if (!inflight) {
        inflight = run().finally(() => {
          inflight = null;
        });
      }

      return inflight;
    },
  };
}
