import type { BrowserContext } from './agent-v2/types';

const INVALID_CONTEXT_PROTOCOLS = new Set(['javascript:', 'vbscript:', 'data:']);

type BrowserTabLike = Pick<
  chrome.tabs.Tab,
  'id' | 'windowId' | 'title' | 'url' | 'active' | 'highlighted' | 'status' | 'lastAccessed'
>;

export function isSidepanelUrl(url: string | undefined): boolean {
  if (!url) {
    return false;
  }

  return /:\/\/[^/]+\/sidepanel\.html(?:[?#]|$)/i.test(url.trim());
}

export function isWorkspaceSettingsSidepanelUrl(url: string | undefined): boolean {
  if (!url || !isSidepanelUrl(url)) {
    return false;
  }

  try {
    const parsedUrl = new URL(url.trim());
    const route = parsedUrl.searchParams.get('route');
    if (!route) {
      return false;
    }

    const [pathname, query = ''] = route.split('?');
    return pathname === '/settings' && new URLSearchParams(query).get('mode') === 'workspace';
  } catch {
    return false;
  }
}

export function isChatContextCandidateUrl(url: string | undefined): boolean {
  if (!url) {
    return false;
  }

  const normalized = url.trim();
  if (!normalized || isSidepanelUrl(normalized)) {
    return false;
  }

  try {
    return !INVALID_CONTEXT_PROTOCOLS.has(new URL(normalized).protocol.toLowerCase());
  } catch {
    return false;
  }
}

export function shouldAttachBrowserContextForPrompt(prompt: string | undefined): boolean {
  void prompt;
  return false;
}

export function pickPreferredBrowserTab(
  tabs: BrowserTabLike[],
  preferredWindowId?: number
): BrowserTabLike | undefined {
  return tabs
    .filter((tab) => typeof tab.id === 'number' && isChatContextCandidateUrl(tab.url))
    .sort((left, right) => {
      const leftSameWindow = left.windowId === preferredWindowId ? 1 : 0;
      const rightSameWindow = right.windowId === preferredWindowId ? 1 : 0;
      if (leftSameWindow !== rightSameWindow) {
        return rightSameWindow - leftSameWindow;
      }

      const leftActive = left.active ? 1 : 0;
      const rightActive = right.active ? 1 : 0;
      if (leftActive !== rightActive) {
        return rightActive - leftActive;
      }

      const leftHighlighted = left.highlighted ? 1 : 0;
      const rightHighlighted = right.highlighted ? 1 : 0;
      if (leftHighlighted !== rightHighlighted) {
        return rightHighlighted - leftHighlighted;
      }

      const leftComplete = left.status === 'complete' ? 1 : 0;
      const rightComplete = right.status === 'complete' ? 1 : 0;
      if (leftComplete !== rightComplete) {
        return rightComplete - leftComplete;
      }

      return (right.lastAccessed || 0) - (left.lastAccessed || 0);
    })[0];
}

function toBrowserContext(tab: BrowserTabLike, fallbackWindowId?: number): BrowserContext | undefined {
  if (typeof tab.id !== 'number') {
    return undefined;
  }

  return {
    windowId: tab.windowId ?? fallbackWindowId,
    tabId: tab.id,
    title: tab.title,
    url: tab.url,
  };
}

function toBrowserContextWithSource(
  tab: BrowserTabLike,
  source: BrowserContext['source'],
  fallbackWindowId?: number
): BrowserContext | undefined {
  const context = toBrowserContext(tab, fallbackWindowId);
  if (!context) {
    return undefined;
  }

  return {
    ...context,
    source,
  };
}

export async function getBrowserContext(): Promise<BrowserContext | undefined> {
  try {
    const [lastFocusedActiveTab] = await chrome.tabs.query({
      active: true,
      lastFocusedWindow: true,
    });
    const lastFocusedWindowId =
      typeof lastFocusedActiveTab?.windowId === 'number'
        ? lastFocusedActiveTab.windowId
        : undefined;

    if (lastFocusedActiveTab && isChatContextCandidateUrl(lastFocusedActiveTab.url)) {
      return toBrowserContextWithSource(lastFocusedActiveTab, 'active-tab', lastFocusedWindowId);
    }

    if (isWorkspaceSettingsSidepanelUrl(lastFocusedActiveTab?.url)) {
      return { windowId: lastFocusedWindowId, source: 'window-only' };
    }

    if (lastFocusedWindowId !== undefined) {
      const lastFocusedWindowTabs = await chrome.tabs.query({ windowId: lastFocusedWindowId });
      const preferredLastFocusedWindowTab = pickPreferredBrowserTab(
        lastFocusedWindowTabs,
        lastFocusedWindowId
      );
      if (preferredLastFocusedWindowTab) {
        return toBrowserContextWithSource(
          preferredLastFocusedWindowTab,
          'window-fallback',
          lastFocusedWindowId
        );
      }
    }

    const currentWindow = await chrome.windows.getCurrent({ populate: false });
    const currentWindowId = typeof currentWindow.id === 'number' ? currentWindow.id : undefined;
    const [currentActiveTab] = await chrome.tabs.query(
      currentWindowId !== undefined
        ? { active: true, windowId: currentWindowId }
        : { active: true, currentWindow: true }
    );
    if (currentActiveTab && isChatContextCandidateUrl(currentActiveTab.url)) {
      return toBrowserContextWithSource(currentActiveTab, 'active-tab', currentWindowId);
    }

    if (isWorkspaceSettingsSidepanelUrl(currentActiveTab?.url)) {
      return { windowId: currentWindowId ?? lastFocusedWindowId, source: 'window-only' };
    }

    if (currentWindowId !== undefined) {
      const currentWindowTabs = await chrome.tabs.query({ windowId: currentWindowId });
      const preferredCurrentWindowTab = pickPreferredBrowserTab(currentWindowTabs, currentWindowId);
      if (preferredCurrentWindowTab) {
        return toBrowserContextWithSource(
          preferredCurrentWindowTab,
          'window-fallback',
          currentWindowId
        );
      }
    }

    const lastFocusedTabs = await chrome.tabs.query({ lastFocusedWindow: true });
    const preferredLastFocusedTab = pickPreferredBrowserTab(
      lastFocusedTabs,
      lastFocusedWindowId ?? currentWindowId
    );
    if (preferredLastFocusedTab) {
      return toBrowserContextWithSource(
        preferredLastFocusedTab,
        'window-fallback',
        lastFocusedWindowId ?? currentWindowId
      );
    }

    return { windowId: lastFocusedWindowId ?? currentWindowId, source: 'window-only' };
  } catch (error) {
    console.debug('[browser-context] Failed to resolve browser context:', error);
    return undefined;
  }
}
