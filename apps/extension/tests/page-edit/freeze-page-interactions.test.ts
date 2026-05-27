// @vitest-environment node

import { JSDOM } from 'jsdom';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

let dom: JSDOM;
let previousGlobals: Record<string, unknown>;
let previousElementFromPoint: Document['elementFromPoint'] | undefined;

const baseFixture = `
  <section id="app-shell">
    <button id="open-picker">打开面板</button>
    <div id="target">可选内容</div>
  </section>
`;

beforeAll(() => {
  dom = new JSDOM(`<!doctype html><html><body>${baseFixture}</body></html>`, {
    url: 'https://example.com/',
  });

  previousGlobals = {
    window: globalThis.window,
    document: globalThis.document,
    customElements: globalThis.customElements,
    HTMLElement: globalThis.HTMLElement,
    SVGElement: globalThis.SVGElement,
    Element: globalThis.Element,
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

  Object.assign(globalThis, {
    window: dom.window,
    document: dom.window.document,
    customElements: dom.window.customElements,
    HTMLElement: dom.window.HTMLElement,
    SVGElement: dom.window.SVGElement,
    Element: dom.window.Element,
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

  previousElementFromPoint = document.elementFromPoint?.bind(document);
});

beforeEach(() => {
  document.body.innerHTML = baseFixture;
  document.elementFromPoint = () => null;
});

afterEach(() => {
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

function dispatchMouse(
  target: EventTarget,
  type: 'mousedown' | 'mouseup' | 'click' | 'dblclick',
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

function dispatchKeyboard(
  target: EventTarget,
  type: 'keydown' | 'keyup',
  init: KeyboardEventInit & { keyCode: number },
) {
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

  target.dispatchEvent(event);
  return event;
}

function addDelegatedBusinessListener(
  type: 'click' | 'dblclick' | 'keydown',
  predicate: (event: Event) => boolean,
  spy: ReturnType<typeof vi.fn>,
) {
  const handler = (event: Event) => {
    if (predicate(event)) {
      spy(event);
    }
  };

  document.body.addEventListener(type, handler);
  return () => document.body.removeEventListener(type, handler);
}

async function withSelectableFixture(
  run: (fixture: {
    selectable: ReturnType<(typeof import('../../public/page-edit/vendor/app/features/selectable.js'))['Selectable']>;
  }) => Promise<void> | void,
  options: { platform?: string; activeTool?: string | null } = {},
) {
  const originalPlatform = window.navigator.platform;
  const platform = options.platform ?? originalPlatform;

  vi.resetModules();
  Object.defineProperty(window.navigator, 'platform', {
    configurable: true,
    value: platform,
  });

  await import('../../public/page-edit/vendor/app/components/selection/label.element.js');
  const { Selectable } = await import('../../public/page-edit/vendor/app/features/selectable.js');
  const selectable = Selectable({
    activeTool: options.activeTool ?? 'inspector',
    colorMode: 'rgb',
    toolSelected() {},
  });

  try {
    await run({ selectable });
  } finally {
    selectable.disconnect();
    Object.defineProperty(window.navigator, 'platform', {
      configurable: true,
      value: originalPlatform,
    });
  }
}

describe('page-edit freeze page interactions', () => {
  it('blocks page business click handlers while editing', async () => {
    const clickSpy = vi.fn();
    const button = document.getElementById('open-picker') as HTMLButtonElement;
    const removeListener = addDelegatedBusinessListener(
      'click',
      event =>
        document.elementFromPoint((event as MouseEvent).clientX, (event as MouseEvent).clientY) ===
        button,
      clickSpy,
    );

    try {
      document.elementFromPoint = () => button;

      await withSelectableFixture(() => {
        dispatchMouse(document.body, 'click', {
          button: 0,
          clientX: 20,
          clientY: 20,
        });
      });

      expect(clickSpy).not.toHaveBeenCalled();
    } finally {
      removeListener();
    }
  });

  it('blocks page business double click handlers while editing', async () => {
    const dblClickSpy = vi.fn();
    const target = document.getElementById('target') as HTMLDivElement;
    const removeListener = addDelegatedBusinessListener(
      'dblclick',
      event =>
        document.elementFromPoint((event as MouseEvent).clientX, (event as MouseEvent).clientY) ===
        target,
      dblClickSpy,
    );

    try {
      document.elementFromPoint = () => target;

      await withSelectableFixture(() => {
        dispatchMouse(document.body, 'dblclick', {
          button: 0,
          clientX: 40,
          clientY: 30,
        });
      });

      expect(dblClickSpy).not.toHaveBeenCalled();
    } finally {
      removeListener();
    }
  });

  it('blocks page business keydown handlers while editing', async () => {
    const keydownSpy = vi.fn();
    const removeListener = addDelegatedBusinessListener(
      'keydown',
      event => event.target === document.body,
      keydownSpy,
    );

    try {
      await withSelectableFixture(() => {
        dispatchKeyboard(document.body, 'keydown', {
          key: 'a',
          keyCode: 65,
        });
      });

      expect(keydownSpy).not.toHaveBeenCalled();
    } finally {
      removeListener();
    }
  });

  it('keeps page-edit basic selection working while editing', async () => {
    const target = document.getElementById('target') as HTMLDivElement;
    target.getBoundingClientRect = () =>
      ({
        x: 10,
        y: 10,
        width: 120,
        height: 40,
        top: 10,
        left: 10,
        right: 130,
        bottom: 50,
        toJSON() {},
      }) as DOMRect;
    document.elementFromPoint = () => target;

    await withSelectableFixture(({ selectable }) => {
      dispatchMouse(document.body, 'mousedown', {
        button: 0,
        clientX: 20,
        clientY: 20,
      });
      dispatchMouse(document.body, 'mouseup', {
        button: 0,
        clientX: 20,
        clientY: 20,
      });
      dispatchMouse(document.body, 'click', {
        button: 0,
        clientX: 20,
        clientY: 20,
      });

      expect(selectable.selection().map(element => element.id)).toEqual(['target']);
    });
  });

  it('allows native mousedown for move-mode draggable targets', async () => {
    const target = document.getElementById('target') as HTMLDivElement;
    target.setAttribute('draggable', 'true');
    target.getBoundingClientRect = () =>
      ({
        x: 10,
        y: 10,
        width: 120,
        height: 40,
        top: 10,
        left: 10,
        right: 130,
        bottom: 50,
        toJSON() {},
      }) as DOMRect;
    document.elementFromPoint = () => target;

    await withSelectableFixture(({ selectable }) => {
      selectable.select(target);

      const event = dispatchMouse(document.body, 'mousedown', {
        button: 0,
        clientX: 20,
        clientY: 20,
      });

      expect(event.defaultPrevented).toBe(false);
    }, { activeTool: 'move' });
  });
});
