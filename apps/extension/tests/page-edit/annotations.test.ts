// @vitest-environment node

import { JSDOM } from 'jsdom';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

let dom: JSDOM;
let previousGlobals: Record<string, unknown>;
let annotationRuntime: typeof import('../../public/page-edit/runtime/annotations.js');
let previousAttachShadow: typeof HTMLElement.prototype.attachShadow;

beforeAll(() => {
  dom = new JSDOM('<!doctype html><html><body></body></html>', {
    url: 'https://example.com/orders',
  });

  previousGlobals = {
    window: globalThis.window,
    document: globalThis.document,
    customElements: globalThis.customElements,
    HTMLElement: globalThis.HTMLElement,
    Element: globalThis.Element,
    Node: globalThis.Node,
    NodeList: globalThis.NodeList,
    MutationObserver: globalThis.MutationObserver,
    DOMException: globalThis.DOMException,
    CustomEvent: globalThis.CustomEvent,
    CSSStyleSheet: globalThis.CSSStyleSheet,
    Document: globalThis.Document,
    getComputedStyle: globalThis.getComputedStyle,
    XPathResult: globalThis.XPathResult,
    requestAnimationFrame: globalThis.requestAnimationFrame,
    cancelAnimationFrame: globalThis.cancelAnimationFrame,
    navigator: globalThis.navigator,
  };

  Object.assign(globalThis, {
    window: dom.window,
    document: dom.window.document,
    customElements: dom.window.customElements,
    HTMLElement: dom.window.HTMLElement,
    Element: dom.window.Element,
    Node: dom.window.Node,
    NodeList: dom.window.NodeList,
    MutationObserver: dom.window.MutationObserver,
    DOMException: dom.window.DOMException,
    CustomEvent: dom.window.CustomEvent,
    CSSStyleSheet: dom.window.CSSStyleSheet,
    Document: dom.window.Document,
    XPathResult: dom.window.XPathResult,
    getComputedStyle: dom.window.getComputedStyle.bind(dom.window),
    requestAnimationFrame: (callback: FrameRequestCallback) => {
      callback(0);
      return 1;
    },
    cancelAnimationFrame: () => {},
  });

  Object.defineProperty(globalThis, 'navigator', {
    configurable: true,
    value: dom.window.navigator,
  });

  previousAttachShadow = dom.window.HTMLElement.prototype.attachShadow;
  dom.window.HTMLElement.prototype.attachShadow = function attachShadowForTest(init) {
    return previousAttachShadow.call(this, { ...init, mode: 'open' });
  };
});

beforeEach(() => {
  document.body.innerHTML = '';
});

afterEach(() => {
  annotationRuntime?.setAnnotationDialogOpenHandlerForTest(null);
  annotationRuntime?.clearSelectionAnnotationUi();
});

afterAll(() => {
  dom.window.HTMLElement.prototype.attachShadow = previousAttachShadow;
  dom.window.close();
  const { navigator: previousNavigator, ...restGlobals } = previousGlobals;
  Object.assign(globalThis, restGlobals);
  Object.defineProperty(globalThis, 'navigator', {
    configurable: true,
    value: previousNavigator,
  });
});

function setElementRect(
  element: Element,
  rect: { x: number; y: number; width: number; height: number },
) {
  Object.defineProperty(element, 'getBoundingClientRect', {
    configurable: true,
    value: () => ({
      ...rect,
      top: rect.y,
      left: rect.x,
      right: rect.x + rect.width,
      bottom: rect.y + rect.height,
      toJSON() {
        return this;
      },
    }),
  });
}

describe('annotations runtime', () => {
  it('rebinds to the best matching replacement element when selector hits duplicates', async () => {
    annotationRuntime ??= await import('../../public/page-edit/runtime/annotations.js');

    document.body.innerHTML = `
      <section class="list">
        <div class="item">Alpha</div>
      </section>
    `;

    const original = document.querySelector('.item');
    expect(original).toBeInstanceOf(HTMLElement);
    setElementRect(original as Element, { x: 20, y: 30, width: 160, height: 48 });

    const target = {
      ...(await import('../../public/page-edit/vendor/app/features/selection-actions.js'))
        .buildPickedElementCaptureContext(original as HTMLElement),
    };

    const list = document.querySelector('.list');
    expect(list).toBeInstanceOf(HTMLElement);

    (original as HTMLElement).remove();

    const hiddenReplacement = document.createElement('div');
    hiddenReplacement.className = 'item';
    hiddenReplacement.textContent = 'Alpha';
    hiddenReplacement.style.display = 'none';
    setElementRect(hiddenReplacement, { x: 0, y: 0, width: 0, height: 0 });

    const visibleReplacement = document.createElement('div');
    visibleReplacement.className = 'item';
    visibleReplacement.textContent = 'Alpha';
    setElementRect(visibleReplacement, { x: 24, y: 34, width: 158, height: 48 });

    list?.append(hiddenReplacement, visibleReplacement);

    expect(annotationRuntime.resolveAnnotationElementForTest(target)).toBe(visibleReplacement);
  });

  it('opens existing annotation content and saves updates', async () => {
    annotationRuntime ??= await import('../../public/page-edit/runtime/annotations.js');

    document.body.innerHTML = `
      <section class="list">
        <div class="item">Alpha</div>
      </section>
    `;

    const element = document.querySelector('.item');
    expect(element).toBeInstanceOf(HTMLElement);
    setElementRect(element as Element, { x: 20, y: 30, width: 160, height: 48 });

    const openSpy = vi.fn().mockResolvedValue('已更新备注');
    annotationRuntime.setAnnotationDialogOpenHandlerForTest(openSpy);

    const record = annotationRuntime.upsertSelectionAnnotation(element as HTMLElement, '原备注');
    const updatedRecord = await annotationRuntime.editAnnotationRecordForTest(record);

    expect(openSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        content: '原备注',
      }),
    );
    expect(updatedRecord).toEqual(
      expect.objectContaining({
        content: '已更新备注',
      }),
    );
  });

  it('prevents textarea backspace from bubbling to page-level shortcuts', async () => {
    annotationRuntime ??= await import('../../public/page-edit/runtime/annotations.js');

    document.body.innerHTML = `
      <section class="list">
        <div class="item">Alpha</div>
      </section>
    `;

    const element = document.querySelector('.item');
    expect(element).toBeInstanceOf(HTMLElement);

    const keydownSpy = vi.fn();
    document.addEventListener('keydown', keydownSpy);

    try {
      const openPromise = annotationRuntime.requestSelectionAnnotationContent(element as HTMLElement, {});
      await Promise.resolve();

      const dialog = document.querySelector('webmcp-page-annotation-dialog') as HTMLElement | null;
      expect(dialog?.shadowRoot).toBeTruthy();

      const contentField = dialog?.shadowRoot?.querySelector(
        'textarea[data-field="content"]',
      ) as HTMLTextAreaElement | null;
      expect(contentField).toBeInstanceOf(window.HTMLTextAreaElement);

      contentField?.dispatchEvent(
        new window.KeyboardEvent('keydown', {
          key: 'Backspace',
          code: 'Backspace',
          bubbles: true,
          cancelable: true,
          composed: true,
        }),
      );

      expect(keydownSpy).not.toHaveBeenCalled();

      dialog?.shadowRoot?.querySelector('button[data-action="cancel"]')?.dispatchEvent(
        new window.MouseEvent('click', {
          bubbles: true,
          cancelable: true,
          composed: true,
        }),
      );

      await expect(openPromise).resolves.toBeNull();
    } finally {
      document.removeEventListener('keydown', keydownSpy);
    }
  });
});
