export type SidepanelRoute =
  | '/settings'
  | '/settings?mode=mcp'
  | '/settings?mode=workspace'
  | '/settings?mode=userscripts'
  | '/settings?mode=plugins'
  | '/settings?mode=skills'
  | '/settings?mode=commands'
  | '/settings?mode=hooks'
  | '/userscripts';

export interface SidepanelMenuItem {
  id: string;
  label: string;
  description: string;
  route: SidepanelRoute;
}

export const SIDEPANEL_MENU_ITEMS: SidepanelMenuItem[] = [
  {
    id: 'sessions',
    label: '工作区会话',
    description: '查看 Agent V2 历史项目',
    route: '/settings?mode=workspace',
  },
  {
    id: 'settings',
    label: '模型设置',
    description: '模型提供商和 API 配置',
    route: '/settings',
  },
  {
    id: 'mcp-tools',
    label: 'MCP 工具',
    description: '服务、工具权限和连接配置',
    route: '/settings?mode=mcp',
  },
  {
    id: 'skill-management',
    label: '技能管理',
    description: '查看和编辑用户、项目技能',
    route: '/settings?mode=skills',
  },
  {
    id: 'plugin-management',
    label: '插件管理',
    description: '导入、启停和移除 Claude 插件',
    route: '/settings?mode=plugins',
  },
  {
    id: 'command-management',
    label: '命令管理',
    description: '查看和编辑用户、项目命令',
    route: '/settings?mode=commands',
  },
  {
    id: 'hook-management',
    label: '钩子管理',
    description: '查看 Claude Hooks settings 来源',
    route: '/settings?mode=hooks',
  },
  {
    id: 'userscripts',
    label: '用户脚本',
    description: '管理网页脚本工具',
    route: '/settings?mode=userscripts',
  },
];

export function buildSidepanelRouteUrl(
  route: string,
  getURL: (path: string) => string = chrome.runtime.getURL
): string {
  return getURL(`/sidepanel.html?route=${encodeURIComponent(route)}`);
}

export async function openSidepanelRoute(
  route: string,
  deps: {
    tabsCreate?: typeof chrome.tabs.create;
    tabsQuery?: typeof chrome.tabs.query;
    tabsUpdate?: typeof chrome.tabs.update;
    tabsRemove?: typeof chrome.tabs.remove;
    getURL?: (path: string) => string;
    open?: typeof window.open;
  } = {}
): Promise<void> {
  const url = buildSidepanelRouteUrl(route, deps.getURL);
  const tabsCreate = deps.tabsCreate ?? chrome.tabs.create;
  const tabsQuery = deps.tabsQuery ?? chrome.tabs.query;
  const tabsUpdate = deps.tabsUpdate ?? chrome.tabs.update;
  const tabsRemove = deps.tabsRemove ?? chrome.tabs.remove;
  const open = deps.open ?? window.open;

  try {
    const matchingTabs = await tabsQuery({ currentWindow: true, url });
    const [primaryTab, ...duplicateTabs] = matchingTabs;

    if (primaryTab?.id !== undefined) {
      await tabsUpdate(primaryTab.id, {
        active: true,
        url,
      });

      const duplicateTabIds = duplicateTabs
        .map((tab) => tab.id)
        .filter((tabId): tabId is number => typeof tabId === 'number');
      if (duplicateTabIds.length > 0) {
        await tabsRemove(duplicateTabIds);
      }
      return;
    }

    await tabsCreate({ url, active: true });
  } catch {
    open(url, '_blank', 'noopener,noreferrer');
  }
}
