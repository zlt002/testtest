import { createId } from '../../shared/ids.ts';
import type { AgentEvent } from '../domain/events.ts';

export type RunStream = AsyncIterable<AgentEvent> & {
  runId: string;
  sessionId: string | null;
};

export type StartSessionRunExecutor = (options: {
  runId: string;
  sessionId: string | null;
  prompt: string;
  projectPath?: string;
  browserContext?: Record<string, unknown>;
  permissionMode?: string;
  effort?: string;
  images?: Array<{ name?: string; mimeType: string; data: string }>;
}) => RunStream | Promise<RunStream>;

export async function startSessionRun(input: {
  prompt: string;
  projectPath?: string;
  browserContext?: Record<string, unknown>;
  permissionMode?: string;
  effort?: string;
  images?: Array<{ name?: string; mimeType: string; data: string }>;
  executeRun: StartSessionRunExecutor;
}): Promise<RunStream> {
  return await input.executeRun({
    runId: createId('run'),
    sessionId: null,
    prompt: input.prompt,
    projectPath: input.projectPath,
    browserContext: input.browserContext,
    permissionMode: input.permissionMode,
    effort: input.effort,
    images: input.images,
  });
}
