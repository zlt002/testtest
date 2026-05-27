// @vitest-environment node

import { JSDOM } from 'jsdom';
import { render } from '@testing-library/react';
import { beforeAll, describe, expect, it, vi } from 'vitest';

vi.mock('@tanstack/react-router', () => ({
  createRootRouteWithContext: () => () => (config: unknown) => config,
  Link: ({ children, to }: { children: React.ReactNode; to: string }) => <a href={to}>{children}</a>,
  Outlet: () => <div data-testid="mock-outlet">mock outlet</div>,
}));

vi.mock('sonner', () => ({
  Toaster: () => <div data-testid="mock-toaster" />,
}));

import { RootComponent } from './__root';

beforeAll(() => {
  const dom = new JSDOM('<!doctype html><html><body></body></html>', {
    url: 'https://example.test/sidepanel.html?route=%2Fchat',
  });
  Object.assign(globalThis, {
    window: dom.window,
    document: dom.window.document,
    HTMLElement: dom.window.HTMLElement,
    Node: dom.window.Node,
    TextEncoder: globalThis.TextEncoder,
    TextDecoder: globalThis.TextDecoder,
  });
  Object.defineProperty(globalThis, 'navigator', {
    value: dom.window.navigator,
    configurable: true,
  });
});

describe('RootComponent', () => {
  it('给路由内容容器添加 min-h-0，避免子页面滚动时把外层 flex 布局撑出第二根滚动条', () => {
    const { container } = render(<RootComponent />);

    expect(container.querySelector('[data-testid="mock-outlet"]')).toBeTruthy();
    const main = container.querySelector('main');
    expect(main?.className).toContain('min-h-0');
  });
});
