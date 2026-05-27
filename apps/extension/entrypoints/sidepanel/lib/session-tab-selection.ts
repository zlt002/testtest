import { isChatContextCandidateUrl } from './browser-context';

export const DEFAULT_SELECTED_TAB_SOURCE = 'current-window' as const;
export const AGENT_V2_SESSION_TABS_STORAGE_KEY = 'agentV2.sessionSelectedTabs';

export type SessionTabSummary = {
  tabId: number;
  windowId?: number;
  title?: string;
  url?: string;
  favIconUrl?: string;
  active: boolean;
};

export type AgentV2SessionSelectedTabs = {
  sessionId: string;
  selectedTabIds: number[];
  primaryTabId: number | null;
  source: typeof DEFAULT_SELECTED_TAB_SOURCE;
  updatedAt: string;
};

export function toSessionTabSummary(tab: chrome.tabs.Tab): SessionTabSummary | undefined {
  if (typeof tab.id !== 'number' || !isChatContextCandidateUrl(tab.url)) {
    return undefined;
  }

  return {
    tabId: tab.id,
    windowId: typeof tab.windowId === 'number' ? tab.windowId : undefined,
    title: tab.title,
    url: tab.url,
    favIconUrl: tab.favIconUrl,
    active: Boolean(tab.active),
  };
}

export async function getCurrentWindowTabs(): Promise<SessionTabSummary[]> {
  const tabs = await chrome.tabs.query({ currentWindow: true });
  return tabs.flatMap((tab) => {
    const summary = toSessionTabSummary(tab);
    return summary ? [summary] : [];
  });
}

export function createInitialSelectedTabIds(tabs: SessionTabSummary[]): number[] {
  const activeTab = tabs.find((tab) => tab.active);
  return activeTab ? [activeTab.tabId] : [];
}

export function pruneSelectedTabIds(
  selectedTabIds: number[],
  tabs: SessionTabSummary[]
): number[] {
  const validIds = new Set(tabs.map((tab) => tab.tabId));
  return selectedTabIds.filter((tabId) => validIds.has(tabId));
}

export function derivePrimaryTabId(
  selectedTabIds: number[],
  tabs: SessionTabSummary[]
): number | null {
  const selectedTabs = tabs.filter((tab) => selectedTabIds.includes(tab.tabId));
  const activeSelectedTab = selectedTabs.find((tab) => tab.active);
  if (activeSelectedTab) {
    return activeSelectedTab.tabId;
  }

  const availableTabIds = new Set(selectedTabs.map((tab) => tab.tabId));
  return selectedTabIds.find((tabId) => availableTabIds.has(tabId)) ?? null;
}
