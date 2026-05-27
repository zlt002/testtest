// @vitest-environment node

import { describe, expect, it } from 'vitest';
import {
  getPageEditStatusMessage,
  getPageEditSuccessMessage,
  getPageEditToggleLabel,
  isPageEditActive,
  resolvePageEditTabId,
} from './page-edit';

describe('page edit helpers', () => {
  it('resolves the current browser tab id when available', async () => {
    await expect(
      resolvePageEditTabId(async () => ({
        windowId: 9,
        tabId: 42,
        title: 'Example',
        url: 'https://example.com',
      }))
    ).resolves.toBe(42);
  });

  it('returns null when browser context has no tab id', async () => {
    await expect(resolvePageEditTabId(async () => ({ windowId: 9 }))).resolves.toBeNull();
  });

  it('derives stable labels and messages from page edit state', () => {
    expect(getPageEditToggleLabel(null)).toBe('进入编辑');
    expect(getPageEditToggleLabel({ status: 'active' } as never)).toBe('退出编辑');
    expect(getPageEditStatusMessage(null)).toBe('网页编辑未开启');
    expect(getPageEditStatusMessage({ status: 'activating' } as never)).toBe('正在开启页面工作台...');
    expect(getPageEditStatusMessage({ status: 'active' } as never)).toBe('页面工作台已开启');
    expect(getPageEditStatusMessage({ status: 'capturing' } as never)).toBe('正在采集页面内容...');
    expect(getPageEditStatusMessage({ status: 'saving' } as never)).toBe('正在保存页面快照...');
    expect(getPageEditStatusMessage({ status: 'deactivating' } as never)).toBe(
      '正在关闭页面工作台...'
    );
    expect(getPageEditSuccessMessage(null)).toBe('页面工作台已关闭');
    expect(getPageEditSuccessMessage({ status: 'active' } as never)).toBe('页面工作台已开启');
    expect(isPageEditActive(null)).toBe(false);
    expect(isPageEditActive({ status: 'active' } as never)).toBe(true);
  });
});
