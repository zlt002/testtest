function isNoServiceWorkerError(error: unknown): boolean {
  return error instanceof Error && error.message.includes('No SW');
}

const PENDING_SIDE_PANEL_REOPEN_KEY = 'webmcp:pending-sidepanel-reopen';

async function reopenPendingSidepanel() {
  try {
    const payload = await chrome.storage?.local?.get?.(PENDING_SIDE_PANEL_REOPEN_KEY);
    const pending = payload?.[PENDING_SIDE_PANEL_REOPEN_KEY] as
      | { windowId?: number; requestedAt?: number }
      | undefined;
    if (!pending?.windowId) {
      return;
    }

    await chrome.storage?.local?.remove?.(PENDING_SIDE_PANEL_REOPEN_KEY);
    await chrome.sidePanel.open({ windowId: pending.windowId });
  } catch (error) {
    if (isNoServiceWorkerError(error)) {
      console.warn('[Background] Pending side panel reopen skipped during SW reload');
      return;
    }
    console.warn('[Background] Failed to reopen pending side panel:', error);
  }
}

export function initSidepanelHandlers(): void {
  chrome.runtime.onMessage.addListener((message) => {
    if (message.action === 'open-sidepanel') {
      chrome.windows.getCurrent((window) => {
        if (!window?.id) return;
        chrome.sidePanel.open({ windowId: window.id });
      });
    }
  });

  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch((error) => {
    if (isNoServiceWorkerError(error)) {
      console.warn('[Background] Side panel behavior skipped during SW reload');
      return;
    }
    console.error('[Background] Failed to set side panel behavior:', error);
  });

  void reopenPendingSidepanel();
}
