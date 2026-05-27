import type { BrowserContext, BrowserContextTabSnapshot } from './agent-v2/types';

export type SelectedTabCapture = BrowserContextTabSnapshot & {
  tabId: number;
};

export function buildSelectedTabsBrowserContext(input: {
  tabs: SelectedTabCapture[];
  primaryTabId: number | null;
}): BrowserContext | undefined {
  const { tabs, primaryTabId } = input;
  if (tabs.length === 0) {
    return undefined;
  }

  const primaryTab = tabs.find((tab) => tab.tabId === primaryTabId) ?? tabs[0];

  return {
    windowId: primaryTab.windowId,
    tabId: primaryTab.tabId,
    title: primaryTab.title,
    url: primaryTab.url,
    source: 'selected-tabs',
    allowedTabIds: tabs.map((tab) => tab.tabId),
    selectedTabs: tabs.map((tab) => ({
      tabId: tab.tabId,
      windowId: tab.windowId,
      title: tab.title,
      url: tab.url,
      content: tab.content,
      captureError: tab.captureError,
    })),
    primaryTabId: primaryTab.tabId,
  };
}
