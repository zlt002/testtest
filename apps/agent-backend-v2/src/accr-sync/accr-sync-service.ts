export type AccrSyncMode = 'remote' | 'local-debug';

export type AccrSyncHealthResult = {
  ok: true;
  healthy: boolean;
  checkedPath: string;
  issues: string[];
  recommendedAction: 'none' | 'remote_resync';
  syncStateVersion?: string;
};

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
  healthCheck: {
    check(): Promise<AccrSyncHealthResult>;
  };
}) {
  return {
    async run(request: { mode: AccrSyncMode; force?: boolean }): Promise<AccrSyncResult> {
      if (request.mode === 'remote') {
        return input.remoteSync.syncRemote({ force: request.force === true });
      }
      return input.localDebugSync.syncLocalDebug();
    },
    async checkHealth(): Promise<AccrSyncHealthResult> {
      return input.healthCheck.check();
    },
  };
}
