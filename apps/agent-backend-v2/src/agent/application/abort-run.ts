export type AbortRunResult = { aborted: true } | { aborted: false; reason: 'not_active' };

export async function abortRun(input: {
  runId: string;
  runtime: { abortRun(runId: string): Promise<AbortRunResult> };
}): Promise<AbortRunResult> {
  return input.runtime.abortRun(input.runId);
}
