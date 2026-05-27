// @vitest-environment node

import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  getBrowserContext,
  isChatContextCandidateUrl,
  isSidepanelUrl,
  isWorkspaceSettingsSidepanelUrl,
  pickPreferredBrowserTab,
  shouldAttachBrowserContextForPrompt,
} from './browser-context';

const getCurrentWindow = vi.fn();
const queryTabs = vi.fn();

describe('browser context resolution', () => {
  beforeEach(() => {
    getCurrentWindow.mockReset();
    queryTabs.mockReset();
    vi.stubGlobal('chrome', {
      windows: {
        getCurrent: getCurrentWindow,
      },
      tabs: {
        query: queryTabs,
      },
    });
  });

  it('filters only the sidepanel page while keeping other extension pages available', () => {
    expect(isSidepanelUrl('chrome-extension://abc/sidepanel.html?route=%2Fchat')).toBe(true);
    expect(isChatContextCandidateUrl('chrome-extension://abc/sidepanel.html?route=%2Fchat')).toBe(
      false
    );
    expect(
      isWorkspaceSettingsSidepanelUrl(
        'chrome-extension://abc/sidepanel.html?route=%2Fsettings%3Fmode%3Dworkspace'
      )
    ).toBe(true);
    expect(
      isWorkspaceSettingsSidepanelUrl('chrome-extension://abc/sidepanel.html?route=%2Fchat')
    ).toBe(false);
    expect(
      isChatContextCandidateUrl('https://doc.midea.com/teamKnowledge/detail/docOnline/1')
    ).toBe(true);
    expect(isChatContextCandidateUrl('edge://extensions/')).toBe(true);
    expect(isChatContextCandidateUrl('chrome-extension://abc/custom-page.html')).toBe(true);
  });

  it('falls back to a real page tab in the same window when the active tab is the sidepanel', async () => {
    getCurrentWindow.mockResolvedValue({ id: 99 });
    queryTabs
      .mockResolvedValueOnce([
        {
          id: 9001,
          windowId: 99,
          active: true,
          status: 'complete',
          title: 'Extension Side Panel',
          url: 'chrome-extension://ext-id/sidepanel.html?route=%2Fchat',
          lastAccessed: 100,
        },
      ])
      .mockResolvedValueOnce([
        {
          id: 9001,
          windowId: 99,
          active: true,
          status: 'complete',
          title: 'Extension Side Panel',
          url: 'chrome-extension://ext-id/sidepanel.html?route=%2Fchat',
          lastAccessed: 100,
        },
        {
          id: 42,
          windowId: 99,
          active: false,
          highlighted: true,
          status: 'complete',
          title: 'Document',
          url: 'https://doc.midea.com/teamKnowledge/detail/docOnline/2054571230237982721?id=1',
          lastAccessed: 999,
        },
      ]);

    await expect(getBrowserContext()).resolves.toEqual({
      windowId: 99,
      tabId: 42,
      title: 'Document',
      url: 'https://doc.midea.com/teamKnowledge/detail/docOnline/2054571230237982721?id=1',
      source: 'window-fallback',
    });

    expect(queryTabs).toHaveBeenNthCalledWith(1, { active: true, lastFocusedWindow: true });
    expect(queryTabs).toHaveBeenNthCalledWith(2, { windowId: 99 });
  });

  it('prefers the last focused real active page even if currentWindow points elsewhere', async () => {
    getCurrentWindow.mockResolvedValue({ id: 1045825112 });
    queryTabs.mockResolvedValueOnce([
      {
        id: 1141706025,
        windowId: 1141705931,
        active: true,
        status: 'complete',
        title: 'Document',
        url: 'https://webedit.midea.com/moewebv7/document-cloud?editId=current',
        lastAccessed: 2000,
      },
    ]);

    await expect(getBrowserContext()).resolves.toEqual({
      windowId: 1141705931,
      tabId: 1141706025,
      title: 'Document',
      url: 'https://webedit.midea.com/moewebv7/document-cloud?editId=current',
      source: 'active-tab',
    });

    expect(queryTabs).toHaveBeenCalledTimes(1);
    expect(queryTabs).toHaveBeenNthCalledWith(1, { active: true, lastFocusedWindow: true });
    expect(getCurrentWindow).not.toHaveBeenCalled();
  });

  it('pickPreferredBrowserTab prefers the same window and most relevant real page', () => {
    const picked = pickPreferredBrowserTab(
      [
        {
          id: 1,
          windowId: 20,
          active: true,
          highlighted: true,
          status: 'complete',
          title: 'Sidepanel',
          url: 'chrome-extension://ext-id/sidepanel.html',
          lastAccessed: 500,
        },
        {
          id: 2,
          windowId: 20,
          active: false,
          highlighted: true,
          status: 'complete',
          title: 'Doc',
          url: 'https://doc.midea.com/detail/1',
          lastAccessed: 900,
        },
        {
          id: 3,
          windowId: 21,
          active: true,
          highlighted: true,
          status: 'complete',
          title: 'Other',
          url: 'https://example.com',
          lastAccessed: 1200,
        },
      ],
      20
    );

    expect(picked?.id).toBe(2);
  });

  it('returns window-only context when no usable page tab exists', async () => {
    getCurrentWindow.mockResolvedValue({ id: 77 });
    queryTabs
      .mockResolvedValueOnce([
        {
          id: 7001,
          windowId: 77,
          active: true,
          status: 'complete',
          title: 'Extension Side Panel',
          url: 'chrome-extension://ext-id/sidepanel.html?route=%2Fchat',
          lastAccessed: 100,
        },
      ])
      .mockResolvedValueOnce([
        {
          id: 7001,
          windowId: 77,
          active: true,
          status: 'complete',
          title: 'Extension Side Panel',
          url: 'chrome-extension://ext-id/sidepanel.html?route=%2Fchat',
          lastAccessed: 100,
        },
      ])
      .mockResolvedValueOnce([
        {
          id: 7001,
          windowId: 77,
          active: true,
          status: 'complete',
          title: 'Extension Side Panel',
          url: 'chrome-extension://ext-id/sidepanel.html?route=%2Fchat',
          lastAccessed: 100,
        },
      ])
      .mockResolvedValueOnce([
        {
          id: 7001,
          windowId: 77,
          active: true,
          status: 'complete',
          title: 'Extension Side Panel',
          url: 'chrome-extension://ext-id/sidepanel.html?route=%2Fchat',
          lastAccessed: 100,
        },
      ])
      .mockResolvedValueOnce([
        {
          id: 7001,
          windowId: 77,
          active: true,
          status: 'complete',
          title: 'Extension Side Panel',
          url: 'chrome-extension://ext-id/sidepanel.html?route=%2Fchat',
          lastAccessed: 100,
        },
      ]);

    await expect(getBrowserContext()).resolves.toEqual({ windowId: 77, source: 'window-only' });

    expect(queryTabs).toHaveBeenNthCalledWith(1, { active: true, lastFocusedWindow: true });
    expect(queryTabs).toHaveBeenNthCalledWith(2, { windowId: 77 });
    expect(queryTabs).toHaveBeenNthCalledWith(3, { active: true, windowId: 77 });
    expect(queryTabs).toHaveBeenNthCalledWith(4, { windowId: 77 });
    expect(queryTabs).toHaveBeenNthCalledWith(5, { lastFocusedWindow: true });
  });

  it('does not lock a random tab when workspace settings is the active tab', async () => {
    getCurrentWindow.mockResolvedValue({ id: 99 });
    queryTabs.mockResolvedValueOnce([
      {
        id: 9001,
        windowId: 99,
        active: true,
        status: 'complete',
        title: 'Extension Side Panel',
        url: 'chrome-extension://ext-id/sidepanel.html?route=%2Fsettings%3Fmode%3Dworkspace',
        lastAccessed: 100,
      },
    ]);

    await expect(getBrowserContext()).resolves.toEqual({
      windowId: 99,
      source: 'window-only',
    });

    expect(queryTabs).toHaveBeenCalledTimes(1);
    expect(queryTabs).toHaveBeenNthCalledWith(1, { active: true, lastFocusedWindow: true });
    expect(getCurrentWindow).not.toHaveBeenCalled();
  });

  it('does not auto-attach browser context from prompt heuristics anymore', () => {
    expect(shouldAttachBrowserContextForPrompt('帮我总结当前页面内容')).toBe(false);
    expect(shouldAttachBrowserContextForPrompt('帮我操作这个标签页里的按钮')).toBe(false);
    expect(shouldAttachBrowserContextForPrompt('创建一个 html 页面')).toBe(false);
    expect(shouldAttachBrowserContextForPrompt('写一个 dashboard.html')).toBe(false);
  });
});
