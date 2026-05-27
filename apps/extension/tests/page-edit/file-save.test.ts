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
    Node: globalThis.Node,
    NodeList: globalThis.NodeList,
    MutationObserver: globalThis.MutationObserver,
    DOMException: globalThis.DOMException,
    CustomEvent: globalThis.CustomEvent,
    CSSStyleSheet: globalThis.CSSStyleSheet,
    Document: globalThis.Document,
    DOMParser: globalThis.DOMParser,
    CSS: globalThis.CSS,
    Event: globalThis.Event,
    MouseEvent: globalThis.MouseEvent,
    navigator: globalThis.navigator,
    getComputedStyle: globalThis.getComputedStyle,
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
    DOMParser: dom.window.DOMParser,
    CSS: dom.window.CSS ?? { escape: (value: string) => value },
    Event: dom.window.Event,
    MouseEvent: dom.window.MouseEvent,
    getComputedStyle: dom.window.getComputedStyle.bind(dom.window),
  });
  Object.defineProperty(globalThis, 'navigator', {
    configurable: true,
    value: dom.window.navigator,
  });
});

beforeEach(() => {
  vi.restoreAllMocks();
  document.body.innerHTML = '<main><h1>页面编辑</h1><p>测试内容</p></main>';
  dom.reconfigure({ url: 'https://example.com/' });
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

describe('page-edit file save action', () => {
  it('本地快照页面渲染底部工具栏壳层，非快照页面不渲染该壳层', async () => {
    dom.reconfigure({ url: 'file:///Users/demo/index.html' });
    const { default: VisBug } = await import(
      '../../public/page-edit/vendor/app/components/vis-bug/vis-bug.element.js'
    );
    const visbug = new VisBug();
    const fileMarkup = visbug.render().replace(/<style[\s\S]*?<\/style>/, '');

    expect(fileMarkup).toContain('data-bottom-toolbar="idle"');
    expect(fileMarkup).toContain('data-bottom-toolbar-hint');

    dom.reconfigure({ url: 'https://example.com/orders' });
    const liveMarkup = visbug.render().replace(/<style[\s\S]*?<\/style>/, '');
    expect(liveMarkup).not.toContain('data-bottom-toolbar=');
  });

  it('本地快照页面使用底部扁平工具栏替代旧左侧完整工具栏', async () => {
    dom.reconfigure({ url: 'file:///Users/demo/index.html' });
    const { default: VisBug } = await import(
      '../../public/page-edit/vendor/app/components/vis-bug/vis-bug.element.js'
    );
    const visbug = new VisBug();
    visbug.selectorEngine = {
      selection() {
        return [document.body];
      },
    };
    const markup = visbug.render().replace(/<style[\s\S]*?<\/style>/, '');

    expect(markup).toContain('data-bottom-toolbar="selected"');
    expect(markup).toContain('data-bottom-tools');
    expect(markup).toContain('data-bottom-tool="text"');
    expect(markup).toContain('data-bottom-tool="position"');
    expect(markup).toContain('data-bottom-tool="color"');
    expect(markup).toContain('data-bottom-tool="inspect"');
    expect(markup).toContain('data-bottom-divider');
    expect(markup).not.toContain('data-toolbar-panel');
    expect(markup).not.toContain('data-tool-group=');

    dom.reconfigure({ url: 'https://example.com/orders' });
    const liveMarkup = visbug.render().replace(/<style[\s\S]*?<\/style>/, '');
    expect(liveMarkup).not.toContain('data-bottom-toolbar=');
  });

  it('本地快照底部工具栏直接渲染上弹动作菜单', async () => {
    dom.reconfigure({ url: 'file:///Users/demo/index.html' });
    const { default: VisBug } = await import(
      '../../public/page-edit/vendor/app/components/vis-bug/vis-bug.element.js'
    );
    const visbug = new VisBug();
    visbug.selectorEngine = {
      selection() {
        return [document.body];
      },
    };
    const markup = visbug.render().replace(/<style[\s\S]*?<\/style>/, '');

    expect(markup).toContain('data-bottom-menu');
    expect(markup).toContain('data-bottom-tool="position"');
    expect(markup).toContain('data-bottom-action="up-1"');
    expect(markup).toContain('data-bottom-action="width-plus-1"');
    expect(markup).toContain('data-bottom-action="all-plus-1"');
    expect(markup).toContain('data-bottom-color-target="background"');
  });

  it('本地快照工具栏使用单层底部面板展示全部工具和动作菜单', async () => {
    dom.reconfigure({ url: 'file:///Users/demo/index.html' });
    const { default: VisBug } = await import(
      '../../public/page-edit/vendor/app/components/vis-bug/vis-bug.element.js'
    );
    const visbug = new VisBug();
    visbug.selectorEngine = {
      selection() {
        return [document.body];
      },
    };
    const markup = visbug.render().replace(/<style[\s\S]*?<\/style>/, '');

    expect(markup.match(/data-bottom-toolbar="selected"/g)?.length).toBe(1);
    expect(markup).toContain('data-bottom-tools');
    expect(markup).toContain('data-bottom-tool-item');
    expect(markup).toContain('data-bottom-menu-row');
    expect(markup).not.toContain('data-subtool=');
    expect(markup).not.toContain('data-toolbar-panel');
  });

  it('真实网页默认激活基础 selection 模式，但不依赖左侧工具栏', async () => {
    dom.reconfigure({ url: 'https://example.com/orders' });
    const { default: VisBug } = await import(
      '../../public/page-edit/vendor/app/components/vis-bug/vis-bug.element.js'
    );
    const visbug = new VisBug();
    const selectionSpy = vi.spyOn(visbug, 'selection').mockImplementation(() => {
      // @ts-expect-error test only needs a disposable callback
      visbug.deactivate_feature = vi.fn();
    });

    document.body.appendChild(visbug);

    expect(visbug.activeTool).toBe('selection');
    expect(selectionSpy).toHaveBeenCalledOnce();
    expect(visbug.render()).not.toContain('data-tool="guides"');

    visbug.remove();
  });

  it('确认后发送包含 nonce、pageUrl 与完整 html 的保存消息', async () => {
    dom.reconfigure({ url: 'file:///Users/demo/index.html' });
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true);
    const postMessageSpy = vi.spyOn(window, 'postMessage').mockImplementation(() => undefined);
    const { default: VisBug } = await import(
      '../../public/page-edit/vendor/app/components/vis-bug/vis-bug.element.js'
    );
    const visbug = new VisBug();

    visbug.setSelectionBridgeNonce('nonce-1');
    visbug.saveCurrentFile();

    expect(confirmSpy).toHaveBeenCalledWith('将覆盖原始 HTML 文件，是否继续保存？');
    expect(postMessageSpy).toHaveBeenCalledWith(
      {
        type: 'page_edit_save_file',
        payload: {
          nonce: 'nonce-1',
          pageUrl: 'file:///Users/demo/index.html',
          html: `<!DOCTYPE html>\n${document.documentElement.outerHTML}`,
        },
      },
      '*',
    );
  });

  it('用户取消确认时不发送保存消息', async () => {
    dom.reconfigure({ url: 'file:///Users/demo/index.html' });
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(false);
    const postMessageSpy = vi.spyOn(window, 'postMessage').mockImplementation(() => undefined);
    const { default: VisBug } = await import(
      '../../public/page-edit/vendor/app/components/vis-bug/vis-bug.element.js'
    );
    const visbug = new VisBug();

    visbug.setSelectionBridgeNonce('nonce-2');
    visbug.saveCurrentFile();

    expect(confirmSpy).toHaveBeenCalledOnce();
    expect(postMessageSpy).not.toHaveBeenCalled();
  });

  it('inspector 模式会同时激活 position 拖动能力', async () => {
    const { default: VisBug } = await import(
      '../../public/page-edit/vendor/app/components/vis-bug/vis-bug.element.js'
    );
    const visbug = new VisBug();
    const deactivateInspector = vi.fn();
    const deactivatePosition = vi.fn();

    visbug.selectorEngine = {
      onSelectedUpdate: vi.fn(),
      removeSelectedCallback: vi.fn(),
    };
    visbug.activatePositionFeature = vi.fn(() => deactivatePosition);
    // @ts-expect-error test isolates inspector wiring
    visbug.deactivate_feature = vi.fn();

    const features = await import('../../public/page-edit/vendor/app/features/index.js');
    const metaTipSpy = vi.spyOn(features, 'MetaTip').mockReturnValue(deactivateInspector);

    try {
      visbug.inspector();

      expect(metaTipSpy).toHaveBeenCalledWith(visbug.selectorEngine);
      expect(visbug.activatePositionFeature).toHaveBeenCalledOnce();

      visbug.deactivate_feature();

      expect(deactivateInspector).toHaveBeenCalledOnce();
      expect(deactivatePosition).toHaveBeenCalledOnce();
    } finally {
      metaTipSpy.mockRestore();
    }
  });

  it('切换选择操作总开关时仍会更新偏好并刷新选中 UI', async () => {
    dom.reconfigure({ url: 'file:///Users/demo/index.html' });
    const localStorageMock = {
      getItem: vi.fn().mockReturnValue(null),
      setItem: vi.fn(),
      removeItem: vi.fn(),
    };
    Object.defineProperty(window, 'localStorage', {
      configurable: true,
      value: localStorageMock,
    });
    const { default: VisBug } = await import(
      '../../public/page-edit/vendor/app/components/vis-bug/vis-bug.element.js'
    );
    const visbug = new VisBug();

    visbug.$shadow.innerHTML = '<button data-action="toggle-selection-actions"></button>';
    visbug.selectorEngine = {
      refreshSelectionUi: vi.fn(),
    };

    visbug.setSelectionActionsEverywhere(true);

    expect(visbug.shouldShowSelectionActionsEverywhere()).toBe(true);
    expect(localStorageMock.setItem).toHaveBeenCalledWith(
      'webmcp:page-edit-selection-actions-everywhere',
      '1'
    );
    expect(
      visbug.$shadow
        .querySelector('button[data-action="toggle-selection-actions"]')
        ?.getAttribute('aria-label')
    ).toBe('关闭全局操作');
    expect(visbug.selectorEngine.refreshSelectionUi).toHaveBeenCalledOnce();
  });

  it('底部工具栏不再依赖分组折叠按钮，动作菜单直接挂在工具图标下', async () => {
    dom.reconfigure({ url: 'file:///Users/demo/index.html' });
    const { default: VisBug } = await import(
      '../../public/page-edit/vendor/app/components/vis-bug/vis-bug.element.js'
    );
    const visbug = new VisBug();
    visbug.selectorEngine = {
      selection() {
        return [document.body];
      },
    };

    const markup = visbug.render().replace(/<style[\s\S]*?<\/style>/, '');

    expect(markup).toContain('data-bottom-tool="position"');
    expect(markup).toContain('data-bottom-menu');
    expect(markup).toContain('data-bottom-action="up-1"');
    expect(markup).not.toContain('data-bottom-subtool-list');
    expect(visbug.$shadow.querySelector('button[data-action="toggle-tool-section"]')).toBeNull();
  });

  it('卸载时即使局部清理报错，也会继续断开选择监听并清掉残留 UI', async () => {
    const { default: VisBug } = await import(
      '../../public/page-edit/vendor/app/components/vis-bug/vis-bug.element.js'
    );
    const visbug = new VisBug();
    const disconnectSpy = vi.fn();
    const unsubscribeSpy = vi.fn();
    const lingeringSelected = document.createElement('visbug-selected');
    const lingeringLabel = document.createElement('visbug-label');
    const pseudoNode = document.createElement('div');

    pseudoNode.setAttribute('data-pseudo-select', 'true');
    document.body.appendChild(lingeringSelected);
    document.body.appendChild(lingeringLabel);
    document.body.appendChild(pseudoNode);

    visbug.selectorEngine = {
      disconnect: disconnectSpy,
    };
    // @ts-expect-error test intentionally injects a failing cleanup branch
    visbug.deactivate_feature = vi.fn(() => {
      throw new Error('feature cleanup failed');
    });
    // @ts-expect-error test intentionally omits teardown implementation
    visbug.teardown = undefined;
    // @ts-expect-error test-only private field setup
    visbug._annotationStateUnsubscribe = unsubscribeSpy;

    expect(() => visbug.disconnectedCallback()).not.toThrow();
    expect(disconnectSpy).toHaveBeenCalledOnce();
    expect(unsubscribeSpy).toHaveBeenCalledOnce();
    expect(document.querySelector('visbug-selected')).toBeNull();
    expect(document.querySelector('visbug-label')).toBeNull();
    expect(pseudoNode.hasAttribute('data-pseudo-select')).toBe(false);
  });
});
