export type AccrSyncMode = 'remote' | 'local-debug';

export type AccrSyncResult =
  | {
      ok: true;
      status: 'completed';
      mode: AccrSyncMode;
      stdout: string;
      stderr: string;
    }
  | {
      ok: false;
      status: 'failed' | 'timeout';
      mode: AccrSyncMode;
      error: string;
      stdout?: string;
      stderr?: string;
      code?: string | number;
      signal?: string | null;
    };

export function createAccrSyncService(input: {
  remoteSync: {
    syncRemote(input: { force: boolean }): Promise<AccrSyncResult>;
  };
  localDebugSync: {
    syncLocalDebug(): Promise<AccrSyncResult>;
  };
}) {
  return {
    async run(request: { mode: AccrSyncMode; force?: boolean }): Promise<AccrSyncResult> {
      if (request.mode === 'remote') {
        return input.remoteSync.syncRemote({ force: request.force === true });
      }
      return input.localDebugSync.syncLocalDebug();
    },
  };
}
