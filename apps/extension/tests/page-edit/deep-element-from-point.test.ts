// @vitest-environment node

import { JSDOM } from 'jsdom';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';

let outerDom: JSDOM;
let previousGlobals: Record<string, unknown>;
let deepElementFromPoint: typeof import('../../public/page-edit/vendor/app/utilities/common.js').deepElementFromPoint;

function assignDomGlobals(dom: JSDOM) {
  Object.assign(globalThis, {
    window: dom.window,
    document: dom.window.document,
    customElements: dom.window.customElements,
    HTMLElement: dom.window.HTMLElement,
    Element: dom.window.Element,
    SVGElement: dom.window.SVGElement,
    Node: dom.window.Node,
    NodeList: dom.window.NodeList,
    MutationObserver: dom.window.MutationObserver,
    DOMException: dom.window.DOMException,
    CustomEvent: dom.window.CustomEvent,
    CSSStyleSheet: dom.window.CSSStyleSheet,
    Document: dom.window.Document,
    DOMParser: dom.window.DOMParser,
    CSS: dom.window.CSS ?? { escape: (value: string) => value },
    getComputedStyle: dom.window.getComputedStyle.bind(dom.window),
  });
  Object.defineProperty(globalThis, 'navigator', {
    configurable: true,
    value: dom.window.navigator,
  });
}

function stubRect(
  element: Element,
  rect: Partial<DOMRect> & { left: number; top: number; width: number; height: number },
) {
  const fullRect = {
    x: rect.left,
    y: rect.top,
    left: rect.left,
    top: rect.top,
    width: rect.width,
    height: rect.height,
    right: rect.left + rect.width,
    bottom: rect.top + rect.height,
    toJSON() {
      return this;
    },
  } satisfies DOMRect;

  Object.defineProperty(element, 'getBoundingClientRect', {
    configurable: true,
    value: () => fullRect,
  });
}

beforeAll(() => {
  outerDom = new JSDOM(
    '<!doctype html><html><body><div id="shell"><iframe id="micro-frame"></iframe></div></body></html>',
    { url: 'https://el-uat.annto.com/v3/' },
  );

  previousGlobals = {
    window: globalThis.window,
    document: globalThis.document,
    customElements: globalThis.customElements,
    HTMLElement: globalThis.HTMLElement,
    Element: globalThis.Element,
    SVGElement: globalThis.SVGElement,
    Node: globalThis.Node,
    NodeList: globalThis.NodeList,
    MutationObserver: globalThis.MutationObserver,
    DOMException: globalThis.DOMException,
    CustomEvent: globalThis.CustomEvent,
    CSSStyleSheet: globalThis.CSSStyleSheet,
    Document: globalThis.Document,
    DOMParser: globalThis.DOMParser,
    CSS: globalThis.CSS,
    getComputedStyle: globalThis.getComputedStyle,
    navigator: globalThis.navigator,
  };

  assignDomGlobals(outerDom);
});

beforeEach(() => {
  document.body.innerHTML = '<div id="shell"><iframe id="micro-frame"></iframe></div>';
});

afterEach(() => {
  document.body.innerHTML = '';
});

afterAll(() => {
  outerDom.window.close();
  const { navigator: previousNavigator, ...restGlobals } = previousGlobals;
  Object.assign(globalThis, restGlobals);
  Object.defineProperty(globalThis, 'navigator', {
    configurable: true,
    value: previousNavigator,
  });
});

describe('deepElementFromPoint', () => {
  beforeAll(async () => {
    ({ deepElementFromPoint } = await import('../../public/page-edit/vendor/app/utilities/common.js'));
  });

  it('returns the real same-origin iframe business element instead of the outer iframe shell', () => {
    const iframe = document.getElementById('micro-frame') as HTMLIFrameElement;
    const shell = document.getElementById('shell') as HTMLDivElement;
    stubRect(shell, { left: 0, top: 0, width: 1200, height: 800 });
    stubRect(iframe, { left: 100, top: 200, width: 900, height: 500 });

    const innerDocument = iframe.contentDocument!;
    innerDocument.body.innerHTML = `
      <main id="page-root">
        <section id="panel">
          <div id="field-wrapper">
            <span id="target">客户订单号</span>
          </div>
        </section>
      </main>
    `;

    const pageRoot = innerDocument.getElementById('page-root')!;
    const panel = innerDocument.getElementById('panel')!;
    const fieldWrapper = innerDocument.getElementById('field-wrapper')!;
    const target = innerDocument.getElementById('target')!;

    stubRect(pageRoot, { left: 0, top: 0, width: 900, height: 500 });
    stubRect(panel, { left: 24, top: 32, width: 320, height: 160 });
    stubRect(fieldWrapper, { left: 32, top: 40, width: 220, height: 40 });
    stubRect(target, { left: 36, top: 44, width: 120, height: 24 });

    document.elementFromPoint = () => iframe;
    document.elementsFromPoint = () => [iframe, shell];
    innerDocument.elementFromPoint = () => pageRoot;
    innerDocument.elementsFromPoint = () => [pageRoot, panel, fieldWrapper, target];

    expect(deepElementFromPoint(140, 250)).toBe(target);
  });

  it('supports same-origin iframe elements from a foreign realm document', () => {
    const iframe = document.getElementById('micro-frame') as HTMLIFrameElement;
    const foreignDom = new JSDOM('<!doctype html><html><body><div id="target">状态</div></body></html>', {
      url: 'https://an-uat.annto.com/v3/otp.html',
    });
    const foreignDocument = foreignDom.window.document;
    const target = foreignDocument.getElementById('target')!;

    stubRect(iframe, { left: 80, top: 120, width: 600, height: 400 });
    stubRect(target, { left: 12, top: 16, width: 60, height: 24 });

    Object.defineProperty(iframe, 'contentDocument', {
      configurable: true,
      get: () => foreignDocument,
    });
    Object.defineProperty(iframe, 'contentWindow', {
      configurable: true,
      get: () => foreignDom.window,
    });

    document.elementFromPoint = () => iframe;
    document.elementsFromPoint = () => [iframe];
    foreignDocument.elementFromPoint = () => target;
    foreignDocument.elementsFromPoint = () => [target];

    expect(deepElementFromPoint(96, 142)).toBe(target);

    foreignDom.window.close();
  });

  it('falls back to the iframe shell when the iframe document is not accessible', () => {
    const iframe = document.getElementById('micro-frame') as HTMLIFrameElement;

    Object.defineProperty(iframe, 'contentDocument', {
      configurable: true,
      get: () => {
        throw new DOMException(
          "Blocked a frame with origin from accessing a cross-origin frame.",
          'SecurityError',
        );
      },
    });

    document.elementFromPoint = () => iframe;
    document.elementsFromPoint = () => [iframe];

    expect(deepElementFromPoint(120, 160)).toBe(iframe);
  });
});
