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

describe('typography panel state', () => {
  it('returns empty defaults when nothing is selected', async () => {
    const { default: VisBug } = await import(
      '../../public/page-edit/vendor/app/components/vis-bug/vis-bug.element.js'
    );

    const visbug = new VisBug();
    visbug.selectorEngine = {
      selection() {
        return [];
      },
    };

    expect(visbug.getTypographyPanelState()).toEqual({
      values: {
        fontSize: '',
        fontWeight: '',
        lineHeight: '',
        letterSpacing: '',
        textAlign: '',
        bold: false,
        italic: false,
        underline: false,
        foreground: '',
      },
      advancedOpen: false,
    });
  });

  it('reads current typography values from the selected element', async () => {
    const { default: VisBug } = await import(
      '../../public/page-edit/vendor/app/components/vis-bug/vis-bug.element.js'
    );

    document.body.innerHTML = `
      <p
        id="copy"
        style="
          font-size: 18px;
          font-weight: 700;
          line-height: 24px;
          letter-spacing: normal;
          text-align: center;
          font-style: italic;
          text-decoration: underline;
          color: rgb(10, 20, 30);
        "
      >Typography target</p>
    `;

    const visbug = new VisBug();
    visbug.selectorEngine = {
      selection() {
        return [document.getElementById('copy')];
      },
    };

    expect(visbug.getTypographyPanelState()).toEqual({
      values: {
        fontSize: '18',
        fontWeight: '700',
        lineHeight: '24',
        letterSpacing: '0',
        textAlign: 'center',
        bold: true,
        italic: true,
        underline: true,
        foreground: 'rgb(10, 20, 30)',
      },
      advancedOpen: false,
    });
  });

  it('renders the typography inputs from the current panel state instead of static defaults', async () => {
    const { default: VisBug } = await import(
      '../../public/page-edit/vendor/app/components/vis-bug/vis-bug.element.js'
    );

    document.body.innerHTML = `
      <p
        id="copy"
        style="
          font-size: 22px;
          font-weight: 500;
          line-height: 28px;
          letter-spacing: 1.5px;
          color: rgb(1, 2, 3);
        "
      >Typography target</p>
    `;

    const visbug = new VisBug();
    visbug.selectorEngine = {
      selection() {
        return [document.getElementById('copy')];
      },
    };

    const markup = visbug.renderTypographyPanel();

    expect(markup).toContain('data-typography-input="font-size"');
    expect(markup).toContain('value="22"');
    expect(markup).toContain('data-typography-input="font-weight"');
    expect(markup).toContain('value="500"');
    expect(markup).toContain('data-typography-input="line-height"');
    expect(markup).toContain('value="28"');
    expect(markup).toContain('data-typography-input="letter-spacing"');
    expect(markup).toContain('value="1.5"');
    expect(markup).not.toContain('value="16px"');
    expect(markup).not.toContain('value="400"');
    expect(markup).not.toContain('value="1.5" aria-label="字距"');
    expect(markup).not.toContain('value="0em"');
  });
});
