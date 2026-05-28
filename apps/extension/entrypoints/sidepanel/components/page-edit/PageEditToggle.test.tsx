// @vitest-environment node

import { JSDOM } from 'jsdom';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const activateMutateAsync = vi.fn();
const deactivateMutateAsync = vi.fn();
const getStateRefetch = vi.fn();
const getBrowserContext = vi.fn();

let queryState: unknown = null;
let queryLoading = false;
let activatePending = false;
let deactivatePending = false;

vi.mock('../../lib/browser-context', () => ({
  getBrowserContext,
}));

vi.mock('../../lib/trpc_client', () => ({
  trpc: {
    pageEdit: {
      getState: {
        useQuery: () => ({
          data: queryState,
          isLoading: queryLoading,
          refetch: getStateRefetch,
        }),
      },
      activate: {
        useMutation: () => ({
          mutateAsync: activateMutateAsync,
          isPending: activatePending,
        }),
      },
      deactivate: {
        useMutation: () => ({
          mutateAsync: deactivateMutateAsync,
          isPending: deactivatePending,
        }),
      },
    },
  },
}));

describe('PageEditToggle', () => {
  beforeAll(() => {
    const dom = new JSDOM('<!doctype html><html><body></body></html>', {
      url: 'https://example.com',
    });
    vi.stubGlobal('TextEncoder', globalThis.TextEncoder);
    vi.stubGlobal('TextDecoder', globalThis.TextDecoder);
    vi.stubGlobal('window', dom.window);
    vi.stubGlobal('document', dom.window.document);
    vi.stubGlobal('navigator', dom.window.navigator);
    vi.stubGlobal('HTMLElement', dom.window.HTMLElement);
    vi.stubGlobal('Node', dom.window.Node);
    vi.stubGlobal('getComputedStyle', dom.window.getComputedStyle.bind(dom.window));
  });

  afterEach(async () => {
    const { cleanup } = await import('@testing-library/react');
    cleanup();
  });

  beforeEach(() => {
    document.body.innerHTML = '';
    activateMutateAsync.mockReset();
    deactivateMutateAsync.mockReset();
    getStateRefetch.mockReset();
    getBrowserContext.mockReset();
    queryState = null;
    queryLoading = false;
    activatePending = false;
    deactivatePending = false;
  });

  it('shows inactive state by default and can activate page edit', async () => {
    const { fireEvent, render, screen } = await import('@testing-library/react');
    const { PageEditToggle } = await import('./PageEditToggle');
    getBrowserContext.mockResolvedValue({
      windowId: 1,
      tabId: 88,
      title: 'Example',
      url: 'https://example.com',
    });
    activateMutateAsync.mockResolvedValueOnce({
      tabId: 88,
      windowId: 1,
      url: 'file:///Users/demo/capture/index.html',
      status: 'active',
      activatedAt: 123,
      pageMode: 'local-snapshot',
      capabilities: {
        canAnnotate: true,
        canCapture: true,
        canSend: true,
        canEdit: true,
        canSave: true,
      },
    });

    render(<PageEditToggle />);

    expect(await screen.findByText('网页编辑未开启')).toBeTruthy();
    expect(screen.getByRole('button', { name: '进入编辑' })).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: '进入编辑' }));

    expect(await screen.findByText('页面工作台 · 本地快照')).toBeTruthy();
    expect(
      await screen.findByText('已进入页面工作台（本地快照），支持编辑、保存、发送、二次采集、备注')
    ).toBeTruthy();
    expect(screen.getByRole('button', { name: '退出编辑' })).toBeTruthy();
    expect(activateMutateAsync).toHaveBeenCalledTimes(1);
  });

  it('deactivates page edit with the resolved tab id when already active', async () => {
    const { fireEvent, render, screen } = await import('@testing-library/react');
    const { PageEditToggle } = await import('./PageEditToggle');
    queryState = {
      tabId: 77,
      windowId: 1,
      url: 'https://example.com/doc',
      status: 'active',
      activatedAt: 123,
      pageMode: 'live-page',
      capabilities: {
        canAnnotate: true,
        canCapture: true,
        canSend: true,
        canEdit: false,
        canSave: false,
      },
    };
    getBrowserContext.mockResolvedValue({
      windowId: 1,
      tabId: 77,
      title: 'Example',
      url: 'https://example.com/doc',
    });
    deactivateMutateAsync.mockResolvedValueOnce(null);

    render(<PageEditToggle />);

    expect(await screen.findByText('页面工作台 · 真实网页')).toBeTruthy();
    expect(await screen.findByText('支持标注、发送、采集')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: '退出编辑' }));

    await screen.findByText('页面工作台已关闭');
    expect(deactivateMutateAsync).toHaveBeenCalledWith({ tabId: 77 });
    expect(screen.getByRole('button', { name: '进入编辑' })).toBeTruthy();
  });

  it('allows reopening immediately after close succeeds even if state refetch is still pending', async () => {
    const { fireEvent, render, screen } = await import('@testing-library/react');
    const { PageEditToggle } = await import('./PageEditToggle');
    queryState = {
      tabId: 77,
      windowId: 1,
      url: 'https://example.com/doc',
      status: 'active',
      activatedAt: 123,
      pageMode: 'live-page',
      capabilities: {
        canAnnotate: true,
        canCapture: true,
        canSend: true,
        canEdit: false,
        canSave: false,
      },
    };
    getBrowserContext.mockResolvedValue({
      windowId: 1,
      tabId: 77,
      title: 'Example',
      url: 'https://example.com/doc',
    });
    deactivateMutateAsync.mockResolvedValueOnce(null);
    getStateRefetch.mockImplementationOnce(
      () =>
        new Promise(() => {
          // keep refetch pending to verify the button is unlocked before it settles
        })
    );

    render(<PageEditToggle />);

    fireEvent.click(await screen.findByRole('button', { name: '退出编辑' }));

    await screen.findByText('页面工作台已关闭');
    const reopenButton = screen.getByRole('button', { name: '进入编辑' });
    expect(reopenButton.hasAttribute('disabled')).toBe(false);
  });

  it('keeps the toggle disabled and shows deactivating feedback until close finishes', async () => {
    const { fireEvent, render, screen } = await import('@testing-library/react');
    const { PageEditToggle } = await import('./PageEditToggle');
    queryState = {
      tabId: 77,
      windowId: 1,
      url: 'https://example.com/doc',
      status: 'active',
      activatedAt: 123,
      pageMode: 'live-page',
      capabilities: {
        canAnnotate: true,
        canCapture: true,
        canSend: true,
        canEdit: false,
        canSave: false,
      },
    };
    getBrowserContext.mockResolvedValue({
      windowId: 1,
      tabId: 77,
      title: 'Example',
      url: 'https://example.com/doc',
    });
    deactivateMutateAsync.mockImplementationOnce(() => new Promise(() => {}));

    render(<PageEditToggle />);

    const button = await screen.findByRole('button', { name: '退出编辑' });
    fireEvent.click(button);

    expect(await screen.findByText('正在关闭页面工作台...')).toBeTruthy();
    expect(screen.queryByText('页面工作台已关闭')).toBeNull();
    expect(screen.getByRole('button', { name: '进入编辑' }).hasAttribute('disabled')).toBe(true);
  });

  it('shows backend error message when activation fails', async () => {
    const { fireEvent, render, screen } = await import('@testing-library/react');
    const { PageEditToggle } = await import('./PageEditToggle');
    getBrowserContext.mockResolvedValue({
      windowId: 1,
      tabId: 5,
      title: 'Unsupported',
      url: 'chrome://extensions',
    });
    activateMutateAsync.mockRejectedValueOnce(new Error('当前页面不支持网页编辑'));

    render(<PageEditToggle />);

    fireEvent.click(await screen.findByRole('button', { name: '进入编辑' }));

    expect(await screen.findByText('当前页面不支持网页编辑')).toBeTruthy();
  });

  it('shows loading text before current tab state is resolved', async () => {
    const { render, screen, waitFor } = await import('@testing-library/react');
    const { PageEditToggle } = await import('./PageEditToggle');
    getBrowserContext.mockImplementation(
      () =>
        new Promise((resolve) => {
          setTimeout(() => resolve({ windowId: 1, tabId: 6, url: 'https://example.com' }), 0);
        })
    );

    render(<PageEditToggle />);

    expect(screen.getByText('正在读取网页编辑状态...')).toBeTruthy();

    await waitFor(() => {
      expect(screen.getByText('网页编辑未开启')).toBeTruthy();
    });
  });
});
