// @vitest-environment node

import { JSDOM } from 'jsdom';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

let dom: JSDOM;
let previousGlobals: Record<string, unknown>;

beforeAll(() => {
  dom = new JSDOM('<!doctype html><html><body></body></html>', {
    url: 'https://example.com/',
  });

  previousGlobals = {
    window: globalThis.window,
    document: globalThis.document,
    customElements: globalThis.customElements,
    HTMLElement: globalThis.HTMLElement,
    SVGElement: globalThis.SVGElement,
    NodeList: globalThis.NodeList,
    Element: globalThis.Element,
    MutationObserver: globalThis.MutationObserver,
    DOMException: globalThis.DOMException,
    CSSStyleSheet: globalThis.CSSStyleSheet,
    Document: globalThis.Document,
    DOMParser: globalThis.DOMParser,
    getComputedStyle: globalThis.getComputedStyle,
    navigator: globalThis.navigator,
  };

  Object.assign(globalThis, {
    window: dom.window,
    document: dom.window.document,
    customElements: dom.window.customElements,
    HTMLElement: dom.window.HTMLElement,
    SVGElement: dom.window.SVGElement,
    NodeList: dom.window.NodeList,
    Element: dom.window.Element,
    MutationObserver: dom.window.MutationObserver,
    DOMException: dom.window.DOMException,
    CSSStyleSheet: dom.window.CSSStyleSheet,
    Document: dom.window.Document,
    DOMParser: dom.window.DOMParser,
    getComputedStyle: dom.window.getComputedStyle.bind(dom.window),
  });
  Object.defineProperty(globalThis, 'navigator', {
    configurable: true,
    value: dom.window.navigator,
  });
});

afterEach(() => {
  document.body.innerHTML = '';
  document.documentElement.removeAttribute('data-webmcp-page-edit-config');
});

afterAll(() => {
  dom.window.close();
  const { navigator: previousNavigator, ...restGlobals } = previousGlobals;
  Object.assign(globalThis, restGlobals);
  Object.defineProperty(globalThis, 'navigator', {
    configurable: true,
    value: previousNavigator,
  });
});

function dispatchMouse(
  target: EventTarget,
  type: 'mousedown' | 'mousemove' | 'mouseup',
  init: MouseEventInit = {},
) {
  const event = new window.MouseEvent(type, {
    bubbles: true,
    cancelable: true,
    ...init,
  });

  target.dispatchEvent(event);
  return event;
}

async function withSelectableFixture(
  run: (fixture: {
    visbug: {
      activeTool: string | null;
      colorMode: string;
      toolSelected: () => void;
    };
    selectable: ReturnType<(typeof import('../../public/page-edit/vendor/app/features/selectable.js'))['Selectable']>;
  }) => Promise<void> | void,
) {
  const originalPlatform = window.navigator.platform;

  vi.resetModules();
  Object.defineProperty(window.navigator, 'platform', {
    configurable: true,
    value: 'Win32',
  });

  const { Selectable } = await import('../../public/page-edit/vendor/app/features/selectable.js');
  const visbug = {
    activeTool: 'position',
    colorMode: 'rgb',
    toolSelected() {},
  };
  const selectable = Selectable(visbug);

  try {
    await run({ selectable, visbug });
  } finally {
    selectable.disconnect();
    Object.defineProperty(window.navigator, 'platform', {
      configurable: true,
      value: originalPlatform,
    });
  }
}

describe('page-edit resize handles', () => {
  it('resizes width from the east handle and width/height from the southeast handle', async () => {
    document.documentElement.setAttribute(
      'data-webmcp-page-edit-config',
      JSON.stringify({ pageMode: 'local-snapshot' }),
    );

    await withSelectableFixture(async ({ selectable }) => {
      const { Position } = await import('../../public/page-edit/vendor/app/features/position.js');

      document.body.innerHTML = `
        <main id="root">
          <div id="target" style="width: 100px; height: 80px;"></div>
        </main>
      `;

      const target = document.getElementById('target') as HTMLElement | null;
      expect(target).not.toBeNull();

      const feature = Position();
      selectable.onSelectedUpdate(feature.onNodesSelected);

      try {
        selectable.select(target!);

        const handlesHost = document.querySelector('visbug-handles') as
          | (HTMLElement & { $shadow?: ShadowRoot })
          | null;
        expect(handlesHost).not.toBeNull();

        const eastHandle = handlesHost!.$shadow?.querySelector(
          '[data-resize-handle="east"]',
        ) as SVGElement | null;
        const southEastHandle = handlesHost!.$shadow?.querySelector(
          '[data-resize-handle="southeast"]',
        ) as SVGElement | null;

        expect(eastHandle).not.toBeNull();
        expect(southEastHandle).not.toBeNull();

        dispatchMouse(eastHandle!, 'mousedown', { button: 0, clientX: 100, clientY: 40 });
        dispatchMouse(document, 'mousemove', { button: 0, clientX: 130, clientY: 40 });
        dispatchMouse(document, 'mouseup', { button: 0, clientX: 130, clientY: 40 });

        expect(target!.style.width).toBe('130px');
        expect(target!.style.height).toBe('80px');

        dispatchMouse(southEastHandle!, 'mousedown', { button: 0, clientX: 130, clientY: 80 });
        dispatchMouse(document, 'mousemove', { button: 0, clientX: 150, clientY: 95 });
        dispatchMouse(document, 'mouseup', { button: 0, clientX: 150, clientY: 95 });

        expect(target!.style.width).toBe('150px');
        expect(target!.style.height).toBe('95px');
      } finally {
        selectable.removeSelectedCallback(feature.onNodesSelected);
        feature.disconnect();
      }
    });
  });

  it('prevents native text selection while resizing from a handle', async () => {
    document.documentElement.setAttribute(
      'data-webmcp-page-edit-config',
      JSON.stringify({ pageMode: 'local-snapshot' }),
    );

    await withSelectableFixture(async ({ selectable }) => {
      const { Position } = await import('../../public/page-edit/vendor/app/features/position.js');

      document.body.innerHTML = `
        <main id="root">
          <div id="target" style="width: 100px; height: 80px;">Resizable text content</div>
        </main>
      `;

      const target = document.getElementById('target') as HTMLElement | null;
      expect(target).not.toBeNull();

      const feature = Position();
      selectable.onSelectedUpdate(feature.onNodesSelected);

      try {
        selectable.select(target!);

        const handlesHost = document.querySelector('visbug-handles') as
          | (HTMLElement & { $shadow?: ShadowRoot })
          | null;
        const eastHandle = handlesHost!.$shadow?.querySelector(
          '[data-resize-handle="east"]',
        ) as SVGElement | null;
        expect(eastHandle).not.toBeNull();

        const selectStartEvent = new window.Event('selectstart', {
          bubbles: true,
          cancelable: true,
        });

        dispatchMouse(eastHandle!, 'mousedown', { button: 0, clientX: 100, clientY: 40 });
        target!.dispatchEvent(selectStartEvent);

        expect(selectStartEvent.defaultPrevented).toBe(true);

        dispatchMouse(document, 'mouseup', { button: 0, clientX: 100, clientY: 40 });
      } finally {
        selectable.removeSelectedCallback(feature.onNodesSelected);
        feature.disconnect();
      }
    });
  });

  it('clears any active browser selection while resizing', async () => {
    document.documentElement.setAttribute(
      'data-webmcp-page-edit-config',
      JSON.stringify({ pageMode: 'local-snapshot' }),
    );

    await withSelectableFixture(async ({ selectable }) => {
      const { Position } = await import('../../public/page-edit/vendor/app/features/position.js');

      document.body.innerHTML = `
        <main id="root">
          <div id="target" style="width: 100px; height: 80px;">Resizable text content</div>
        </main>
      `;

      const target = document.getElementById('target') as HTMLElement | null;
      expect(target).not.toBeNull();

      const removeAllRanges = vi.fn();
      const selection = { removeAllRanges } as unknown as Selection;
      const getSelectionSpy = vi.spyOn(window, 'getSelection').mockReturnValue(selection);

      const feature = Position();
      selectable.onSelectedUpdate(feature.onNodesSelected);

      try {
        selectable.select(target!);

        const handlesHost = document.querySelector('visbug-handles') as
          | (HTMLElement & { $shadow?: ShadowRoot })
          | null;
        const eastHandle = handlesHost!.$shadow?.querySelector(
          '[data-resize-handle="east"]',
        ) as SVGElement | null;
        expect(eastHandle).not.toBeNull();

        dispatchMouse(eastHandle!, 'mousedown', { button: 0, clientX: 100, clientY: 40 });
        dispatchMouse(document, 'mousemove', { button: 0, clientX: 130, clientY: 40 });

        expect(removeAllRanges).toHaveBeenCalled();

        dispatchMouse(document, 'mouseup', { button: 0, clientX: 130, clientY: 40 });
      } finally {
        getSelectionSpy.mockRestore();
        selectable.removeSelectedCallback(feature.onNodesSelected);
        feature.disconnect();
      }
    });
  });
});
