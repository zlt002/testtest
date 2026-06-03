// @vitest-environment node

import { JSDOM } from 'jsdom';
import { readFile } from 'node:fs/promises';
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
  it('只有本地快照渲染底部工具栏壳层，真实网页不显示底栏', async () => {
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
    expect(liveMarkup).not.toContain('data-action="capture-page"');
    expect(liveMarkup).not.toContain('data-action="toggle-annotation-markers"');
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
    expect(markup).toContain('data-bottom-tool="content"');
    expect(markup).toContain('data-bottom-tool="move"');
    expect(markup).toContain('data-bottom-tool="background"');
    expect(markup).toContain('data-bottom-tool="reorder"');
    expect(markup).toContain('data-bottom-divider');
    expect(markup).not.toContain('data-toolbar-panel');
    expect(markup).not.toContain('data-tool-group=');

    dom.reconfigure({ url: 'https://example.com/orders' });
    const liveMarkup = visbug.render().replace(/<style[\s\S]*?<\/style>/, '');
    expect(liveMarkup).not.toContain('data-bottom-toolbar=');
    expect(liveMarkup).not.toContain('data-bottom-toolbar-actions');
    expect(liveMarkup).not.toContain('data-action="capture-page"');
    expect(liveMarkup).not.toContain('data-action="toggle-annotation-markers"');
  });

  it('本地快照底部工具栏直接渲染上弹动作菜单', async () => {
    dom.reconfigure({ url: 'file:///Users/demo/index.html' });
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

    expect(markup).toContain('data-bottom-menu');
    expect(markup).toContain('data-bottom-tool="move"');
    expect(markup).not.toContain('data-bottom-action="up-1"');
    expect(markup).toContain('data-size-panel');
    expect(markup).toContain('data-size-input="width"');
    expect(markup).toContain('data-size-input="height"');
    expect(markup).toContain('data-spacing-panel="padding"');
    expect(markup).toContain('data-spacing-panel="margin"');
    expect(markup).toContain('data-spacing-input="vertical"');
    expect(markup).toContain('data-spacing-input="horizontal"');
    expect(markup).toContain('data-bottom-tool="background"');
    expect(markup).toContain('data-background-inline-tool');
    expect(markup).toContain('id="background"');
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
    expect(markup).not.toContain('data-background-panel');
    expect(markup).not.toContain('data-bottom-color-target="border"');
    expect(markup).not.toContain('data-bottom-action="font-plus-1"');
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

  it('保存时只保留页面改动，不保留编辑态拖拽与工作台痕迹', async () => {
    dom.reconfigure({ url: 'file:///Users/demo/index.html' });
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true);
    const postMessageSpy = vi.spyOn(window, 'postMessage').mockImplementation(() => undefined);
    const { default: VisBug } = await import(
      '../../public/page-edit/vendor/app/components/vis-bug/vis-bug.element.js'
    );

    document.documentElement.setAttribute(
      'data-webmcp-page-edit-config',
      JSON.stringify({ pageMode: 'local-snapshot' }),
    );
    document.head.insertAdjacentHTML(
      'beforeend',
      '<link rel="stylesheet" href="chrome-extension://demo/page-edit.css" data-webmcp-page-edit-style="true">',
    );
    document.body.innerHTML = `
      <div
        id="target"
        draggable="true"
        data-webmcp-page-edit-draggable="true"
        data-webmcp-page-edit-surface-cursor="move"
        data-selected="true"
        data-pseudo-select="true"
        visbug-drag-src="true"
        style="position: relative; left: 12px; top: 8px; cursor: move;"
      >
        已移动卡片
      </div>
      <visbug-grip style="--top: 10px; --left: 20px;"></visbug-grip>
    `;

    const visbug = new VisBug();
    document.body.prepend(visbug);
    visbug.setAttribute('data-webmcp-page-edit-root', 'true');
    visbug.setSelectionBridgeNonce('nonce-clean');

    visbug.saveCurrentFile();

    expect(confirmSpy).toHaveBeenCalledOnce();
    expect(postMessageSpy).toHaveBeenCalledOnce();

    const payload = postMessageSpy.mock.calls[0]?.[0] as {
      payload: { html: string };
    };
    const savedHtml = payload.payload.html;

    expect(savedHtml).toContain('left: 12px;');
    expect(savedHtml).toContain('top: 8px;');
    expect(savedHtml).not.toContain('<vis-bug');
    expect(savedHtml).not.toContain('<visbug-grip');
    expect(savedHtml).not.toContain('data-webmcp-page-edit-root');
    expect(savedHtml).not.toContain('data-webmcp-page-edit-style');
    expect(savedHtml).not.toContain('draggable="true"');
    expect(savedHtml).not.toContain('data-webmcp-page-edit-draggable');
    expect(savedHtml).not.toContain('data-webmcp-page-edit-surface-cursor');
    expect(savedHtml).not.toContain('visbug-drag-src');
    expect(savedHtml).not.toContain('data-selected=');
    expect(savedHtml).not.toContain('data-pseudo-select=');
    expect(savedHtml).not.toContain('data-label-id=');
    expect(savedHtml).not.toContain('cursor: move');
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

  it('点击底部保存按钮时复用现有保存逻辑', async () => {
    document.documentElement.setAttribute(
      'data-webmcp-page-edit-config',
      JSON.stringify({ pageMode: 'local-snapshot' }),
    );
    dom.reconfigure({ url: 'file:///Users/demo/index.html' });
    const { default: VisBug } = await import(
      '../../public/page-edit/vendor/app/components/vis-bug/vis-bug.element.js'
    );
    const visbug = new VisBug();
    const saveSpy = vi.spyOn(visbug, 'saveCurrentFile').mockImplementation(() => undefined);

    document.body.appendChild(visbug);

    visbug.$shadow
      .querySelector('button[data-action="save-file"]')
      ?.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true, cancelable: true }));

    expect(saveSpy).toHaveBeenCalledOnce();

    visbug.remove();
  });

  it('本地快照预览页也允许点击保存并发送保存消息', async () => {
    document.documentElement.setAttribute(
      'data-webmcp-page-edit-config',
      JSON.stringify({ pageMode: 'local-snapshot' }),
    );
    dom.reconfigure({ url: 'http://127.0.0.1:8792/api/preview/assets/demo-preview/captures/demo/index.html' });
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true);
    const postMessageSpy = vi.spyOn(window, 'postMessage').mockImplementation(() => undefined);
    const { default: VisBug } = await import(
      '../../public/page-edit/vendor/app/components/vis-bug/vis-bug.element.js'
    );
    const visbug = new VisBug();

    visbug.setSelectionBridgeNonce('nonce-preview');
    const expectedHtml = visbug.serializeCurrentDocument();
    visbug.saveCurrentFile();

    expect(confirmSpy).toHaveBeenCalledOnce();
    expect(postMessageSpy).toHaveBeenCalledWith(
      {
        type: 'page_edit_save_file',
        payload: {
          nonce: 'nonce-preview',
          pageUrl: 'http://127.0.0.1:8792/api/preview/assets/demo-preview/captures/demo/index.html',
          html: expectedHtml,
        },
      },
      '*',
    );
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

  it('本地快照模式挂载后默认开启全局 label，但不自动激活 inspector', async () => {
    document.documentElement.setAttribute(
      'data-webmcp-page-edit-config',
      JSON.stringify({ pageMode: 'local-snapshot' }),
    );
    dom.reconfigure({ url: 'file:///Users/demo/index.html' });
    const { default: VisBug } = await import(
      '../../public/page-edit/vendor/app/components/vis-bug/vis-bug.element.js'
    );
    const visbug = new VisBug();

    document.body.appendChild(visbug);

    expect(visbug.shouldShowSelectionActionsEverywhere()).toBe(true);
    expect(visbug.activeTool).toBeNull();

    visbug.remove();
  });

  it('挂载时会清掉旧快照残留的选择态属性，避免脏页面继续污染本次编辑', async () => {
    document.documentElement.setAttribute(
      'data-webmcp-page-edit-config',
      JSON.stringify({ pageMode: 'local-snapshot' }),
    );
    dom.reconfigure({ url: 'file:///Users/demo/index.html' });
    document.body.innerHTML = `
      <table>
        <tbody>
          <tr>
            <td id="dirty-cell" data-label-id="22" data-selected="true" data-pseudo-select="true">
              脏单元格
            </td>
          </tr>
        </tbody>
      </table>
    `;
    const { default: VisBug } = await import(
      '../../public/page-edit/vendor/app/components/vis-bug/vis-bug.element.js'
    );
    const visbug = new VisBug();

    document.body.appendChild(visbug);

    const dirtyCell = document.getElementById('dirty-cell');
    expect(dirtyCell?.hasAttribute('data-label-id')).toBe(false);
    expect(dirtyCell?.hasAttribute('data-selected')).toBe(false);
    expect(dirtyCell?.hasAttribute('data-pseudo-select')).toBe(false);

    visbug.remove();
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

    expect(markup).toContain('data-bottom-tool="move"');
    expect(markup).toContain('data-bottom-menu');
    expect(markup).not.toContain('data-bottom-action="up-1"');
    expect(markup).not.toContain('data-bottom-subtool-list');
    expect(visbug.$shadow.querySelector('button[data-action="toggle-tool-section"]')).toBeNull();
  });

  it('退出编辑时保留已持久化的备注标识', async () => {
    dom.reconfigure({ url: 'file:///Users/demo/index.html' });
    const annotationRuntime = await import('../../public/page-edit/runtime/annotations.js');
    const { default: VisBug } = await import(
      '../../public/page-edit/vendor/app/components/vis-bug/vis-bug.element.js'
    );

    annotationRuntime.clearSelectionAnnotationUi();
    const previousRequestAnimationFrame = window.requestAnimationFrame;
    window.requestAnimationFrame = ((callback: FrameRequestCallback) => {
      callback(0);
      return 1;
    }) as typeof window.requestAnimationFrame;

    document.body.innerHTML = '<main><div id="target">测试备注</div></main>';
    const target = document.getElementById('target') as HTMLElement | null;
    expect(target).toBeTruthy();

    annotationRuntime.upsertSelectionAnnotation(target!, '这里是持久化备注');
    expect(document.querySelector('[data-webmcp-annotation-marker="true"]')).toBeTruthy();

    const visbug = new VisBug();
    visbug.selectorEngine = {
      disconnect: vi.fn(),
    };

    expect(() => visbug.disconnectedCallback()).not.toThrow();
    expect(document.querySelector('[data-webmcp-annotation-marker="true"]')).toBeTruthy();

    const ejectSource = await readFile(
      new URL('../../public/page-edit/eject.js', import.meta.url),
      'utf8',
    );
    window.eval(ejectSource);
    expect(document.querySelector('[data-webmcp-annotation-marker="true"]')).toBeTruthy();

    window.requestAnimationFrame = previousRequestAnimationFrame;
    annotationRuntime.clearSelectionAnnotationUi();
  });

  it('退出编辑后点击备注角标仍可弹出备注内容', async () => {
    dom.reconfigure({ url: 'file:///Users/demo/index.html' });
    const annotationRuntime = await import('../../public/page-edit/runtime/annotations.js');
    const { default: VisBug } = await import(
      '../../public/page-edit/vendor/app/components/vis-bug/vis-bug.element.js'
    );

    annotationRuntime.clearSelectionAnnotationUi();
    const previousRequestAnimationFrame = window.requestAnimationFrame;
    window.requestAnimationFrame = ((callback: FrameRequestCallback) => {
      callback(0);
      return 1;
    }) as typeof window.requestAnimationFrame;

    document.body.innerHTML = '<main><div id="target">测试备注</div></main>';
    const target = document.getElementById('target') as HTMLElement | null;
    expect(target).toBeTruthy();

    const openSpy = vi.fn().mockResolvedValue(null);
    annotationRuntime.setAnnotationDialogOpenHandlerForTest(openSpy);
    annotationRuntime.upsertSelectionAnnotation(target!, '退出后仍可查看');

    const visbug = new VisBug();
    visbug.selectorEngine = {
      disconnect: vi.fn(),
    };
    expect(() => visbug.disconnectedCallback()).not.toThrow();

    const ejectSource = await readFile(
      new URL('../../public/page-edit/eject.js', import.meta.url),
      'utf8',
    );
    window.eval(ejectSource);

    const marker = document.querySelector('[data-webmcp-annotation-marker="true"]') as HTMLElement | null;
    expect(marker).toBeTruthy();

    marker?.dispatchEvent(
      new window.MouseEvent('click', {
        bubbles: true,
        cancelable: true,
      }),
    );
    await Promise.resolve();

    expect(openSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        content: '退出后仍可查看',
      }),
    );

    annotationRuntime.setAnnotationDialogOpenHandlerForTest(null);
    window.requestAnimationFrame = previousRequestAnimationFrame;
    annotationRuntime.clearSelectionAnnotationUi();
  });

  it('保存后的 html 里点击备注角标可以查看备注内容', async () => {
    dom.reconfigure({ url: 'file:///Users/demo/index.html' });
    const annotationRuntime = await import('../../public/page-edit/runtime/annotations.js');
    const { default: VisBug } = await import(
      '../../public/page-edit/vendor/app/components/vis-bug/vis-bug.element.js'
    );

    annotationRuntime.clearSelectionAnnotationUi();
    const previousRequestAnimationFrame = window.requestAnimationFrame;
    window.requestAnimationFrame = ((callback: FrameRequestCallback) => {
      callback(0);
      return 1;
    }) as typeof window.requestAnimationFrame;

    document.body.innerHTML = '<main><div id="target">测试备注</div></main>';
    const target = document.getElementById('target') as HTMLElement | null;
    expect(target).toBeTruthy();

    annotationRuntime.upsertSelectionAnnotation(target!, '这是保存到 html 的备注内容');

    const visbug = new VisBug();
    const savedHtml = visbug.serializeCurrentDocument();

    expect(savedHtml).toContain('data-webmcp-annotation-marker="true"');

    const savedDom = new JSDOM(savedHtml, {
      url: 'file:///Users/demo/index.html',
      runScripts: 'dangerously',
    });

    try {
      const marker = savedDom.window.document.querySelector(
        '[data-webmcp-annotation-marker="true"]',
      ) as HTMLElement | null;
      expect(marker).toBeTruthy();

      marker?.dispatchEvent(
        new savedDom.window.MouseEvent('click', {
          bubbles: true,
          cancelable: true,
        }),
      );

      const dialog = savedDom.window.document.querySelector(
        '[data-webmcp-saved-annotation-dialog="true"]',
      ) as HTMLElement | null;
      expect(dialog).toBeTruthy();
      expect(dialog?.textContent).toContain('这是保存到 html 的备注内容');
    } finally {
      savedDom.window.close();
      window.requestAnimationFrame = previousRequestAnimationFrame;
      annotationRuntime.clearSelectionAnnotationUi();
    }
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
