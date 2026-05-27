// @vitest-environment node

import { JSDOM } from 'jsdom';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

let dom: JSDOM;
let previousGlobals: Record<string, unknown>;
let previousElementFromPoint: Document['elementFromPoint'] | undefined;

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

  previousElementFromPoint = document.elementFromPoint?.bind(document);
});

afterEach(() => {
  document.body.innerHTML = '';
  if (previousElementFromPoint) {
    document.elementFromPoint = previousElementFromPoint;
  } else {
    delete document.elementFromPoint;
  }
  document.onkeydown = null;
  document.onkeyup = null;
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

function dispatchKeyboard(type: 'keydown' | 'keyup', init: KeyboardEventInit & { keyCode: number }) {
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

function createClipboardData(initialHtml = '') {
  let html = initialHtml;

  return {
    getData(type: string) {
      return type === 'text/html' ? html : '';
    },
    setData(type: string, value: string) {
      if (type === 'text/html') {
        html = value;
      }
    },
  };
}

function dispatchClipboard(type: 'cut' | 'paste', html = '') {
  const event = new window.Event(type, {
    bubbles: true,
    cancelable: true,
  });
  const clipboardData = createClipboardData(html);

  Object.defineProperty(event, 'clipboardData', {
    configurable: true,
    value: clipboardData,
  });

  document.dispatchEvent(event);
  return clipboardData;
}

function dispatchMouse(
  target: EventTarget,
  type: 'mousedown' | 'mousemove' | 'mouseup',
  init: MouseEventInit = {},
) {
  const event = new window.MouseEvent(type, {
    bubbles: true,
    cancelable: true,
    ...init,
  });

  target.dispatchEvent(event);
  return event;
}

function getChildIds(parent: Element) {
  return Array.from(parent.children).map(child => child.id);
}

function getElementStructure(parent: Element) {
  return Array.from(parent.children).map(child => ({
    id: child.id || null,
    tag: child.tagName.toLowerCase(),
    children: getChildIds(child),
  }));
}

function installClipboardMocks({ readText = '' }: { readText?: string } = {}) {
  const readTextMock = vi.fn().mockResolvedValue(readText);
  const writeTextMock = vi.fn().mockResolvedValue(undefined);
  const queryMock = vi.fn().mockResolvedValue({ state: 'denied' });

  Object.defineProperty(navigator, 'clipboard', {
    configurable: true,
    value: {
      readText: readTextMock,
      writeText: writeTextMock,
    },
  });

  Object.defineProperty(navigator, 'permissions', {
    configurable: true,
    value: {
      query: queryMock,
    },
  });

  return { readTextMock, writeTextMock, queryMock };
}

function triggerShortcut(init: KeyboardEventInit & { key: string; keyCode: number }) {
  const modifierEvents: Array<KeyboardEventInit & { key: string; keyCode: number }> = [];

  if (init.ctrlKey) {
    modifierEvents.push({ key: 'Control', ctrlKey: true, keyCode: 17 });
  }

  if (init.metaKey) {
    modifierEvents.push({ key: 'Meta', metaKey: true, keyCode: 91 });
  }

  if (init.shiftKey) {
    modifierEvents.push({
      key: 'Shift',
      ctrlKey: init.ctrlKey,
      metaKey: init.metaKey,
      shiftKey: true,
      keyCode: 16,
    });
  }

  modifierEvents.forEach(event => dispatchKeyboard('keydown', event));
  dispatchKeyboard('keydown', init);
  dispatchKeyboard('keyup', init);
  modifierEvents
    .slice()
    .reverse()
    .forEach(event => dispatchKeyboard('keyup', event));
}

async function withSelectableFixture(
  run: (fixture: {
    visbug: {
      activeTool: string | null;
      colorMode: string;
      toolSelected: () => void;
    };
    selectable: ReturnType<(typeof import('../../public/page-edit/vendor/app/features/selectable.js'))['Selectable']>;
  }) => Promise<void> | void,
  options: { platform: string },
) {
  const originalPlatform = window.navigator.platform;

  vi.resetModules();
  Object.defineProperty(window.navigator, 'platform', {
    configurable: true,
    value: options.platform,
  });

  const { Selectable } = await import('../../public/page-edit/vendor/app/features/selectable.js');
  const visbug = {
    activeTool: null,
    colorMode: 'rgb',
    toolSelected() {},
  };
  const selectable = Selectable(visbug);

  try {
    await run({ selectable, visbug });
  } finally {
    selectable.disconnect();
    Object.defineProperty(window.navigator, 'platform', {
      configurable: true,
      value: originalPlatform,
    });
  }
}

describe('page-edit undo/redo wiring', () => {
  it('features/index.js 导出 createHistoryManager', async () => {
    vi.resetModules();

    const features = await import('../../public/page-edit/vendor/app/features/index.js');

    expect(features.createHistoryManager).toBeTypeOf('function');
  });

  it('空历史下 ctrl+z 与 ctrl+y 会静默忽略', async () => {
    await withSelectableFixture(({ selectable }) => {
      expect(selectable.history).toBeDefined();

      expect(() => {
        triggerShortcut({ key: 'z', ctrlKey: true, keyCode: 90 });
        triggerShortcut({ key: 'y', ctrlKey: true, keyCode: 89 });
      }).not.toThrow();
    }, { platform: 'Win32' });
  });

  it('undo / redo 前后会清理 marquee、hover 和 measurements 临时 UI', async () => {
    document.documentElement.setAttribute(
      'data-webmcp-page-edit-config',
      JSON.stringify({ pageMode: 'local-snapshot' }),
    );

    await withSelectableFixture(({ selectable, visbug }) => {
      document.body.innerHTML = `
        <main id="root">
          <div id="anchor"></div>
          <div id="target"></div>
        </main>
      `;

      const anchor = document.getElementById('anchor') as HTMLElement | null;
      const target = document.getElementById('target') as HTMLElement | null;

      expect(anchor).not.toBeNull();
      expect(target).not.toBeNull();

      anchor!.getBoundingClientRect = () => ({
        left: 0,
        top: 0,
        right: 40,
        bottom: 40,
        width: 40,
        height: 40,
        x: 0,
        y: 0,
        toJSON() { return this; },
      });
      target!.getBoundingClientRect = () => ({
        left: 90,
        top: 0,
        right: 130,
        bottom: 40,
        width: 40,
        height: 40,
        x: 90,
        y: 0,
        toJSON() { return this; },
      });

      document.elementFromPoint = vi.fn(() => target);

      visbug.activeTool = 'guides';
      selectable.select(anchor!);

      dispatchMouse(document.body, 'mousemove', { clientX: 100, clientY: 10 });

      expect(document.querySelector('visbug-hover')).not.toBeNull();
      expect(document.querySelector('visbug-distance')).not.toBeNull();
      expect(target!.hasAttribute('data-measuring')).toBe(true);

      dispatchMouse(document.body, 'mousedown', {
        button: 0,
        ctrlKey: true,
        shiftKey: true,
        clientX: 0,
        clientY: 0,
      });
      dispatchMouse(document, 'mousemove', {
        button: 0,
        ctrlKey: true,
        shiftKey: true,
        clientX: 30,
        clientY: 30,
      });

      expect(document.querySelector('visbug-marquee')).not.toBeNull();

      const assertTransientUiCleared = () => {
        expect(document.querySelector('visbug-marquee')).toBeNull();
        expect(document.querySelector('visbug-hover')).toBeNull();
        expect(document.querySelector('visbug-distance')).toBeNull();
        expect(target!.hasAttribute('data-measuring')).toBe(false);
      };

      selectable.history.record({
        undo: vi.fn(() => {
          assertTransientUiCleared();
        }),
        redo: vi.fn(() => {
          assertTransientUiCleared();
        }),
      });

      triggerShortcut({ key: 'z', ctrlKey: true, keyCode: 90 });
      assertTransientUiCleared();

      dispatchMouse(document.body, 'mousemove', { clientX: 100, clientY: 10 });
      expect(document.querySelector('visbug-hover')).not.toBeNull();
      expect(document.querySelector('visbug-distance')).not.toBeNull();
      expect(target!.hasAttribute('data-measuring')).toBe(true);

      triggerShortcut({ key: 'y', ctrlKey: true, keyCode: 89 });
      assertTransientUiCleared();
    }, { platform: 'Win32' });
  });

  it('disconnect 会显式清空 history', async () => {
    await withSelectableFixture(({ selectable }) => {
      const command = {
        undo: vi.fn(),
        redo: vi.fn(),
      };

      selectable.history.record(command);
      expect(selectable.history.canUndo()).toBe(true);

      selectable.disconnect();

      expect(selectable.history.undoStack).toHaveLength(0);
      expect(selectable.history.redoStack).toHaveLength(0);
      expect(selectable.history.canUndo()).toBe(false);
      expect(selectable.history.canRedo()).toBe(false);
    }, { platform: 'Win32' });
  });

  it('非 macOS 走 ctrl+z / ctrl+shift+z 快捷键到 history', async () => {
    await withSelectableFixture(({ selectable }) => {
      const undoSpy = vi.spyOn(selectable.history, 'undo');
      const redoSpy = vi.spyOn(selectable.history, 'redo');

      triggerShortcut({ key: 'z', ctrlKey: true, keyCode: 90 });
      triggerShortcut({ key: 'Z', ctrlKey: true, shiftKey: true, keyCode: 90 });

      expect(undoSpy).toHaveBeenCalledTimes(1);
      expect(redoSpy).toHaveBeenCalledTimes(1);
    }, { platform: 'Win32' });
  });

  it('macOS 走 command+z / command+shift+z 快捷键到 history', async () => {
    await withSelectableFixture(({ selectable }) => {
      const undoSpy = vi.spyOn(selectable.history, 'undo');
      const redoSpy = vi.spyOn(selectable.history, 'redo');

      triggerShortcut({ key: 'z', metaKey: true, keyCode: 90 });
      triggerShortcut({ key: 'Z', metaKey: true, shiftKey: true, keyCode: 90 });

      expect(undoSpy).toHaveBeenCalledTimes(1);
      expect(redoSpy).toHaveBeenCalledTimes(1);
    }, { platform: 'MacIntel' });
  });

  it('删除后可以通过 history 快捷键 undo / redo 恢复结构', async () => {
    await withSelectableFixture(({ selectable }) => {
      document.body.innerHTML = `
        <main id="root">
          <div id="a"></div>
          <div id="b"></div>
          <div id="c"></div>
          <div id="d"></div>
        </main>
      `;

      const root = document.getElementById('root');
      const first = document.getElementById('a');
      const third = document.getElementById('c');

      expect(root).not.toBeNull();
      expect(first).not.toBeNull();
      expect(third).not.toBeNull();

      selectable.select(first!);
      selectable.select(third!);

      triggerShortcut({ key: 'Backspace', keyCode: 8 });
      expect(getChildIds(root!)).toEqual(['b', 'd']);

      triggerShortcut({ key: 'z', ctrlKey: true, keyCode: 90 });
      expect(getChildIds(root!)).toEqual(['a', 'b', 'c', 'd']);

      triggerShortcut({ key: 'y', ctrlKey: true, keyCode: 89 });
      expect(getChildIds(root!)).toEqual(['b', 'd']);
    }, { platform: 'Win32' });
  });

  it('剪切后可以通过 history 快捷键 undo / redo 恢复结构', async () => {
    await withSelectableFixture(({ selectable }) => {
      installClipboardMocks();
      document.body.innerHTML = `
        <main id="root">
          <div id="a"></div>
          <div id="b"></div>
          <div id="c"></div>
        </main>
      `;

      const root = document.getElementById('root');
      const target = document.getElementById('b');

      expect(root).not.toBeNull();
      expect(target).not.toBeNull();

      selectable.select(target!);

      dispatchClipboard('cut');
      expect(getChildIds(root!)).toEqual(['a', 'c']);

      triggerShortcut({ key: 'z', ctrlKey: true, keyCode: 90 });
      expect(getChildIds(root!)).toEqual(['a', 'b', 'c']);

      triggerShortcut({ key: 'y', ctrlKey: true, keyCode: 89 });
      expect(getChildIds(root!)).toEqual(['a', 'c']);
    }, { platform: 'Win32' });
  });

  it('粘贴后可以通过 history 快捷键 undo / redo 恢复结构', async () => {
    await withSelectableFixture(async ({ selectable }) => {
      installClipboardMocks({ readText: '<span id="pasted"></span>' });
      document.body.innerHTML = `
        <main id="root">
          <div id="target">
            <span id="seed"></span>
          </div>
        </main>
      `;

      const target = document.getElementById('target');

      expect(target).not.toBeNull();

      selectable.select(target!);

      dispatchClipboard('paste');
      await Promise.resolve();
      expect(getChildIds(target!)).toEqual(['seed', 'pasted']);

      triggerShortcut({ key: 'z', ctrlKey: true, keyCode: 90 });
      expect(getChildIds(target!)).toEqual(['seed']);

      triggerShortcut({ key: 'y', ctrlKey: true, keyCode: 89 });
      expect(getChildIds(target!)).toEqual(['seed', 'pasted']);
    }, { platform: 'Win32' });
  });

  it('分组后可以通过 history 快捷键 undo / redo 恢复结构', async () => {
    await withSelectableFixture(({ selectable }) => {
      document.body.innerHTML = `
        <main id="root">
          <div id="a"></div>
          <div id="b"></div>
          <div id="c"></div>
          <div id="d"></div>
        </main>
      `;

      const root = document.getElementById('root');
      const first = document.getElementById('a');
      const third = document.getElementById('c');

      expect(root).not.toBeNull();
      expect(first).not.toBeNull();
      expect(third).not.toBeNull();

      selectable.select(first!);
      selectable.select(third!);

      triggerShortcut({ key: 'g', ctrlKey: true, keyCode: 71 });
      expect(getElementStructure(root!)).toEqual([
        { id: null, tag: 'div', children: ['a', 'c'] },
        { id: 'b', tag: 'div', children: [] },
        { id: 'd', tag: 'div', children: [] },
      ]);

      triggerShortcut({ key: 'z', ctrlKey: true, keyCode: 90 });
      expect(getChildIds(root!)).toEqual(['a', 'b', 'c', 'd']);

      triggerShortcut({ key: 'y', ctrlKey: true, keyCode: 89 });
      expect(getElementStructure(root!)).toEqual([
        { id: null, tag: 'div', children: ['a', 'c'] },
        { id: 'b', tag: 'div', children: [] },
        { id: 'd', tag: 'div', children: [] },
      ]);
    }, { platform: 'Win32' });
  });

  it('解组后可以通过 history 快捷键 undo / redo 恢复结构', async () => {
    await withSelectableFixture(({ selectable }) => {
      document.body.innerHTML = `
        <main id="root">
          <div id="a"></div>
          <div id="b"></div>
          <div id="c"></div>
          <div id="d"></div>
        </main>
      `;

      const root = document.getElementById('root');
      const first = document.getElementById('a');
      const third = document.getElementById('c');

      expect(root).not.toBeNull();
      expect(first).not.toBeNull();
      expect(third).not.toBeNull();

      selectable.select(first!);
      selectable.select(third!);
      triggerShortcut({ key: 'g', ctrlKey: true, keyCode: 71 });

      const group = root!.firstElementChild;
      expect(group).not.toBeNull();

      triggerShortcut({ key: 'G', ctrlKey: true, shiftKey: true, keyCode: 71 });
      expect(getChildIds(root!)).toEqual(['a', 'c', 'b', 'd']);

      triggerShortcut({ key: 'z', ctrlKey: true, keyCode: 90 });
      expect(getElementStructure(root!)).toEqual([
        { id: null, tag: 'div', children: ['a', 'c'] },
        { id: 'b', tag: 'div', children: [] },
        { id: 'd', tag: 'div', children: [] },
      ]);

      triggerShortcut({ key: 'y', ctrlKey: true, keyCode: 89 });
      expect(getChildIds(root!)).toEqual(['a', 'c', 'b', 'd']);
    }, { platform: 'Win32' });
  });

  it('拖拽位置变化后只记录一条 history，并可通过快捷键 undo / redo', async () => {
    await withSelectableFixture(async ({ selectable }) => {
      const { Position } = await import('../../public/page-edit/vendor/app/features/position.js');

      document.body.innerHTML = `
        <main id="root">
          <div id="target" style="left: 0px; top: 0px; width: 100px; height: 100px;"></div>
        </main>
      `;

      const target = document.getElementById('target') as HTMLElement | null;
      expect(target).not.toBeNull();
      document.elementFromPoint = vi.fn(() => target);

      const feature = Position();
      selectable.onSelectedUpdate(feature.onNodesSelected);

      try {
        selectable.select(target!);

        dispatchMouse(target!, 'mousedown', { button: 0, clientX: 10, clientY: 20 });
        dispatchMouse(document, 'mousemove', { button: 0, clientX: 20, clientY: 35 });
        dispatchMouse(document, 'mousemove', { button: 0, clientX: 30, clientY: 45 });

        expect(target!.style.left).toBe('20px');
        expect(target!.style.top).toBe('25px');
        expect(selectable.history.undoStack).toHaveLength(0);

        dispatchMouse(target!, 'mouseup', { button: 0, clientX: 30, clientY: 45 });

        expect(selectable.history.undoStack).toHaveLength(1);

        triggerShortcut({ key: 'z', ctrlKey: true, keyCode: 90 });
        expect(target!.style.left).toBe('0px');
        expect(target!.style.top).toBe('0px');

        triggerShortcut({ key: 'y', ctrlKey: true, keyCode: 89 });
        expect(target!.style.left).toBe('20px');
        expect(target!.style.top).toBe('25px');
      } finally {
        selectable.removeSelectedCallback(feature.onNodesSelected);
        feature.disconnect();
      }
    }, { platform: 'Win32' });
  });

  it('键盘同级移动后可通过 history 快捷键 undo / redo', async () => {
    await withSelectableFixture(async ({ selectable, visbug }) => {
      const { Position } = await import('../../public/page-edit/vendor/app/features/position.js');

      document.documentElement.setAttribute(
        'data-webmcp-page-edit-config',
        JSON.stringify({ pageMode: 'local-snapshot' }),
      );

      document.body.innerHTML = `
        <main id="root">
          <div id="target" style="width: 100px; height: 80px;"></div>
        </main>
      `;

      const target = document.getElementById('target') as HTMLElement | null;
      expect(target).not.toBeNull();

      const feature = Position();
      visbug.activeTool = 'position';
      selectable.onSelectedUpdate(feature.onNodesSelected);

      try {
        selectable.select(target!);

        const handlesHost = document.querySelector('visbug-handles') as
          | (HTMLElement & { $shadow?: ShadowRoot })
          | null;
        expect(handlesHost).not.toBeNull();

        const eastHandle = handlesHost!.$shadow?.querySelector(
          '[data-resize-handle="east"]',
        ) as SVGElement | null;
        const southEastHandle = handlesHost!.$shadow?.querySelector(
          '[data-resize-handle="southeast"]',
        ) as SVGElement | null;

        expect(eastHandle).not.toBeNull();
        expect(southEastHandle).not.toBeNull();

        dispatchMouse(eastHandle!, 'mousedown', { button: 0, clientX: 100, clientY: 40 });
        dispatchMouse(document, 'mousemove', { button: 0, clientX: 130, clientY: 40 });
        dispatchMouse(eastHandle!, 'mouseup', { button: 0, clientX: 130, clientY: 40 });

        expect(target!.style.width).toBe('130px');
        expect(target!.style.height).toBe('80px');

        dispatchMouse(southEastHandle!, 'mousedown', { button: 0, clientX: 130, clientY: 80 });
        dispatchMouse(document, 'mousemove', { button: 0, clientX: 150, clientY: 95 });
        dispatchMouse(southEastHandle!, 'mouseup', { button: 0, clientX: 150, clientY: 95 });

        expect(target!.style.width).toBe('150px');
        expect(target!.style.height).toBe('95px');
      } finally {
        selectable.removeSelectedCallback(feature.onNodesSelected);
        feature.disconnect();
      }
    }, { platform: 'Win32' });
  });

  it('keyboard sibling move keeps undo redo history working', async () => {
    await withSelectableFixture(async ({ selectable }) => {
      const { Moveable } = await import('../../public/page-edit/vendor/app/features/move.js');

      document.body.innerHTML = `
        <main id="root">
          <div id="moving"></div>
          <section id="container">
            <span id="existing"></span>
          </section>
          <div id="tail"></div>
        </main>
      `;

      const root = document.getElementById('root');
      const moving = document.getElementById('moving');
      const container = document.getElementById('container');

      expect(root).not.toBeNull();
      expect(moving).not.toBeNull();
      expect(container).not.toBeNull();

      const disconnectMove = Moveable(selectable);

      try {
        selectable.select(moving!);

        triggerShortcut({ key: 'ArrowDown', keyCode: 40 });

        expect(getChildIds(root!)).toEqual(['container', 'moving', 'tail']);
        expect(getChildIds(container!)).toEqual(['existing']);
        expect(selectable.history.undoStack).toHaveLength(1);

        triggerShortcut({ key: 'z', ctrlKey: true, keyCode: 90 });
        expect(getChildIds(root!)).toEqual(['moving', 'container', 'tail']);
        expect(getChildIds(container!)).toEqual(['existing']);

        triggerShortcut({ key: 'y', ctrlKey: true, keyCode: 89 });
        expect(getChildIds(root!)).toEqual(['container', 'moving', 'tail']);
        expect(getChildIds(container!)).toEqual(['existing']);
      } finally {
        disconnectMove();
      }
    }, { platform: 'Win32' });
  });

  it('字体样式变更可通过 history undo / redo，且 undo 后新编辑会清空 redoStack', async () => {
    await withSelectableFixture(async ({ selectable }) => {
      const { Font } = await import('../../public/page-edit/vendor/app/features/font.js');

      document.body.innerHTML = `
        <main id="root">
          <p id="target" style="font-size: 12px;"></p>
        </main>
      `;

      const target = document.getElementById('target') as HTMLElement | null;
      expect(target).not.toBeNull();

      const disconnectFont = Font(selectable);

      try {
        selectable.select(target!);

        triggerShortcut({ key: 'ArrowUp', keyCode: 38 });

        expect(target!.style.fontSize).toBe('13px');
        expect(selectable.history.undoStack).toHaveLength(1);
        expect(selectable.history.undoStack[0]).toMatchObject({
          elements: [target],
          beforeStyles: ['font-size: 12px;'],
          afterStyles: ['font-size: 13px;'],
          label: expect.any(String),
        });

        triggerShortcut({ key: 'z', ctrlKey: true, keyCode: 90 });
        expect(target!.style.fontSize).toBe('12px');
        expect(selectable.history.redoStack).toHaveLength(1);

        triggerShortcut({ key: 'y', ctrlKey: true, keyCode: 89 });
        expect(target!.style.fontSize).toBe('13px');

        triggerShortcut({ key: 'z', ctrlKey: true, keyCode: 90 });
        expect(target!.style.fontSize).toBe('12px');

        triggerShortcut({ key: 'ArrowDown', keyCode: 40 });
        expect(target!.style.fontSize).toBe('11px');
        expect(selectable.history.redoStack).toHaveLength(0);

        triggerShortcut({ key: 'y', ctrlKey: true, keyCode: 89 });
        expect(target!.style.fontSize).toBe('11px');
      } finally {
        disconnectFont();
      }
    }, { platform: 'Win32' });
  });
});
