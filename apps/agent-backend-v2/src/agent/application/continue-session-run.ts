import { createId } from '../../shared/ids.ts';
import type { RunStream } from './start-session-run.ts';

export type ContinueSessionRunExecutor = (options: {
  runId: string;
  sessionId: string;
  prompt: string;
  projectPath?: string;
  browserContext?: Record<string, unknown>;
  permissionMode?: string;
  effort?: string;
  images?: Array<{ name?: string; mimeType: string; data: string }>;
}) => RunStream | Promise<RunStream>;

export async function continueSessionRun(input: {
  sessionId: string;
  prompt: string;
  projectPath?: string;
  browserContext?: Record<string, unknown>;
  permissionMode?: string;
  effort?: string;
  images?: Array<{ name?: string; mimeType: string; data: string }>;
  executeRun: ContinueSessionRunExecutor;
}): Promise<RunStream> {
  return await input.executeRun({
    runId: createId('run'),
    sessionId: input.sessionId,
    prompt: input.prompt,
    projectPath: input.projectPath,
    browserContext: input.browserContext,
    permissionMode: input.permissionMode,
    effort: input.effort,
    images: input.images,
  });
}
