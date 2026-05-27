// @vitest-environment node

import { describe, expect, it, vi } from 'vitest';
import {
  buildSidepanelRouteUrl,
  openSidepanelRoute,
  SIDEPANEL_MENU_ITEMS,
} from './sidepanel-menu';

describe('sidepanel menu helpers', () => {
  it('builds extension URLs for internal sidepanel routes', () => {
    const getURL = vi.fn((path: string) => `chrome-extension://extension-id${path}`);

    expect(buildSidepanelRouteUrl('/settings?mode=mcp', getURL)).toBe(
      'chrome-extension://extension-id/sidepanel.html?route=%2Fsettings%3Fmode%3Dmcp'
    );
    expect(buildSidepanelRouteUrl('/userscripts?mode=list', getURL)).toBe(
      'chrome-extension://extension-id/sidepanel.html?route=%2Fuserscripts%3Fmode%3Dlist'
    );
    expect(buildSidepanelRouteUrl('/settings?mode=plugins', getURL)).toBe(
      'chrome-extension://extension-id/sidepanel.html?route=%2Fsettings%3Fmode%3Dplugins'
    );
    expect(buildSidepanelRouteUrl('/settings?mode=workspace', getURL)).toBe(
      'chrome-extension://extension-id/sidepanel.html?route=%2Fsettings%3Fmode%3Dworkspace'
    );
    expect(buildSidepanelRouteUrl('/settings?mode=userscripts', getURL)).toBe(
      'chrome-extension://extension-id/sidepanel.html?route=%2Fsettings%3Fmode%3Duserscripts'
    );
  });

  it('maps 工作区会话 menu item to the settings workspace tab', () => {
    expect(SIDEPANEL_MENU_ITEMS.find((item) => item.id === 'sessions')?.route).toBe(
      '/settings?mode=workspace'
    );
  });

  it('maps 用户脚本 menu item to the settings userscripts tab', () => {
    expect(SIDEPANEL_MENU_ITEMS.find((item) => item.id === 'userscripts')?.route).toBe(
      '/settings?mode=userscripts'
    );
  });

  it('keeps the overflow menu items in the same numbered order as settings', () => {
    expect(SIDEPANEL_MENU_ITEMS.map((item) => item.label)).toEqual([
      '工作区会话',
      '模型设置',
      'MCP 工具',
      '技能管理',
      '插件管理',
      '命令管理',
      '钩子管理',
      '用户脚本',
    ]);
  });

  it('opens internal routes in a browser tab', async () => {
    const tabsCreate = vi.fn().mockResolvedValue({});
    const tabsQuery = vi.fn().mockResolvedValue([]);
    const tabsUpdate = vi.fn();
    const tabsRemove = vi.fn();
    const getURL = vi.fn((path: string) => `chrome-extension://extension-id${path}`);
    const open = vi.fn();

    await openSidepanelRoute('/settings', {
      tabsCreate,
      tabsQuery,
      tabsUpdate,
      tabsRemove,
      getURL,
      open,
    });

    expect(tabsCreate).toHaveBeenCalledWith({
      url: 'chrome-extension://extension-id/sidepanel.html?route=%2Fsettings',
      active: true,
    });
    expect(open).not.toHaveBeenCalled();
  });

  it('falls back to window.open when chrome tabs cannot open', async () => {
    const tabsCreate = vi.fn().mockRejectedValue(new Error('tabs unavailable'));
    const tabsQuery = vi.fn().mockResolvedValue([]);
    const tabsUpdate = vi.fn();
    const tabsRemove = vi.fn();
    const getURL = vi.fn((path: string) => `chrome-extension://extension-id${path}`);
    const open = vi.fn();

    await openSidepanelRoute('/settings?mode=mcp', {
      tabsCreate,
      tabsQuery,
      tabsUpdate,
      tabsRemove,
      getURL,
      open,
    });

    expect(open).toHaveBeenCalledWith(
      'chrome-extension://extension-id/sidepanel.html?route=%2Fsettings%3Fmode%3Dmcp',
      '_blank',
      'noopener,noreferrer'
    );
  });

  it('reuses the existing matching tab in the current window', async () => {
    const tabsCreate = vi.fn();
    const tabsQuery = vi.fn().mockResolvedValue([
      { id: 11, windowId: 3, url: 'chrome-extension://extension-id/sidepanel.html?route=%2Fsettings' },
    ]);
    const tabsUpdate = vi.fn().mockResolvedValue({});
    const tabsRemove = vi.fn();
    const getURL = vi.fn((path: string) => `chrome-extension://extension-id${path}`);
    const open = vi.fn();

    await openSidepanelRoute('/settings', {
      tabsCreate,
      tabsQuery,
      tabsUpdate,
      tabsRemove,
      getURL,
      open,
    });

    expect(tabsQuery).toHaveBeenCalledWith({
      currentWindow: true,
      url: 'chrome-extension://extension-id/sidepanel.html?route=%2Fsettings',
    });
    expect(tabsUpdate).toHaveBeenCalledWith(11, {
      active: true,
      url: 'chrome-extension://extension-id/sidepanel.html?route=%2Fsettings',
    });
    expect(tabsCreate).not.toHaveBeenCalled();
    expect(tabsRemove).not.toHaveBeenCalled();
  });

  it('removes duplicate matching tabs in the current window and keeps one', async () => {
    const tabsCreate = vi.fn();
    const tabsQuery = vi.fn().mockResolvedValue([
      { id: 11, windowId: 3, url: 'chrome-extension://extension-id/sidepanel.html?route=%2Fsettings%3Fmode%3Dworkspace' },
      { id: 15, windowId: 3, url: 'chrome-extension://extension-id/sidepanel.html?route=%2Fsettings%3Fmode%3Dworkspace' },
      { id: 18, windowId: 3, url: 'chrome-extension://extension-id/sidepanel.html?route=%2Fsettings%3Fmode%3Dworkspace' },
    ]);
    const tabsUpdate = vi.fn().mockResolvedValue({});
    const tabsRemove = vi.fn().mockResolvedValue(undefined);
    const getURL = vi.fn((path: string) => `chrome-extension://extension-id${path}`);
    const open = vi.fn();

    await openSidepanelRoute('/settings?mode=workspace', {
      tabsCreate,
      tabsQuery,
      tabsUpdate,
      tabsRemove,
      getURL,
      open,
    });

    expect(tabsUpdate).toHaveBeenCalledWith(11, {
      active: true,
      url: 'chrome-extension://extension-id/sidepanel.html?route=%2Fsettings%3Fmode%3Dworkspace',
    });
    expect(tabsRemove).toHaveBeenCalledWith([15, 18]);
    expect(tabsCreate).not.toHaveBeenCalled();
  });
  it('maps MCP menu item to the settings mcp tab', () => {
    expect(SIDEPANEL_MENU_ITEMS.find((item) => item.id === 'mcp-tools')?.route).toBe(
      '/settings?mode=mcp'
    );
  });
});
