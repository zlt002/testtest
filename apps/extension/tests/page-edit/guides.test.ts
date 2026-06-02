// @vitest-environment node

import { JSDOM } from 'jsdom';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

let dom: JSDOM;
let previousGlobals: Record<string, unknown>;

beforeAll(() => {
  dom = new JSDOM(`<!doctype html><html><body><div id="target">目标</div></body></html>`, {
    url: 'https://example.com/',
  });

  previousGlobals = {
    window: globalThis.window,
    document: globalThis.document,
    customElements: globalThis.customElements,
    HTMLElement: globalThis.HTMLElement,
    Element: globalThis.Element,
    SVGElement: globalThis.SVGElement,
    NodeList: globalThis.NodeList,
    MutationObserver: globalThis.MutationObserver,
    DOMException: globalThis.DOMException,
    CustomEvent: globalThis.CustomEvent,
    CSSStyleSheet: globalThis.CSSStyleSheet,
    Document: globalThis.Document,
    CSS: globalThis.CSS,
  };

  Object.assign(globalThis, {
    window: dom.window,
    document: dom.window.document,
    customElements: dom.window.customElements,
    HTMLElement: dom.window.HTMLElement,
    Element: dom.window.Element,
    SVGElement: dom.window.SVGElement,
    NodeList: dom.window.NodeList,
    MutationObserver: dom.window.MutationObserver,
    DOMException: dom.window.DOMException,
    CustomEvent: dom.window.CustomEvent,
    CSSStyleSheet: dom.window.CSSStyleSheet,
    Document: dom.window.Document,
    CSS: dom.window.CSS ?? { escape: (value: string) => value },
  });
});

beforeEach(() => {
  document.body.innerHTML = '<div id="target">目标</div>';
  document.documentElement.removeAttribute('data-webmcp-page-edit-analysis-mode');
  Object.defineProperty(document, 'elementFromPoint', {
    configurable: true,
    value: vi.fn(() => document.getElementById('target')),
  });
  Object.defineProperty(window, 'innerWidth', {
    configurable: true,
    value: 1280,
  });
  Object.defineProperty(window, 'innerHeight', {
    configurable: true,
    value: 720,
  });
});

afterAll(() => {
  dom.window.close();
  Object.assign(globalThis, previousGlobals);
});

describe('guides', () => {
  it('does not render gridlines while selection analysis guidance is active', async () => {
    await import('../../public/page-edit/vendor/app/components/selection/gridlines.element.js');
    const { Guides } = await import('../../public/page-edit/vendor/app/features/guides.js');

    document.documentElement.setAttribute('data-webmcp-page-edit-analysis-mode', 'interactive');

    const cleanup = Guides({
      onSelectedUpdate() {},
      removeSelectedCallback() {},
    });

    document.body.dispatchEvent(
      new window.MouseEvent('mousemove', {
        bubbles: true,
        clientX: 20,
        clientY: 20,
      }),
    );

    expect(document.querySelectorAll('visbug-gridlines')).toHaveLength(0);
    cleanup?.();
  });
});
