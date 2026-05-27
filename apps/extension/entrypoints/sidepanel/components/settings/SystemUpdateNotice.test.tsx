// @vitest-environment node

import { fireEvent, render, waitFor } from '@testing-library/react';
import { JSDOM } from 'jsdom';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import type { SystemUpdateInfo } from '../../lib/agent-v2/types';

let dom: JSDOM;

beforeAll(() => {
  dom = new JSDOM('<!doctype html><html><body></body></html>', {
    url: 'https://example.com',
  });

  vi.stubGlobal('TextEncoder', globalThis.TextEncoder);
  vi.stubGlobal('TextDecoder', globalThis.TextDecoder);
  vi.stubGlobal('window', dom.window);
  vi.stubGlobal('document', dom.window.document);
  vi.stubGlobal('navigator', dom.window.navigator);
  vi.stubGlobal('HTMLElement', dom.window.HTMLElement);
  vi.stubGlobal('HTMLInputElement', dom.window.HTMLInputElement);
  vi.stubGlobal('HTMLTextAreaElement', dom.window.HTMLTextAreaElement);
  vi.stubGlobal('HTMLSelectElement', dom.window.HTMLSelectElement);
  vi.stubGlobal('Element', dom.window.Element);
  vi.stubGlobal('Node', dom.window.Node);
  vi.stubGlobal('NodeFilter', dom.window.NodeFilter);
  vi.stubGlobal('Event', dom.window.Event);
  vi.stubGlobal('CustomEvent', dom.window.CustomEvent);
  vi.stubGlobal('MouseEvent', dom.window.MouseEvent);
  vi.stubGlobal('KeyboardEvent', dom.window.KeyboardEvent);
  vi.stubGlobal('FocusEvent', dom.window.FocusEvent);
  vi.stubGlobal('MutationObserver', dom.window.MutationObserver);
  vi.stubGlobal('getComputedStyle', dom.window.getComputedStyle.bind(dom.window));
});

afterEach(async () => {
  const { cleanup } = await import('@testing-library/react');
  cleanup();
  vi.useRealTimers();
});

describe('SystemUpdateNotice', () => {
  async function renderNotice(input: {
    info: SystemUpdateInfo | null;
    loading: boolean;
    onStartUpdate: () => Promise<{ success: boolean; message?: string; error?: string }>;
    onPollUpdateInfo?: () => Promise<SystemUpdateInfo>;
  }) {
    const { SystemUpdateNotice } = await import('./SystemUpdateNotice');
    return render(<SystemUpdateNotice {...input} />);
  }

  it('renders nothing when no update is available', async () => {
    const view = await renderNotice({
      info: { updateAvailable: false },
      loading: false,
      onStartUpdate: vi.fn(async () => ({ success: true })),
      onPollUpdateInfo: vi.fn(async () => ({ updateAvailable: false })),
    });
    expect(view.container.textContent).not.toContain('发现新版本');
  });

  it('confirms and starts update when user clicks update now', async () => {
    const onStartUpdate = vi.fn(async () => ({ success: true, message: '服务会重启' }));
    const view = await renderNotice({
      info: {
        updateAvailable: true,
        packageId: 'W/"etag"',
        packageUrl: 'https://example.com/webmcp.zip',
        projectUrl: 'https://example.com/project',
        distribution: 'windows-lite',
      },
      loading: false,
      onStartUpdate,
      onPollUpdateInfo: vi.fn(async () => ({
        updateAvailable: false,
        packageId: 'W/"etag"',
        currentPackageId: 'W/"etag"',
      })),
    });
    fireEvent.click(view.getByRole('button', { name: '查看更新' }));
    expect(await view.findByText('accr Lite 更新可用')).toBeTruthy();
    fireEvent.click(view.getByRole('button', { name: '立即更新' }));
    await waitFor(() => expect(onStartUpdate).toHaveBeenCalledTimes(1));
    expect(await view.findByText('服务会重启')).toBeTruthy();
  });

  it('waits for the installed package id to catch up before reloading the extension', async () => {
    vi.useFakeTimers();
    const reload = vi.fn();
    const getCurrent = vi.fn(async () => ({ id: 17 }));
    const set = vi.fn(async () => undefined);
    const onPollUpdateInfo = vi
      .fn<() => Promise<SystemUpdateInfo>>()
      .mockResolvedValueOnce({
        updateAvailable: true,
        packageId: 'beta.1.0.1',
        currentPackageId: 'beta.1.0.0',
        distribution: 'mac-lite',
      })
      .mockResolvedValueOnce({
        updateAvailable: false,
        packageId: 'beta.1.0.1',
        currentPackageId: 'beta.1.0.1',
        distribution: 'mac-lite',
      });
    vi.stubGlobal('chrome', {
      runtime: {
        reload,
      },
      windows: {
        getCurrent,
      },
      storage: {
        local: {
          set,
        },
      },
    });

    const onStartUpdate = vi.fn(async () => ({ success: true, message: '服务会重启' }));
    const view = await renderNotice({
      info: {
        updateAvailable: true,
        packageId: 'beta.1.0.1',
        packageUrl: 'https://example.com/webmcp.zip',
        projectUrl: 'https://example.com/project',
        distribution: 'mac-lite',
      },
      loading: false,
      onStartUpdate,
      onPollUpdateInfo,
    });

    fireEvent.click(view.getByRole('button', { name: '查看更新' }));
    fireEvent.click(view.getByRole('button', { name: '立即更新' }));

    await Promise.resolve();
    await Promise.resolve();

    expect(onStartUpdate).toHaveBeenCalledTimes(1);
    expect(getCurrent).toHaveBeenCalledTimes(1);
    expect(set).toHaveBeenCalledWith({
      'webmcp:pending-sidepanel-reopen': expect.objectContaining({
        windowId: 17,
      }),
    });
    await vi.advanceTimersByTimeAsync(1200);

    expect(onPollUpdateInfo).toHaveBeenCalledTimes(1);
    expect(reload).toHaveBeenCalledTimes(0);

    await vi.advanceTimersByTimeAsync(1200);
    await Promise.resolve();
    await Promise.resolve();

    expect(onPollUpdateInfo).toHaveBeenCalledTimes(2);
    expect(reload).toHaveBeenCalledTimes(1);
  });
});
