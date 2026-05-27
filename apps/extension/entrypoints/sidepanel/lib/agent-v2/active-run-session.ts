export const AGENT_V2_ACTIVE_RUN_SESSION_STORAGE_KEY = 'agentV2.activeRunSession';

export type AgentV2ActiveRunSession = {
  sessionId: string;
  projectPath?: string;
  runId: string;
  status: 'connecting' | 'streaming';
  updatedAt: string;
};

function isActiveRunStatus(value: unknown): value is AgentV2ActiveRunSession['status'] {
  return value === 'connecting' || value === 'streaming';
}

function isActiveRunSession(value: unknown): value is AgentV2ActiveRunSession {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as { sessionId?: unknown }).sessionId === 'string' &&
    typeof (value as { runId?: unknown }).runId === 'string' &&
    isActiveRunStatus((value as { status?: unknown }).status) &&
    typeof (value as { updatedAt?: unknown }).updatedAt === 'string' &&
    ((value as { projectPath?: unknown }).projectPath === undefined ||
      typeof (value as { projectPath?: unknown }).projectPath === 'string')
  );
}

export async function publishAgentV2ActiveRunSession(input: AgentV2ActiveRunSession) {
  await chrome.storage.local.set({
    [AGENT_V2_ACTIVE_RUN_SESSION_STORAGE_KEY]: input,
  });
}

export async function readAgentV2ActiveRunSession(): Promise<AgentV2ActiveRunSession | null> {
  const stored = await chrome.storage.local.get(AGENT_V2_ACTIVE_RUN_SESSION_STORAGE_KEY);
  const payload = stored[AGENT_V2_ACTIVE_RUN_SESSION_STORAGE_KEY];
  return isActiveRunSession(payload) ? payload : null;
}

export async function clearAgentV2ActiveRunSession() {
  await chrome.storage.local.remove(AGENT_V2_ACTIVE_RUN_SESSION_STORAGE_KEY);
}
