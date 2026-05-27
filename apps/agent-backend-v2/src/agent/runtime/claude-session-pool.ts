import { query as sdkQuery } from '@anthropic-ai/claude-agent-sdk';

type InterruptibleRun = {
  interrupt: () => Promise<void>;
};

type SdkLike<TQuery> = {
  query: TQuery;
};

export function createClaudeSessionPool<TQuery = typeof sdkQuery>(
  sdk: SdkLike<TQuery> = { query: sdkQuery } as SdkLike<TQuery>
) {
  const activeRuns = new Map<string, InterruptibleRun>();

  return {
    query: sdk.query,

    registerActiveRun(runId: string, run: InterruptibleRun) {
      activeRuns.set(runId, run);
    },

    completeRun(runId: string) {
      activeRuns.delete(runId);
    },

    async abortRun(
      runId: string
    ): Promise<{ aborted: true } | { aborted: false; reason: 'not_active' }> {
      const run = activeRuns.get(runId);
      if (!run) {
        return { aborted: false, reason: 'not_active' };
      }
      activeRuns.delete(runId);
      await run.interrupt();
      return { aborted: true };
    },
  };
}
