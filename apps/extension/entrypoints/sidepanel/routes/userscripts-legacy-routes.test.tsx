// @vitest-environment node

import { cleanup, render, waitFor } from '@testing-library/react';
import { JSDOM } from 'jsdom';
import * as React from 'react';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const routerState = vi.hoisted(() => ({
  navigate: vi.fn(),
  params: {} as Record<string, string>,
}));

vi.mock('@tanstack/react-router', () => ({
  createFileRoute: () => () => ({
    useParams: () => routerState.params,
  }),
  useNavigate: () => routerState.navigate,
}));

afterEach(() => {
  cleanup();
});

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

beforeEach(() => {
  routerState.navigate.mockReset();
  routerState.params = {};
});

describe('legacy userscript routes', () => {
  it('redirects /userscripts/new to workspace create mode', async () => {
    const { LegacyNewUserScriptRedirect } = await import('./userscripts.new');

    render(<LegacyNewUserScriptRedirect />);

    await waitFor(() => {
      expect(routerState.navigate).toHaveBeenCalledWith({
        to: '/userscripts',
        search: { mode: 'create' },
        replace: true,
      });
    });
  });

  it('redirects /userscripts/:scriptId/edit to workspace edit mode', async () => {
    routerState.params = { scriptId: 'helper-script' };
    const { LegacyEditUserScriptRedirect } = await import('./userscripts.$scriptId.edit');

    render(<LegacyEditUserScriptRedirect />);

    await waitFor(() => {
      expect(routerState.navigate).toHaveBeenCalledWith({
        to: '/userscripts',
        search: { scriptId: 'helper-script', mode: 'edit' },
        replace: true,
      });
    });
  });

  it('redirects /userscripts/:scriptId to workspace view mode', async () => {
    routerState.params = { scriptId: 'demo-script' };
    const { LegacyUserScriptDetailRedirect } = await import('./userscripts.$scriptId');

    render(<LegacyUserScriptDetailRedirect />);

    await waitFor(() => {
      expect(routerState.navigate).toHaveBeenCalledWith({
        to: '/userscripts',
        search: { scriptId: 'demo-script', mode: 'view' },
        replace: true,
      });
    });
  });
});
