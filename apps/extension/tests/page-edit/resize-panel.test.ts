// @vitest-environment node

import { JSDOM } from 'jsdom';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

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
    Element: globalThis.Element,
    SVGElement: globalThis.SVGElement,
    NodeList: globalThis.NodeList,
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
    Element: dom.window.Element,
    SVGElement: dom.window.SVGElement,
    NodeList: dom.window.NodeList,
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

beforeEach(() => {
  document.documentElement.setAttribute(
    'data-webmcp-page-edit-config',
    JSON.stringify({ pageMode: 'local-snapshot' }),
  );
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

describe('resize panel state', () => {
  it('reads current width and height values from the selected element', async () => {
    const { default: VisBug } = await import(
      '../../public/page-edit/vendor/app/components/vis-bug/vis-bug.element.js'
    );

    document.body.innerHTML = `
      <div id="target" style="width: 50%; height: auto;">Resize target</div>
    `;

    const visbug = new VisBug();
    visbug.selectorEngine = {
      selection() {
        return [document.getElementById('target')];
      },
    };

    expect(visbug.getSizePanelState()).toEqual({
      values: {
        width: '50%',
        height: 'auto',
      },
    });
  });

  it('renders width and height inputs from the current size state', async () => {
    const { default: VisBug } = await import(
      '../../public/page-edit/vendor/app/components/vis-bug/vis-bug.element.js'
    );

    document.body.innerHTML = `
      <div id="target" style="width: 320px; height: 12rem;">Resize target</div>
    `;

    const visbug = new VisBug();
    visbug.selectorEngine = {
      selection() {
        return [document.getElementById('target')];
      },
    };

    const markup = visbug.renderSizePanel();
    const panelDocument = new JSDOM(markup).window.document;
    const widthInput = panelDocument.querySelector('[data-size-input="width"]');
    const heightInput = panelDocument.querySelector('[data-size-input="height"]');

    expect(widthInput?.getAttribute('value')).toBe('320px');
    expect(heightInput?.getAttribute('value')).toBe('12rem');
  });

  it('commits direct size edits while preserving the entered unit', async () => {
    const { default: VisBug } = await import(
      '../../public/page-edit/vendor/app/components/vis-bug/vis-bug.element.js'
    );

    document.body.innerHTML = `
      <div id="target" style="width: 320px; height: 180px;">Resize target</div>
    `;

    const target = document.getElementById('target') as HTMLElement | null;
    const mutationLabels: string[] = [];
    const visbug = new VisBug();
    visbug.selectorEngine = {
      selection() {
        return target ? [target] : [];
      },
      recordStyleMutation({ label, mutate }) {
        mutationLabels.push(label);
        mutate();
      },
    };

    visbug.handleSizeInputCommit('width', '50%');
    visbug.handleSizeInputCommit('height', 'auto');

    expect(target?.style.width).toBe('50%');
    expect(target?.style.height).toBe('auto');
    expect(mutationLabels).toEqual(['size:width', 'size:height']);
  });

  it('keeps the previous valid size when the input is empty', async () => {
    const { default: VisBug } = await import(
      '../../public/page-edit/vendor/app/components/vis-bug/vis-bug.element.js'
    );

    const visbug = new VisBug();

    expect(visbug.normalizeSizeInputValue('width', '', '320px')).toBe('320px');
    expect(visbug.normalizeSizeInputValue('height', '   ', '180px')).toBe('180px');
  });

  it('commits size input changes on Enter and blur', async () => {
    const { default: VisBug } = await import(
      '../../public/page-edit/vendor/app/components/vis-bug/vis-bug.element.js'
    );

    document.body.innerHTML = `
      <div id="target" style="width: 320px; height: 180px;">Resize target</div>
    `;

    const target = document.getElementById('target');
    const visbug = new VisBug();
    visbug.selectorEngine = {
      selection() {
        return target ? [target] : [];
      },
      recordStyleMutation({ mutate }) {
        mutate();
      },
      refreshSelectionUi() {},
    };

    visbug.$shadow.innerHTML = visbug.render();
    visbug.bindBottomToolbarEvents();

    const widthInput = visbug.$shadow.querySelector(
      '[data-size-input="width"]',
    ) as HTMLInputElement | null;
    const heightInput = visbug.$shadow.querySelector(
      '[data-size-input="height"]',
    ) as HTMLInputElement | null;

    expect(widthInput).not.toBeNull();
    expect(heightInput).not.toBeNull();

    if (!widthInput || !heightInput) throw new Error('size inputs missing');

    widthInput.value = '50%';
    widthInput.dispatchEvent(
      new dom.window.KeyboardEvent('keydown', {
        key: 'Enter',
        bubbles: true,
      }),
    );

    heightInput.value = 'auto';
    heightInput.dispatchEvent(new dom.window.FocusEvent('blur', { bubbles: true }));

    expect((target as HTMLElement | null)?.style.width).toBe('50%');
    expect((target as HTMLElement | null)?.style.height).toBe('auto');
  });
});
