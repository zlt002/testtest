// @vitest-environment node

import { JSDOM } from 'jsdom';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

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

afterAll(() => {
  dom.window.close();
  const { navigator: previousNavigator, ...restGlobals } = previousGlobals;
  Object.assign(globalThis, restGlobals);
  Object.defineProperty(globalThis, 'navigator', {
    configurable: true,
    value: previousNavigator,
  });
});

describe('page-edit bottom toolbar shell', () => {
  it('includes flat bottom toolbar shell styles for idle and selected states', async () => {
    const { visbug_css } = await import(
      '../../public/page-edit/vendor/app/components/styles.store.js'
    );

    expect(visbug_css).toContain('[data-bottom-toolbar]');
    expect(visbug_css).toContain('[data-bottom-toolbar-hint]');
    expect(visbug_css).toContain('[data-bottom-tools]');
    expect(visbug_css).toContain('[data-bottom-tool]');
    expect(visbug_css).toContain('[data-bottom-menu]');
    expect(visbug_css).toContain(
      ':host [data-bottom-menu] {\n' +
        '  position: absolute;\n' +
        '  left: 50%;\n' +
        '  bottom: calc(100% + 10px);\n' +
        '  transform: translateX(-50%) translateY(6px);\n' +
        '  min-width: max-content;\n' +
        '  max-width: min(560px, calc(100vw - 32px));\n' +
        '  display: grid;\n' +
        '  gap: 6px;\n' +
        '  padding: 8px;\n' +
        '  border: 1px solid var(--theme-card_border);\n' +
        '  border-radius: 12px;\n' +
        '  background: var(--theme-bd-2);\n' +
        '  box-shadow: none;',
    );
    expect(visbug_css).not.toContain('[data-tool-groups]');
  });

  it('renders an idle bottom hint instead of the old left rail when nothing is selected', async () => {
    document.documentElement.setAttribute(
      'data-webmcp-page-edit-config',
      JSON.stringify({ pageMode: 'local-snapshot' }),
    );

    const { default: VisBug } = await import(
      '../../public/page-edit/vendor/app/components/vis-bug/vis-bug.element.js'
    );

    const visbug = new VisBug();
    const markup = visbug.render();
    const shellMarkup = markup.replace(/<style[\s\S]*?<\/style>/, '');

    expect(shellMarkup).toContain('data-bottom-toolbar="idle"');
    expect(shellMarkup).toContain('data-bottom-toolbar-hint');
    expect(shellMarkup).toContain('data-bottom-toolbar-actions');
    expect(shellMarkup).toContain('data-action="save-file"');
    expect(shellMarkup).not.toContain('data-toolbar-panel');
    expect(shellMarkup).not.toContain('data-tool-list');
    expect(shellMarkup).not.toContain('data-tool-group=');
  });

  it('renders flat bottom tools and popup action menus after an element is selected', async () => {
    document.documentElement.setAttribute(
      'data-webmcp-page-edit-config',
      JSON.stringify({ pageMode: 'local-snapshot' }),
    );

    document.body.innerHTML = '<div id="target">Hello</div>';

    const { default: VisBug } = await import(
      '../../public/page-edit/vendor/app/components/vis-bug/vis-bug.element.js'
    );

    const visbug = new VisBug();
    visbug.selectorEngine = {
      selection() {
        return [document.getElementById('target')];
      },
    };

    const markup = visbug.render();
    const shellMarkup = markup.replace(/<style[\s\S]*?<\/style>/, '');

    expect(shellMarkup).toContain('data-bottom-toolbar="selected"');
    expect(shellMarkup).toContain('data-bottom-tools');
    expect(shellMarkup).toContain('data-bottom-tool="content"');
    expect(shellMarkup).toContain('data-bottom-tool="move"');
    expect(shellMarkup).toContain('data-bottom-tool="resize"');
    expect(shellMarkup).toContain('data-bottom-tool="padding"');
    expect(shellMarkup).toContain('data-bottom-tool="typography"');
    expect(shellMarkup).toContain('data-bottom-tool="background"');
    expect(shellMarkup).toContain('data-bottom-tool="reorder"');
    expect(shellMarkup).toContain('data-bottom-toolbar-actions');
    expect(shellMarkup).toContain('data-action="save-file"');
    expect(shellMarkup).not.toContain('data-bottom-tool="inspect"');
    expect(shellMarkup).toContain('data-bottom-divider');
    expect(shellMarkup).toContain('data-bottom-menu');
    expect(shellMarkup).toContain('data-bottom-action="up-1"');
    expect(shellMarkup).toContain('data-bottom-action="width-plus-1"');
    expect(shellMarkup).toContain('data-spacing-panel="padding"');
    expect(shellMarkup).toContain('data-spacing-panel="margin"');
    expect(shellMarkup).toContain('data-spacing-input="vertical"');
    expect(shellMarkup).toContain('data-spacing-input="horizontal"');
    expect(shellMarkup).not.toContain('data-tool-group=');
    expect(shellMarkup).not.toContain('data-subtool=');
  });

  it('renders disabled tools with reason text when the selected element cannot use them', async () => {
    document.documentElement.setAttribute(
      'data-webmcp-page-edit-config',
      JSON.stringify({ pageMode: 'local-snapshot' }),
    );

    document.body.innerHTML = '<table><tr><td id="cell">A</td></tr></table>';

    const { default: VisBug } = await import(
      '../../public/page-edit/vendor/app/components/vis-bug/vis-bug.element.js'
    );

    const visbug = new VisBug();
    visbug.selectorEngine = {
      selection() {
        return [document.getElementById('cell')];
      },
    };

    const markup = visbug.render();

    expect(markup).toContain('data-bottom-tool="move"');
    expect(markup).toContain('data-disabled="true"');
    expect(markup).toContain('当前元素不适合直接拖动位置');
    expect(markup).toContain('data-bottom-tooltip');
  });

  it('maps flat bottom tools to the current page-edit features', async () => {
    document.documentElement.setAttribute(
      'data-webmcp-page-edit-config',
      JSON.stringify({ pageMode: 'live' }),
    );

    const { default: VisBug } = await import(
      '../../public/page-edit/vendor/app/components/vis-bug/vis-bug.element.js'
    );

    const visbug = new VisBug();
    const tools = visbug.getBottomToolbarTools();

    expect(tools.map(tool => tool.id)).toEqual([
      'content',
      'move',
      'resize',
      'padding',
      'margin',
      'flex',
      'typography',
      'background',
      'reorder',
    ]);
    expect(tools.find(tool => tool.id === 'move')?.feature).toBe('position');
    expect(tools.find(tool => tool.id === 'resize')?.feature).toBe('position');
    expect(tools.find(tool => tool.id === 'reorder')?.feature).toBe('move');
    expect(visbug.getBottomToolbarToolActions('move')[0]?.map(action => action.id)).toEqual([
      'up-1',
      'down-1',
      'left-1',
      'right-1',
    ]);
    expect(visbug.render()).not.toContain('data-action="save-file"');
  });

  it('keeps typography color adjustments on the typography tool', async () => {
    const { default: VisBug } = await import(
      '../../public/page-edit/vendor/app/components/vis-bug/vis-bug.element.js'
    );

    const visbug = new VisBug();
    const actionIds = visbug
      .getBottomToolbarToolActions('typography')
      .flat()
      .map(action => action.id);

    expect(actionIds).not.toContain('hue-plus');
    expect(actionIds).not.toContain('hue-minus');
    expect(actionIds).not.toContain('light-plus');
    expect(actionIds).not.toContain('light-minus');
    expect(actionIds).not.toContain('sat-plus');
    expect(actionIds).not.toContain('sat-minus');
    expect(actionIds).not.toContain('alpha-plus');
    expect(actionIds).not.toContain('alpha-minus');
  });

  it('renders typography as an editor-style panel instead of legacy action rows', async () => {
    document.documentElement.setAttribute(
      'data-webmcp-page-edit-config',
      JSON.stringify({ pageMode: 'local-snapshot' }),
    );

    const { default: VisBug } = await import(
      '../../public/page-edit/vendor/app/components/vis-bug/vis-bug.element.js'
    );

    document.body.innerHTML = '<p id="copy">Typography target</p>';
    const visbug = new VisBug();
    visbug.selectorEngine = {
      selection() {
        return [document.getElementById('copy')];
      },
    };

    const markup = visbug.render().replace(/<style[\s\S]*?<\/style>/, '');

    expect(markup).toContain('data-typography-panel');
    expect(markup).toContain('data-typography-input="font-size"');
    expect(markup).toContain('data-typography-input="font-weight"');
    expect(markup).toContain('data-typography-input="line-height"');
    expect(markup).toContain('data-typography-input="letter-spacing"');
    expect(markup).not.toMatch(/data-typography-input="font-size"[\s\S]*?readonly/);
    expect(markup).not.toMatch(/data-typography-input="font-weight"[\s\S]*?readonly/);
    expect(markup).toContain('data-typography-action="align-left"');
    expect(markup).toContain('data-typography-action="align-center"');
    expect(markup).toContain('data-typography-action="align-right"');
    expect(markup).toContain('data-typography-action="align-justify"');
    expect(markup).toContain('data-bottom-action="align-left"');
    expect(markup).toContain('data-typography-action="font-bold"');
    expect(markup).toContain('data-typography-action="font-italic"');
    expect(markup).toContain('data-typography-action="font-underline"');
    expect(markup).toContain('data-bottom-action="font-bold"');
    expect(markup).toContain('data-typography-color-trigger');
    expect(markup).toContain('data-bottom-color-target="foreground"');
    expect(markup).not.toContain('data-bottom-action="font-plus-1"');
  });

  it('routes typography shortcut actions back through the existing bottom action path', async () => {
    const { default: VisBug } = await import(
      '../../public/page-edit/vendor/app/components/vis-bug/vis-bug.element.js'
    );

    document.body.innerHTML = '<p id="copy">Typography target</p>';
    const target = document.getElementById('copy');
    const visbug = new VisBug();
    visbug.selectorEngine = {
      selection() {
        return [target];
      },
      recordStyleMutation({ mutate }) {
        mutate();
      },
      refreshSelectionUi: vi.fn(),
    };
    const fontSpy = vi.spyOn(visbug, 'font').mockImplementation(() => {
      // @ts-expect-error test double
      visbug.deactivate_feature = vi.fn();
    });

    visbug.runBottomToolbarAction('typography', 'font-bold');

    expect(fontSpy).toHaveBeenCalledOnce();
    expect(target.style.fontWeight).toBe('700');
  });
  it('exposes the 9 PM-facing toolbar tools in a fixed order', async () => {
    const { default: VisBug } = await import(
      '../../public/page-edit/vendor/app/components/vis-bug/vis-bug.element.js'
    );

    const visbug = new VisBug();
    const tools = visbug.getBottomToolbarTools();

    expect(tools.map(tool => tool.id)).toEqual([
      'content',
      'move',
      'resize',
      'padding',
      'margin',
      'flex',
      'typography',
      'background',
      'reorder',
    ]);
  });

  it('does not auto-activate an editing tool in local snapshot mode', async () => {
    document.documentElement.setAttribute(
      'data-webmcp-page-edit-config',
      JSON.stringify({ pageMode: 'local-snapshot' }),
    );

    const { default: VisBug } = await import(
      '../../public/page-edit/vendor/app/components/vis-bug/vis-bug.element.js'
    );

    const visbug = new VisBug();
    const toolSelectedSpy = vi.spyOn(visbug, 'toolSelected');

    visbug.connectedCallback();

    expect(toolSelectedSpy).not.toHaveBeenCalled();
    expect(visbug.activeTool).toBe(null);

    visbug.disconnectedCallback();
  });

  it('activates the mapped feature when a bottom toolbar tool is chosen', async () => {
    const { default: VisBug } = await import(
      '../../public/page-edit/vendor/app/components/vis-bug/vis-bug.element.js'
    );

    const visbug = new VisBug();
    visbug.selectorEngine = {
      selection() {
        return [document.body];
      },
      refreshSelectionUi: vi.fn(),
    };
    const positionSpy = vi.spyOn(visbug, 'position').mockImplementation(() => {
      // @ts-expect-error test double
      visbug.deactivate_feature = vi.fn();
    });

    visbug.activateBottomToolbarTool('move');

    expect(positionSpy).toHaveBeenCalledOnce();
    expect(visbug.activeTool).toBe('position');
    expect(visbug._bottomToolbarState.activeSubtool).toBe('move');
  });

  it('ignores disabled toolbar clicks for tools that are unavailable on the current element', async () => {
    document.documentElement.setAttribute(
      'data-webmcp-page-edit-config',
      JSON.stringify({ pageMode: 'local-snapshot' }),
    );

    document.body.innerHTML = '<table><tr><td id="cell">A</td></tr></table>';

    const { default: VisBug } = await import(
      '../../public/page-edit/vendor/app/components/vis-bug/vis-bug.element.js'
    );

    const visbug = new VisBug();
    visbug.selectorEngine = {
      selection() {
        return [document.getElementById('cell')];
      },
      refreshSelectionUi: vi.fn(),
    };
    const positionSpy = vi.spyOn(visbug, 'position').mockImplementation(() => {
      // @ts-expect-error test double
      visbug.deactivate_feature = vi.fn();
    });

    visbug.activateBottomToolbarTool('move');

    expect(positionSpy).not.toHaveBeenCalled();
    expect(visbug.activeTool).toBe(null);
  });

  it('keeps only the clicked bottom tool highlighted when multiple tools share one feature', async () => {
    document.documentElement.setAttribute(
      'data-webmcp-page-edit-config',
      JSON.stringify({ pageMode: 'local-snapshot' }),
    );

    document.body.innerHTML = '<div id="target">Hello</div>';

    const { default: VisBug } = await import(
      '../../public/page-edit/vendor/app/components/vis-bug/vis-bug.element.js'
    );

    const visbug = new VisBug();
    visbug.selectorEngine = {
      selection() {
        return [document.getElementById('target')];
      },
      refreshSelectionUi: vi.fn(),
      disconnect: vi.fn(),
    };
    vi.spyOn(visbug, 'position').mockImplementation(() => {
      // @ts-expect-error test double
      visbug.deactivate_feature = vi.fn();
    });

    visbug.activateBottomToolbarTool('resize');
    const markup = visbug.render();
    const parsed = new JSDOM(markup).window.document;
    const sizeButton = parsed.querySelector('[data-bottom-tool="resize"]');
    const positionButton = parsed.querySelector('[data-bottom-tool="move"]');

    expect(visbug.activeTool).toBe('position');
    expect(sizeButton?.getAttribute('data-active')).toBe('true');
    expect(sizeButton?.getAttribute('aria-expanded')).toBe('true');
    expect(positionButton?.getAttribute('data-active')).toBe('false');
    expect(positionButton?.getAttribute('aria-expanded')).toBe('false');
  });

  it('toggles the current bottom panel on repeated clicks', async () => {
    document.documentElement.setAttribute(
      'data-webmcp-page-edit-config',
      JSON.stringify({ pageMode: 'local-snapshot' }),
    );

    document.body.innerHTML = '<div id="target">Hello</div>';

    const { default: VisBug } = await import(
      '../../public/page-edit/vendor/app/components/vis-bug/vis-bug.element.js'
    );

    const visbug = new VisBug();
    visbug.selectorEngine = {
      selection() {
        return [document.getElementById('target')];
      },
      refreshSelectionUi: vi.fn(),
    };
    vi.spyOn(visbug, 'font').mockImplementation(() => {
      // @ts-expect-error test double
      visbug.deactivate_feature = vi.fn();
    });

    visbug.activateBottomToolbarTool('typography');
    expect(visbug._bottomToolbarState.activeSubtool).toBe('typography');

    visbug.activateBottomToolbarTool('typography');
    expect(visbug._bottomToolbarState.activeSubtool).toBe(null);
  });

  it('closes an opened bottom panel when clicking outside the toolbar host', async () => {
    document.documentElement.setAttribute(
      'data-webmcp-page-edit-config',
      JSON.stringify({ pageMode: 'local-snapshot' }),
    );

    document.body.innerHTML = '<div id="target">Hello</div>';

    const { default: VisBug } = await import(
      '../../public/page-edit/vendor/app/components/vis-bug/vis-bug.element.js'
    );

    const visbug = new VisBug();
    vi.spyOn(visbug, 'font').mockImplementation(() => {
      // @ts-expect-error test double
      visbug.deactivate_feature = vi.fn();
    });

    document.body.appendChild(visbug);
    visbug.connectedCallback();
    visbug.selectorEngine = {
      selection() {
        return [document.getElementById('target')];
      },
      refreshSelectionUi: vi.fn(),
    };
    visbug.activateBottomToolbarTool('typography');

    expect(visbug._bottomToolbarState.activeSubtool).toBe('typography');

    document.body.dispatchEvent(
      new dom.window.Event('pointerdown', { bubbles: true, composed: true }),
    );

    expect(visbug._bottomToolbarState.activeSubtool).toBe(null);

    visbug.disconnectedCallback();
  });
});
