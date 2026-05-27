// @vitest-environment node

import { fireEvent, render, waitFor } from '@testing-library/react';
import { JSDOM } from 'jsdom';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

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
});

describe('SystemUpdateEntry', () => {
  it('renders the update button in global surfaces when update is available', async () => {
    const { SystemUpdateEntry } = await import('./SystemUpdateEntry');
    const client = {
      getSystemUpdateInfo: vi.fn(async () => ({
        updateAvailable: true,
        packageId: 'W/"etag"',
        packageUrl: 'https://example.com/webmcp.zip',
        projectUrl: 'https://example.com/project',
        distribution: 'mac-lite',
      })),
      startSystemUpdate: vi.fn(async () => ({ success: true, message: '服务会重启' })),
    };

    const view = render(<SystemUpdateEntry client={client} />);

    expect(await view.findByRole('button', { name: '查看更新' })).toBeTruthy();
  });

  it('starts update from the global entry', async () => {
    const { SystemUpdateEntry } = await import('./SystemUpdateEntry');
    const client = {
      getSystemUpdateInfo: vi.fn(async () => ({
        updateAvailable: true,
        packageId: 'W/"etag"',
        packageUrl: 'https://example.com/webmcp.zip',
        projectUrl: 'https://example.com/project',
        distribution: 'mac-lite',
      })),
      startSystemUpdate: vi.fn(async () => ({ success: true, message: '服务会重启' })),
    };

    const view = render(<SystemUpdateEntry client={client} />);

    fireEvent.click(await view.findByRole('button', { name: '查看更新' }));
    fireEvent.click(await view.findByRole('button', { name: '立即更新' }));

    await waitFor(() => expect(client.startSystemUpdate).toHaveBeenCalledTimes(1));
    expect(await view.findByText('服务会重启')).toBeTruthy();
  });
});
