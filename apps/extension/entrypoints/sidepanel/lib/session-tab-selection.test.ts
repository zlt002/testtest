// @vitest-environment node

import { beforeEach, describe, expect, expectTypeOf, it, vi } from 'vitest';
import {
  DEFAULT_SELECTED_TAB_SOURCE,
  createInitialSelectedTabIds,
  derivePrimaryTabId,
  getCurrentWindowTabs,
  pruneSelectedTabIds,
  toSessionTabSummary,
} from './session-tab-selection';
import type { BrowserContextTabSnapshot } from './agent-v2/types';

describe('session tab selection', () => {
  const queryTabs = vi.fn();

  beforeEach(() => {
    queryTabs.mockReset();
    vi.stubGlobal('chrome', {
      tabs: {
        query: queryTabs,
      },
    });
  });

  it('defaults a new session to the current active tab when it is a valid page', () => {
    const selected = createInitialSelectedTabIds([
      {
        tabId: 11,
        windowId: 3,
        title: 'Baidu',
        url: 'https://www.baidu.com',
        active: true,
      },
      {
        tabId: 12,
        windowId: 3,
        title: 'GitHub',
        url: 'https://github.com',
        active: false,
      },
    ]);

    expect(selected).toEqual([11]);
  });

  it('prunes selections whose tabs are no longer in the current window', () => {
    const selected = pruneSelectedTabIds([11, 18], [
      {
        tabId: 11,
        windowId: 3,
        title: 'Baidu',
        url: 'https://www.baidu.com',
        active: true,
      },
    ]);

    expect(selected).toEqual([11]);
  });

  it('derives the primary tab from the active selected tab', () => {
    const primaryTabId = derivePrimaryTabId(
      [12, 11],
      [
        {
          tabId: 11,
          windowId: 3,
          title: 'Baidu',
          url: 'https://www.baidu.com',
          active: false,
        },
        {
          tabId: 12,
          windowId: 3,
          title: 'GitHub',
          url: 'https://github.com',
          active: true,
        },
      ]
    );

    expect(primaryTabId).toBe(12);
  });

  it('falls back to the first surviving selectedTabId order when no selected tab is active', () => {
    const primaryTabId = derivePrimaryTabId(
      [12, 11, 18],
      [
        {
          tabId: 11,
          windowId: 3,
          title: 'Baidu',
          url: 'https://www.baidu.com',
          active: false,
        },
        {
          tabId: 12,
          windowId: 3,
          title: 'GitHub',
          url: 'https://github.com',
          active: false,
        },
      ]
    );

    expect(primaryTabId).toBe(12);
  });

  it('rejects unsupported urls when mapping tabs into session summaries', () => {
    expect(
      toSessionTabSummary({
        id: 9,
        windowId: 2,
        title: 'Extension',
        url: 'chrome-extension://demo/sidepanel.html',
        active: true,
      } as chrome.tabs.Tab)
    ).toBeUndefined();
  });

  it('maps valid browser tabs into session summaries', () => {
    expect(
      toSessionTabSummary({
        id: 7,
        windowId: 2,
        title: 'Docs',
        url: 'https://example.com/docs',
        favIconUrl: 'https://example.com/favicon.ico',
        active: false,
      } as chrome.tabs.Tab)
    ).toEqual({
      tabId: 7,
      windowId: 2,
      title: 'Docs',
      url: 'https://example.com/docs',
      favIconUrl: 'https://example.com/favicon.ico',
      active: false,
    });
  });

  it('lists and normalizes current window tabs', async () => {
    queryTabs.mockResolvedValue([
      {
        id: 7,
        windowId: 2,
        title: 'Docs',
        url: 'https://example.com/docs',
        favIconUrl: 'https://example.com/favicon.ico',
        active: false,
      },
      {
        id: 8,
        windowId: 2,
        title: 'Sidepanel',
        url: 'chrome-extension://demo/sidepanel.html',
        active: true,
      },
      {
        windowId: 2,
        title: 'Missing id',
        url: 'https://example.com/ignored',
        active: false,
      },
    ]);

    await expect(getCurrentWindowTabs()).resolves.toEqual([
      {
        tabId: 7,
        windowId: 2,
        title: 'Docs',
        url: 'https://example.com/docs',
        favIconUrl: 'https://example.com/favicon.ico',
        active: false,
      },
    ]);
    expect(queryTabs).toHaveBeenCalledWith({ currentWindow: true });
  });

  it('exports the expected selected-tab storage source marker', () => {
    expect(DEFAULT_SELECTED_TAB_SOURCE).toBe('current-window');
  });

  it('keeps BrowserContext selected tab snapshots minimal for task 1', () => {
    expectTypeOf<BrowserContextTabSnapshot>().toEqualTypeOf<{
      tabId: number;
      windowId?: number;
      title?: string;
      url?: string;
    }>();
  });
});
