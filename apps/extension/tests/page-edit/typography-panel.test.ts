// @vitest-environment node

import { JSDOM } from 'jsdom';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

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
        fontSize: '18px',
        fontWeight: '700',
        lineHeight: '24px',
        letterSpacing: 'normal',
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
    const panelDocument = new JSDOM(markup).window.document;
    const fontSizeInput = panelDocument.querySelector('[data-typography-input="font-size"]');
    const fontWeightInput = panelDocument.querySelector('[data-typography-input="font-weight"]');
    const lineHeightInput = panelDocument.querySelector('[data-typography-input="line-height"]');
    const letterSpacingInput = panelDocument.querySelector('[data-typography-input="letter-spacing"]');

    expect(fontSizeInput).not.toBeNull();
    expect(fontWeightInput).not.toBeNull();
    expect(lineHeightInput).not.toBeNull();
    expect(letterSpacingInput).not.toBeNull();
    expect(fontSizeInput?.getAttribute('value')).toBe('22px');
    expect(fontWeightInput?.getAttribute('value')).toBe('500');
    expect(lineHeightInput?.getAttribute('value')).toBe('28px');
    expect(letterSpacingInput?.getAttribute('value')).toBe('1.5px');
    expect(fontSizeInput?.hasAttribute('readonly')).toBe(false);
    expect(
      panelDocument.querySelector('[data-typography-action="align-left"]'),
    ).not.toBeNull();
    expect(
      panelDocument.querySelector('[data-typography-action="align-center"]'),
    ).not.toBeNull();
    expect(
      panelDocument.querySelector('[data-typography-action="align-right"]'),
    ).not.toBeNull();
    expect(
      panelDocument.querySelector('[data-typography-action="align-justify"]'),
    ).not.toBeNull();
    expect(
      panelDocument.querySelector('[data-typography-action="font-italic"]'),
    ).not.toBeNull();
    expect(
      panelDocument.querySelector('[data-typography-action="font-underline"]'),
    ).not.toBeNull();
    expect(
      panelDocument.querySelector('[data-typography-color-trigger]'),
    ).not.toBeNull();
    expect(
      panelDocument.querySelector('[data-typography-color-palette] input[type="color"]'),
    ).not.toBeNull();
  });

  it('commits direct typography input edits for all four fields', async () => {
    const { default: VisBug } = await import(
      '../../public/page-edit/vendor/app/components/vis-bug/vis-bug.element.js'
    );

    document.body.innerHTML = `
      <p
        id="copy"
        style="
          font-size: 16px;
          font-weight: 400;
          line-height: 20px;
          letter-spacing: 0px;
        "
      >Typography target</p>
    `;

    const target = document.getElementById('copy');
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

    visbug.handleTypographyInputCommit('font-size', '24');
    visbug.handleTypographyInputCommit('font-weight', '700');
    visbug.handleTypographyInputCommit('line-height', '32');
    visbug.handleTypographyInputCommit('letter-spacing', '1.5');

    expect(target?.style.fontSize).toBe('24px');
    expect(target?.style.fontWeight).toBe('700');
    expect(target?.style.lineHeight).toBe('32px');
    expect(target?.style.letterSpacing).toBe('1.5px');
    expect(mutationLabels).toEqual([
      'font:font-size',
      'font:font-weight',
      'font:line-height',
      'font:letter-spacing',
    ]);
  });

  it('normalizes invalid typography values back to the previous valid value', async () => {
    const { default: VisBug } = await import(
      '../../public/page-edit/vendor/app/components/vis-bug/vis-bug.element.js'
    );

    const visbug = new VisBug();

    expect(visbug.normalizeTypographyInputValue('font-size', 'abc', '18px')).toBe('18px');
    expect(visbug.normalizeTypographyInputValue('font-weight', '250', '700')).toBe('700');
    expect(visbug.normalizeTypographyInputValue('line-height', '0', '24px')).toBe('24px');
    expect(visbug.normalizeTypographyInputValue('letter-spacing', '-3', '1px')).toBe('1px');
  });

  it('commits typography input changes on Enter', async () => {
    const { default: VisBug } = await import(
      '../../public/page-edit/vendor/app/components/vis-bug/vis-bug.element.js'
    );

    document.body.innerHTML = `
      <p id="copy" style="font-size: 16px;">Typography target</p>
    `;

    const target = document.getElementById('copy');
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

    const fontSizeInput = visbug.$shadow.querySelector(
      '[data-typography-input="font-size"]',
    ) as HTMLInputElement | null;

    expect(fontSizeInput).not.toBeNull();

    if (!fontSizeInput) throw new Error('font-size input missing');

    fontSizeInput.value = '24';
    fontSizeInput.dispatchEvent(
      new dom.window.KeyboardEvent('keydown', {
        key: 'Enter',
        bubbles: true,
      }),
    );

    expect(target?.style.fontSize).toBe('24px');
  });

  it('commits typography input changes on blur', async () => {
    const { default: VisBug } = await import(
      '../../public/page-edit/vendor/app/components/vis-bug/vis-bug.element.js'
    );

    document.body.innerHTML = `
      <p id="copy" style="letter-spacing: 0px;">Typography target</p>
    `;

    const target = document.getElementById('copy');
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

    const letterSpacingInput = visbug.$shadow.querySelector(
      '[data-typography-input="letter-spacing"]',
    ) as HTMLInputElement | null;

    expect(letterSpacingInput).not.toBeNull();

    if (!letterSpacingInput) throw new Error('letter-spacing input missing');

    letterSpacingInput.value = '2';
    letterSpacingInput.dispatchEvent(new dom.window.FocusEvent('blur', { bubbles: true }));

    expect(target?.style.letterSpacing).toBe('2px');
  });

  it('renders active typography states and applies icon actions', async () => {
    const { default: VisBug } = await import(
      '../../public/page-edit/vendor/app/components/vis-bug/vis-bug.element.js'
    );

    document.body.innerHTML = `
      <p
        id="copy"
        style="
          text-align: center;
          font-style: italic;
          text-decoration: underline;
          color: rgb(50, 60, 70);
        "
      >Typography target</p>
    `;

    const target = document.getElementById('copy');
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

    const alignCenter = visbug.$shadow.querySelector(
      '[data-typography-action="align-center"]',
    ) as HTMLButtonElement | null;
    const italic = visbug.$shadow.querySelector(
      '[data-typography-action="font-italic"]',
    ) as HTMLButtonElement | null;
    const underline = visbug.$shadow.querySelector(
      '[data-typography-action="font-underline"]',
    ) as HTMLButtonElement | null;
    const colorTrigger = visbug.$shadow.querySelector(
      '[data-typography-color-trigger]',
    ) as HTMLButtonElement | null;

    expect(alignCenter?.dataset.active).toBe('true');
    expect(italic?.dataset.active).toBe('true');
    expect(underline?.dataset.active).toBe('true');
    expect(colorTrigger?.getAttribute('style')).toContain('rgb(50, 60, 70)');

    const alignJustify = visbug.$shadow.querySelector(
      '[data-typography-action="align-justify"]',
    ) as HTMLButtonElement | null;

    if (!alignJustify || !italic || !underline) {
      throw new Error('typography actions missing');
    }

    alignJustify.click();
    italic.click();
    underline.click();

    expect(target?.style.textAlign).toBe('justify');
    expect(target?.style.fontStyle).toBe('normal');
    expect(target?.style.textDecoration).toBe('none');
  });

  it('exposes a working foreground color picker inside the typography panel', async () => {
    const { default: VisBug } = await import(
      '../../public/page-edit/vendor/app/components/vis-bug/vis-bug.element.js'
    );

    document.body.innerHTML = `
      <p id="copy" style="color: rgb(10, 20, 30);">Typography target</p>
    `;

    const target = document.getElementById('copy');
    const visbug = new VisBug();
    visbug.selectorEngine = {
      selection() {
        return target ? [target] : [];
      },
      recordStyleMutation({ mutate }) {
        mutate();
      },
      refreshSelectionUi() {},
      onSelectedUpdate(callback) {
        callback(target ? [target] : []);
      },
    };

    visbug.$shadow.innerHTML = visbug.render();
    visbug.colorPicker = (await import(
      '../../public/page-edit/vendor/app/features/color.js'
    )).ColorPicker(visbug.$shadow, visbug.selectorEngine);
    visbug.bindBottomToolbarEvents();

    const colorInput = visbug.$shadow.querySelector(
      '[data-typography-color-palette] input[type="color"]',
    ) as HTMLInputElement | null;

    expect(colorInput).not.toBeNull();
    if (!colorInput) throw new Error('foreground color input missing');

    colorInput.value = '#ff0000';
    colorInput.dispatchEvent(new dom.window.Event('input', { bubbles: true }));

    expect(target?.style.color).toBe('rgb(255, 0, 0)');
  });

  it('keeps the typography color picker mounted during live input and refreshes after change', async () => {
    const { default: VisBug } = await import(
      '../../public/page-edit/vendor/app/components/vis-bug/vis-bug.element.js'
    );
    const { Selectable } = await import(
      '../../public/page-edit/vendor/app/features/selectable.js'
    );

    document.body.innerHTML = `
      <p id="copy" style="color: rgb(10, 20, 30);">Typography target</p>
    `;

    const visbug = document.createElement('vis-bug') as InstanceType<typeof VisBug>;
    document.body.appendChild(visbug);
    visbug.connectedCallback();

    const selectable = Selectable(visbug);
    visbug.selectorEngine = selectable;
    visbug.colorPicker = (await import(
      '../../public/page-edit/vendor/app/features/color.js'
    )).ColorPicker(visbug.$shadow, visbug.selectorEngine);

    const refreshSpy = vi.spyOn(visbug, 'refreshBottomToolbar');
    const target = document.getElementById('copy') as HTMLElement | null;
    if (!target) throw new Error('typography target missing');

    selectable.select(target);
    visbug.activateBottomToolbarTool('typography');

    const colorInput = visbug.$shadow.querySelector(
      '[data-typography-color-palette] input[type="color"]',
    ) as HTMLInputElement | null;

    expect(colorInput).not.toBeNull();
    if (!colorInput) throw new Error('foreground color input missing');

    colorInput.value = '#ff0000';
    colorInput.dispatchEvent(new dom.window.Event('input', { bubbles: true }));

    expect(target.style.color).toBe('rgb(255, 0, 0)');
    expect(colorInput.isConnected).toBe(true);

    colorInput.dispatchEvent(new dom.window.Event('change', { bubbles: true }));

    expect(refreshSpy).toHaveBeenCalled();

    selectable.disconnect();
    visbug.disconnectedCallback();
    visbug.remove();
  });

  it('renders spacing panels with linked inputs by default for symmetric values', async () => {
    const { default: VisBug } = await import(
      '../../public/page-edit/vendor/app/components/vis-bug/vis-bug.element.js'
    );

    document.body.innerHTML = `
      <div
        id="box"
        style="
          padding-top: 12px;
          padding-right: 24px;
          padding-bottom: 12px;
          padding-left: 24px;
        "
      >Box</div>
    `;

    const visbug = new VisBug();
    visbug.selectorEngine = {
      selection() {
        return [document.getElementById('box')];
      },
    };

    const markup = visbug.renderSpacingPanel('padding');
    const panelDocument = new JSDOM(markup).window.document;

    expect(panelDocument.querySelector('[data-spacing-panel="padding"]')).not.toBeNull();
    expect(panelDocument.querySelector('[data-spacing-grid="linked"]')).not.toBeNull();
    expect(
      panelDocument.querySelector('[data-spacing-input="vertical"]')?.getAttribute('value'),
    ).toBe('12px');
    expect(
      panelDocument.querySelector('[data-spacing-input="horizontal"]')?.getAttribute('value'),
    ).toBe('24px');
  });

  it('switches spacing panels to split mode for asymmetric values', async () => {
    const { default: VisBug } = await import(
      '../../public/page-edit/vendor/app/components/vis-bug/vis-bug.element.js'
    );

    document.body.innerHTML = `
      <div
        id="box"
        style="
          margin-top: 4px;
          margin-right: 8px;
          margin-bottom: 12px;
          margin-left: 16px;
        "
      >Box</div>
    `;

    const visbug = new VisBug();
    visbug.selectorEngine = {
      selection() {
        return [document.getElementById('box')];
      },
    };

    const markup = visbug.renderSpacingPanel('margin');
    const panelDocument = new JSDOM(markup).window.document;

    expect(panelDocument.querySelector('[data-spacing-grid="split"]')).not.toBeNull();
    expect(panelDocument.querySelector('[data-spacing-input="top"]')?.getAttribute('value')).toBe(
      '4px',
    );
    expect(panelDocument.querySelector('[data-spacing-input="left"]')?.getAttribute('value')).toBe(
      '16px',
    );
  });

  it('commits linked and split spacing input edits', async () => {
    const { default: VisBug } = await import(
      '../../public/page-edit/vendor/app/components/vis-bug/vis-bug.element.js'
    );

    document.body.innerHTML = `
      <div
        id="box"
        style="
          padding-top: 10px;
          padding-right: 10px;
          padding-bottom: 10px;
          padding-left: 10px;
          margin-top: 6px;
          margin-right: 6px;
          margin-bottom: 6px;
          margin-left: 6px;
        "
      >Box</div>
    `;

    const target = document.getElementById('box');
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

    visbug.handleSpacingInputCommit('padding', 'vertical', '20');
    visbug.handleSpacingInputCommit('margin', 'left', '18');

    expect(target?.style.paddingTop).toBe('20px');
    expect(target?.style.paddingBottom).toBe('20px');
    expect(target?.style.marginLeft).toBe('18px');
    expect(mutationLabels).toEqual(['padding:vertical', 'margin:left']);
  });

  it('toggles spacing panels between linked and split modes', async () => {
    const { default: VisBug } = await import(
      '../../public/page-edit/vendor/app/components/vis-bug/vis-bug.element.js'
    );

    document.body.innerHTML = '<div id="box" style="padding: 12px 16px;">Box</div>';

    const visbug = new VisBug();
    visbug.selectorEngine = {
      selection() {
        return [document.getElementById('box')];
      },
      refreshSelectionUi() {},
    };
    visbug.refreshBottomToolbar = vi.fn();

    expect(visbug.getSpacingPanelState('padding').mode).toBe('linked');

    visbug.toggleSpacingPanelMode('padding');
    expect(visbug.getSpacingPanelState('padding').mode).toBe('split');

    visbug.toggleSpacingPanelMode('padding');
    expect(visbug.getSpacingPanelState('padding').mode).toBe('linked');
    expect(visbug.refreshBottomToolbar).toHaveBeenCalledTimes(2);
  });
});
