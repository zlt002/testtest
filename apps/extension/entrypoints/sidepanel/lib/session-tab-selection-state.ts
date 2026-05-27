import {
  createInitialSelectedTabIds,
  derivePrimaryTabId,
  pruneSelectedTabIds,
  type SessionTabSummary,
} from './session-tab-selection';

export function getSessionTabSelectionScopeKey(input: {
  sessionId?: string | null;
  conversationId: string;
}) {
  return input.sessionId ? `session:${input.sessionId}` : `draft:${input.conversationId}`;
}

export function shouldRestoreSessionTabSelection(input: {
  scopeKey: string;
  resolvedScopeKey: string | null;
  isWindowTabsLoaded: boolean;
}) {
  return input.isWindowTabsLoaded && input.resolvedScopeKey !== input.scopeKey;
}

export function resolveSessionTabSelectionForScope(input: {
  sessionId?: string | null;
  windowTabs: SessionTabSummary[];
  storedSelectedTabIds: number[] | null;
  previousScopeKey: string | null;
  currentSelectedTabIds: number[];
}) {
  if (input.storedSelectedTabIds !== null) {
    return pruneSelectedTabIds(input.storedSelectedTabIds, input.windowTabs);
  }

  if (input.sessionId && input.previousScopeKey?.startsWith('draft:')) {
    return pruneSelectedTabIds(input.currentSelectedTabIds, input.windowTabs);
  }

  return createInitialSelectedTabIds(input.windowTabs);
}

export function resolveSessionPrimaryTabIdForScope(input: {
  windowTabs: SessionTabSummary[];
  selectedTabIds: number[];
  storedPrimaryTabId: number | null;
}) {
  if (
    typeof input.storedPrimaryTabId === 'number' &&
    input.selectedTabIds.includes(input.storedPrimaryTabId) &&
    input.windowTabs.some((tab) => tab.tabId === input.storedPrimaryTabId)
  ) {
    return input.storedPrimaryTabId;
  }

  return derivePrimaryTabId(input.selectedTabIds, input.windowTabs);
}

export function includeTabInSessionSelection(input: {
  windowTabs: SessionTabSummary[];
  selectedTabIds: number[];
  tabId?: number | null;
}) {
  const nextSelectedTabIds = pruneSelectedTabIds(input.selectedTabIds, input.windowTabs);
  if (typeof input.tabId !== 'number') {
    return nextSelectedTabIds;
  }

  const targetTab = input.windowTabs.find((tab) => tab.tabId === input.tabId);
  if (!targetTab || nextSelectedTabIds.includes(input.tabId)) {
    return nextSelectedTabIds;
  }

  const withTarget = [...nextSelectedTabIds, input.tabId];
  const tabOrder = new Map(input.windowTabs.map((tab, index) => [tab.tabId, index]));
  return withTarget.sort(
    (left, right) =>
      (tabOrder.get(left) ?? Number.MAX_SAFE_INTEGER) -
      (tabOrder.get(right) ?? Number.MAX_SAFE_INTEGER)
  );
}

export function shouldPersistSessionTabSelection(input: {
  sessionId?: string | null;
  scopeKey: string;
  resolvedScopeKey: string | null;
}) {
  return Boolean(input.sessionId) && input.resolvedScopeKey === input.scopeKey;
}
