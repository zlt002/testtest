import type { DisplayMessage } from '../domain/display-message.ts';

export async function getSessionHistory(input: {
  sessionId: string;
  projectPath?: string;
  historyReader: {
    readSessionHistory(
      sessionId: string,
      input?: { projectPath?: string }
    ): Promise<DisplayMessage[]>;
  };
}): Promise<{ sessionId: string; messages: DisplayMessage[] }> {
  return {
    sessionId: input.sessionId,
    messages: await input.historyReader.readSessionHistory(input.sessionId, {
      projectPath: input.projectPath,
    }),
  };
}
