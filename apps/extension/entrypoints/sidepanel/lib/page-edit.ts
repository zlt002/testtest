import { getBrowserContext } from './browser-context';
import type { PageEditState as BackgroundPageEditState } from '@/entrypoints/background/src/services/page-edit';

export type PageEditState = BackgroundPageEditState | null;

export async function resolvePageEditTabId(
  loadBrowserContext: typeof getBrowserContext = getBrowserContext
) {
  const context = await loadBrowserContext();
  return typeof context?.tabId === 'number' ? context.tabId : null;
}

export function isPageEditActive(state: PageEditState) {
  return state?.status === 'active';
}

export function getPageEditToggleLabel(state: PageEditState) {
  return isPageEditActive(state) ? '退出编辑' : '进入编辑';
}

export function getPageEditStatusMessage(state: PageEditState) {
  if (!state) {
    return '网页编辑未开启';
  }

  if (state.status === 'activating') {
    return '正在开启页面工作台...';
  }

  if (state.status === 'capturing') {
    return '正在采集页面内容...';
  }

  if (state.status === 'saving') {
    return '正在保存页面快照...';
  }

  if (state.status === 'deactivating') {
    return '正在关闭页面工作台...';
  }

  return '页面工作台已开启';
}

export function getPageEditSuccessMessage(state: PageEditState) {
  if (isPageEditActive(state)) {
    return getPageEditActivationSuccessMessage(state);
  }

  return '页面工作台已关闭';
}

export function getPageEditModeTitle(state: PageEditState) {
  if (state?.pageMode === 'local-snapshot') {
    return '页面工作台 · 本地快照';
  }

  if (state?.pageMode === 'live-page') {
    return '页面工作台 · 真实网页';
  }

  return '页面工作台';
}

export function getPageEditCapabilityMessage(state: PageEditState) {
  if (!isPageEditActive(state)) {
    return null;
  }

  const activeState = state!;

  if (activeState.pageMode === 'local-snapshot') {
    return '支持编辑、保存、发送、二次采集、备注';
  }

  if (activeState.pageMode === 'live-page') {
    return '支持标注、发送、采集';
  }

  return null;
}

export function getPageEditActivationSuccessMessage(state: PageEditState) {
  if (!isPageEditActive(state)) {
    return '页面工作台已关闭';
  }

  const activeState = state!;

  if (activeState.pageMode === 'local-snapshot') {
    return '已进入页面工作台（本地快照），支持编辑、保存、发送、二次采集、备注';
  }

  if (activeState.pageMode === 'live-page') {
    return '已进入页面工作台（真实网页），支持标注、发送、采集';
  }

  return '页面工作台已开启';
}
