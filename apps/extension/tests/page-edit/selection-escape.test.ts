// @vitest-environment node

import { JSDOM } from 'jsdom';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

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

function dispatchKeyboard(
  type: 'keydown' | 'keyup',
  init: KeyboardEventInit & { keyCode: number },
) {
  const event = new window.KeyboardEvent(type, {
    bubbles: true,
    cancelable: true,
    ...init,
  });

  Object.defineProperty(event, 'keyCode', {
    configurable: true,
    get: () => init.keyCode,
  });
  Object.defineProperty(event, 'which', {
    configurable: true,
    get: () => init.keyCode,
  });

  document.dispatchEvent(event);
}

describe('selection escape behavior', () => {
  it('clears the current selection when escape is pressed', async () => {
    const { Selectable } = await import('../../public/page-edit/vendor/app/features/selectable.js');

    const selectable = Selectable({
      activeTool: 'inspector',
      colorMode: 'rgb',
      toolSelected() {},
      shouldShowSelectionActionsEverywhere() {
        return false;
      },
    });

    document.body.innerHTML = '<div id="target">Hello</div>';
    const target = document.getElementById('target') as HTMLElement | null;
    expect(target).not.toBeNull();

    try {
      selectable.select(target!);
      expect(selectable.selection()).toHaveLength(1);

      dispatchKeyboard('keydown', {
        key: 'Escape',
        code: 'Escape',
        keyCode: 27,
      });

      expect(selectable.selection()).toHaveLength(0);
    } finally {
      selectable.disconnect();
    }
  });
});
