import { summarizePromptForDisplay } from '../../../../../../shared/utils/src/prompt-metadata.ts';
import {
  AGENT_V2_SESSION_TABS_STORAGE_KEY,
  type AgentV2SessionSelectedTabs,
} from '../session-tab-selection';

export const AGENT_V2_SESSION_SELECTION_STORAGE_KEY = 'agentV2.selectedSession';
export const AGENT_V2_CURRENT_SESSION_STORAGE_KEY = 'agentV2.currentSession';
export const AGENT_V2_SESSION_SELECTED_MESSAGE = 'agent_v2_session_selected';
export const AGENT_V2_PROJECT_SELECTION_STORAGE_KEY = 'agentV2.selectedProject';
export const AGENT_V2_PROJECT_SELECTED_MESSAGE = 'agent_v2_project_selected';
export const AGENT_V2_WORKSPACE_INTENT_STORAGE_KEY = 'agentV2.workspaceIntent';
export const AGENT_V2_COMPOSER_APPEND_STORAGE_KEY = 'agentV2.composerAppend';
export const AGENT_V2_COMPOSER_APPEND_MESSAGE = 'agent_v2_composer_append';
export const AGENT_V2_QUICK_ACTION_FEEDBACK_STORAGE_KEY = 'agentV2.quickActionFeedback';
export const AGENT_V2_QUICK_ACTION_FEEDBACK_MESSAGE = 'agent_v2_quick_action_feedback';

export type AgentV2SessionSelection = {
  sessionId: string;
  projectPath?: string;
  title?: string;
  selectedAt: string;
};

export type AgentV2SessionSelectedMessage = {
  type: typeof AGENT_V2_SESSION_SELECTED_MESSAGE;
  payload: AgentV2SessionSelection;
};

export type AgentV2ProjectSelection = {
  projectPath: string;
  selectedAt: string;
  kind?: 'open_project' | 'new_session';
};

export type AgentV2ProjectSelectedMessage = {
  type: typeof AGENT_V2_PROJECT_SELECTED_MESSAGE;
  payload: AgentV2ProjectSelection;
};

export type AgentV2WorkspaceIntent = {
  kind: 'new_session';
  requestedAt: string;
};

export type AgentV2ComposerAppend = {
  text: string;
  source?: string;
  appendedAt: string;
};

export type AgentV2ComposerAppendMessage = {
  type: typeof AGENT_V2_COMPOSER_APPEND_MESSAGE;
  payload: AgentV2ComposerAppend;
};

export type AgentV2QuickActionFeedback = {
  kind: 'success' | 'error' | 'pending';
  message: string;
  entryPath?: string;
  suffixMessage?: string;
  source?: string;
  createdAt: string;
};

export type AgentV2QuickActionFeedbackMessage = {
  type: typeof AGENT_V2_QUICK_ACTION_FEEDBACK_MESSAGE;
  payload: AgentV2QuickActionFeedback;
};

function isAgentV2SessionSelectedTabs(value: unknown): value is AgentV2SessionSelectedTabs {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as AgentV2SessionSelectedTabs).sessionId === 'string' &&
    Array.isArray((value as AgentV2SessionSelectedTabs).selectedTabIds) &&
    (value as AgentV2SessionSelectedTabs).selectedTabIds.every((tabId) => typeof tabId === 'number') &&
    ((value as AgentV2SessionSelectedTabs).primaryTabId === null ||
      typeof (value as AgentV2SessionSelectedTabs).primaryTabId === 'number') &&
    (value as AgentV2SessionSelectedTabs).source === 'current-window' &&
    typeof (value as AgentV2SessionSelectedTabs).updatedAt === 'string'
  );
}

function getAgentV2SessionSelectedTabsStorageKey(sessionId: string): string {
  return `${AGENT_V2_SESSION_TABS_STORAGE_KEY}:${sessionId}`;
}

function sanitizeSessionTitle(title?: string) {
  const normalized = title ? summarizePromptForDisplay(title).replace(/\s+/g, ' ').trim() : '';
  return normalized || undefined;
}

export function isAgentV2SessionSelectedMessage(
  message: unknown
): message is AgentV2SessionSelectedMessage {
  return (
    typeof message === 'object' &&
    message !== null &&
    (message as { type?: unknown }).type === AGENT_V2_SESSION_SELECTED_MESSAGE &&
    typeof (message as { payload?: { sessionId?: unknown } }).payload?.sessionId === 'string'
  );
}

export function isAgentV2ProjectSelectedMessage(
  message: unknown
): message is AgentV2ProjectSelectedMessage {
  return (
    typeof message === 'object' &&
    message !== null &&
    (message as { type?: unknown }).type === AGENT_V2_PROJECT_SELECTED_MESSAGE &&
    typeof (message as { payload?: { projectPath?: unknown } }).payload?.projectPath === 'string'
  );
}

export function isAgentV2ComposerAppendMessage(
  message: unknown
): message is AgentV2ComposerAppendMessage {
  return (
    typeof message === 'object' &&
    message !== null &&
    (message as { type?: unknown }).type === AGENT_V2_COMPOSER_APPEND_MESSAGE &&
    typeof (message as { payload?: { text?: unknown } }).payload?.text === 'string'
  );
}

export function isAgentV2QuickActionFeedbackMessage(
  message: unknown
): message is AgentV2QuickActionFeedbackMessage {
  return (
    typeof message === 'object' &&
    message !== null &&
    (message as { type?: unknown }).type === AGENT_V2_QUICK_ACTION_FEEDBACK_MESSAGE &&
    typeof (message as { payload?: { kind?: unknown; message?: unknown } }).payload?.kind ===
      'string' &&
    typeof (message as { payload?: { kind?: unknown; message?: unknown } }).payload?.message ===
      'string'
  );
}

export async function publishAgentV2ProjectSelection(input: {
  projectPath: string;
  kind?: AgentV2ProjectSelection['kind'];
}) {
  const selection: AgentV2ProjectSelection = {
    projectPath: input.projectPath,
    selectedAt: new Date().toISOString(),
    kind: input.kind,
  };

  await chrome.storage.local.set({
    [AGENT_V2_PROJECT_SELECTION_STORAGE_KEY]: selection,
  });
  await chrome.storage.local.remove(AGENT_V2_SESSION_SELECTION_STORAGE_KEY);
  await chrome.storage.local.remove(AGENT_V2_CURRENT_SESSION_STORAGE_KEY);
  await chrome.storage.local.remove(AGENT_V2_WORKSPACE_INTENT_STORAGE_KEY);

  await chrome.runtime
    .sendMessage({
      type: AGENT_V2_PROJECT_SELECTED_MESSAGE,
      payload: selection,
    } satisfies AgentV2ProjectSelectedMessage)
    .catch((error) => {
      console.debug('[agent-v2] project selection broadcast failed:', error);
    });
}

export async function publishAgentV2WorkspaceIntent(input: {
  kind: AgentV2WorkspaceIntent['kind'];
}) {
  const intent: AgentV2WorkspaceIntent = {
    kind: input.kind,
    requestedAt: new Date().toISOString(),
  };

  await chrome.storage.local.set({
    [AGENT_V2_WORKSPACE_INTENT_STORAGE_KEY]: intent,
  });
}

export async function readAgentV2WorkspaceIntent(): Promise<AgentV2WorkspaceIntent | null> {
  const stored = await chrome.storage.local.get(AGENT_V2_WORKSPACE_INTENT_STORAGE_KEY);
  const intent = stored[AGENT_V2_WORKSPACE_INTENT_STORAGE_KEY];
  if (
    typeof intent === 'object' &&
    intent !== null &&
    (intent as AgentV2WorkspaceIntent).kind === 'new_session'
  ) {
    return intent as AgentV2WorkspaceIntent;
  }
  return null;
}

export async function clearAgentV2WorkspaceIntent() {
  await chrome.storage.local.remove(AGENT_V2_WORKSPACE_INTENT_STORAGE_KEY);
}

export async function readAgentV2ProjectSelection(): Promise<AgentV2ProjectSelection | null> {
  const stored = await chrome.storage.local.get(AGENT_V2_PROJECT_SELECTION_STORAGE_KEY);
  const selection = stored[AGENT_V2_PROJECT_SELECTION_STORAGE_KEY];
  if (
    typeof selection === 'object' &&
    selection !== null &&
    typeof (selection as AgentV2ProjectSelection).projectPath === 'string'
  ) {
    return selection as AgentV2ProjectSelection;
  }
  return null;
}

export async function publishAgentV2SessionSelection(input: {
  sessionId: string;
  projectPath?: string;
  title?: string;
}) {
  const selection: AgentV2SessionSelection = {
    sessionId: input.sessionId,
    projectPath: input.projectPath,
    title: sanitizeSessionTitle(input.title),
    selectedAt: new Date().toISOString(),
  };

  await chrome.storage.local.set({
    [AGENT_V2_SESSION_SELECTION_STORAGE_KEY]: selection,
    [AGENT_V2_CURRENT_SESSION_STORAGE_KEY]: selection,
  });

  await chrome.runtime
    .sendMessage({
      type: AGENT_V2_SESSION_SELECTED_MESSAGE,
      payload: selection,
    } satisfies AgentV2SessionSelectedMessage)
    .catch((error) => {
      console.debug('[agent-v2] session selection broadcast failed:', error);
    });
}

export async function publishAgentV2CurrentSession(input: {
  sessionId: string;
  projectPath?: string;
  title?: string;
}) {
  const selection: AgentV2SessionSelection = {
    sessionId: input.sessionId,
    projectPath: input.projectPath,
    title: sanitizeSessionTitle(input.title),
    selectedAt: new Date().toISOString(),
  };

  await chrome.storage.local.set({
    [AGENT_V2_CURRENT_SESSION_STORAGE_KEY]: selection,
  });
}

export async function readAgentV2CurrentSession(): Promise<AgentV2SessionSelection | null> {
  const stored = await chrome.storage.local.get(AGENT_V2_CURRENT_SESSION_STORAGE_KEY);
  const selection = stored[AGENT_V2_CURRENT_SESSION_STORAGE_KEY];
  if (
    typeof selection === 'object' &&
    selection !== null &&
    typeof (selection as AgentV2SessionSelection).sessionId === 'string'
  ) {
    return {
      ...(selection as AgentV2SessionSelection),
      title: sanitizeSessionTitle((selection as AgentV2SessionSelection).title),
    };
  }
  return null;
}

export async function clearAgentV2CurrentSession() {
  await chrome.storage.local.remove(AGENT_V2_CURRENT_SESSION_STORAGE_KEY);
}

export async function readAgentV2SessionSelection(): Promise<AgentV2SessionSelection | null> {
  const stored = await chrome.storage.local.get(AGENT_V2_SESSION_SELECTION_STORAGE_KEY);
  const selection = stored[AGENT_V2_SESSION_SELECTION_STORAGE_KEY];
  if (
    typeof selection === 'object' &&
    selection !== null &&
    typeof (selection as AgentV2SessionSelection).sessionId === 'string'
  ) {
    await chrome.storage.local.remove(AGENT_V2_SESSION_SELECTION_STORAGE_KEY);
    return {
      ...(selection as AgentV2SessionSelection),
      title: sanitizeSessionTitle((selection as AgentV2SessionSelection).title),
    };
  }
  return null;
}

export async function readAgentV2SessionSelectedTabs(
  sessionId: string
): Promise<AgentV2SessionSelectedTabs | null> {
  const storageKey = getAgentV2SessionSelectedTabsStorageKey(sessionId);
  const stored = await chrome.storage.local.get(storageKey);
  const selection = stored[storageKey];
  return isAgentV2SessionSelectedTabs(selection) ? selection : null;
}

export async function writeAgentV2SessionSelectedTabs(input: AgentV2SessionSelectedTabs) {
  await chrome.storage.local.set({
    [getAgentV2SessionSelectedTabsStorageKey(input.sessionId)]: input,
  });
}

export async function clearAgentV2SessionSelectedTabs(sessionId: string) {
  await chrome.storage.local.remove(getAgentV2SessionSelectedTabsStorageKey(sessionId));
}

export async function publishAgentV2ComposerAppend(input: { text: string; source?: string }) {
  const payload: AgentV2ComposerAppend = {
    text: input.text,
    source: input.source,
    appendedAt: new Date().toISOString(),
  };

  await chrome.storage.local.set({
    [AGENT_V2_COMPOSER_APPEND_STORAGE_KEY]: payload,
  });

  await chrome.runtime
    .sendMessage({
      type: AGENT_V2_COMPOSER_APPEND_MESSAGE,
      payload,
    } satisfies AgentV2ComposerAppendMessage)
    .catch((error) => {
      console.debug('[agent-v2] composer append broadcast failed:', error);
    });
}

export async function readAgentV2ComposerAppend(): Promise<AgentV2ComposerAppend | null> {
  const stored = await chrome.storage.local.get(AGENT_V2_COMPOSER_APPEND_STORAGE_KEY);
  const payload = stored[AGENT_V2_COMPOSER_APPEND_STORAGE_KEY];
  if (
    typeof payload === 'object' &&
    payload !== null &&
    typeof (payload as AgentV2ComposerAppend).text === 'string'
  ) {
    await chrome.storage.local.remove(AGENT_V2_COMPOSER_APPEND_STORAGE_KEY);
    return payload as AgentV2ComposerAppend;
  }
  return null;
}

export async function publishAgentV2QuickActionFeedback(input: {
  kind: AgentV2QuickActionFeedback['kind'];
  message: string;
  entryPath?: string;
  suffixMessage?: string;
  source?: string;
}) {
  const payload: AgentV2QuickActionFeedback = {
    kind: input.kind,
    message: input.message,
    entryPath: input.entryPath,
    suffixMessage: input.suffixMessage,
    source: input.source,
    createdAt: new Date().toISOString(),
  };

  await chrome.storage.local.set({
    [AGENT_V2_QUICK_ACTION_FEEDBACK_STORAGE_KEY]: payload,
  });

  await chrome.runtime
    .sendMessage({
      type: AGENT_V2_QUICK_ACTION_FEEDBACK_MESSAGE,
      payload,
    } satisfies AgentV2QuickActionFeedbackMessage)
    .catch((error) => {
      console.debug('[agent-v2] quick action feedback broadcast failed:', error);
    });
}

export async function readAgentV2QuickActionFeedback(): Promise<AgentV2QuickActionFeedback | null> {
  const stored = await chrome.storage.local.get(AGENT_V2_QUICK_ACTION_FEEDBACK_STORAGE_KEY);
  const payload = stored[AGENT_V2_QUICK_ACTION_FEEDBACK_STORAGE_KEY];
  if (
    typeof payload === 'object' &&
    payload !== null &&
    (payload as AgentV2QuickActionFeedback).kind !== undefined &&
    typeof (payload as AgentV2QuickActionFeedback).message === 'string'
  ) {
    await chrome.storage.local.remove(AGENT_V2_QUICK_ACTION_FEEDBACK_STORAGE_KEY);
    return payload as AgentV2QuickActionFeedback;
  }
  return null;
}
