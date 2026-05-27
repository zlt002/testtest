// @vitest-environment node

import { JSDOM } from 'jsdom';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import {
  buildMarqueeRect,
  didMovePastThreshold,
  filterIntersectingElements,
  rectsIntersect,
  shouldStartIntersectionMarquee,
} from '../../public/page-edit/vendor/app/features/intersection-marquee.js';

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
  });

  previousElementFromPoint = document.elementFromPoint?.bind(document);
});

afterEach(() => {
  document.body.innerHTML = '';
  if (previousElementFromPoint) {
    document.elementFromPoint = previousElementFromPoint;
  } else {
    // jsdom 默认没有实现 elementFromPoint，这里避免用例之间互相污染 stub。
    delete document.elementFromPoint;
  }
  document.onkeydown = null;
  document.onkeyup = null;
});

afterAll(() => {
  dom.window.close();
  Object.assign(globalThis, previousGlobals);
});

async function withSelectableFixture(run: (fixture: {
  selectable: ReturnType<(typeof import('../../public/page-edit/vendor/app/features/selectable.js'))['Selectable']>;
}) => Promise<void> | void, options: { platform?: string; activeTool?: string | null } = {}) {
  const originalPlatform = window.navigator.platform;
  const platform = options.platform ?? originalPlatform;

  vi.resetModules();
  Object.defineProperty(window.navigator, 'platform', {
    configurable: true,
    value: platform,
  });

  const { Selectable } = await import('../../public/page-edit/vendor/app/features/selectable.js');
  await import('../../public/page-edit/vendor/app/components/selection/marquee.element.js');

  const selectable = Selectable({
    activeTool: options.activeTool ?? null,
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

function dispatchMouse(
  target: EventTarget,
  type: 'mousedown' | 'mousemove' | 'mouseup' | 'click',
  init: MouseEventInit,
) {
  target.dispatchEvent(
    new window.MouseEvent(type, {
      bubbles: true,
      ...init,
    }),
  );
}

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

  modifierEvents.forEach((event) => dispatchKeyboard('keydown', event));
  dispatchKeyboard('keydown', init);
  dispatchKeyboard('keyup', init);
  modifierEvents
    .slice()
    .reverse()
    .forEach((event) => dispatchKeyboard('keyup', event));
}

describe('intersection marquee helpers', () => {
  it('normalizes marquee rectangles for any drag direction', () => {
    expect(buildMarqueeRect({ x: 10, y: 20 }, { x: 40, y: 70 })).toEqual({
      left: 10,
      top: 20,
      right: 40,
      bottom: 70,
      width: 30,
      height: 50,
    });

    expect(buildMarqueeRect({ x: 40, y: 70 }, { x: 10, y: 20 })).toEqual({
      left: 10,
      top: 20,
      right: 40,
      bottom: 70,
      width: 30,
      height: 50,
    });

    expect(buildMarqueeRect({ x: 40, y: 20 }, { x: 10, y: 70 })).toEqual({
      left: 10,
      top: 20,
      right: 40,
      bottom: 70,
      width: 30,
      height: 50,
    });

    expect(buildMarqueeRect({ x: 10, y: 70 }, { x: 40, y: 20 })).toEqual({
      left: 10,
      top: 20,
      right: 40,
      bottom: 70,
      width: 30,
      height: 50,
    });
  });

  it('treats touching edges as intersections', () => {
    expect(
      rectsIntersect(
        { left: 0, top: 0, right: 10, bottom: 10 },
        { left: 10, top: 10, right: 20, bottom: 20 },
      ),
    ).toBe(true);

    expect(
      rectsIntersect(
        { left: 0, top: 0, right: 10, bottom: 10 },
        { left: 11, top: 11, right: 20, bottom: 20 },
      ),
    ).toBe(false);
  });

  it('keeps only intersecting elements from the provided selected set', () => {
    const hit = {
      id: 'hit',
      getBoundingClientRect: () => ({ left: 5, top: 5, right: 15, bottom: 15 }),
    };
    const touch = {
      id: 'touch',
      getBoundingClientRect: () => ({ left: 20, top: 0, right: 30, bottom: 10 }),
    };
    const miss = {
      id: 'miss',
      getBoundingClientRect: () => ({ left: 31, top: 0, right: 40, bottom: 10 }),
    };
    const invalid = { id: 'invalid' };

    const result = filterIntersectingElements([hit, touch, miss, invalid], {
      left: 10,
      top: 0,
      right: 20,
      bottom: 20,
    });

    expect(result).toEqual([hit, touch]);
  });

  it('starts only for ctrl+shift+left button with existing selection and in-bounds target', () => {
    expect(
      shouldStartIntersectionMarquee({
        button: 0,
        primaryModifierKey: true,
        shiftKey: true,
        selectedCount: 1,
        isOffBoundsTarget: false,
      }),
    ).toBe(true);

    expect(
      shouldStartIntersectionMarquee({
        button: 1,
        primaryModifierKey: true,
        shiftKey: true,
        selectedCount: 1,
        isOffBoundsTarget: false,
      }),
    ).toBe(false);

    expect(
      shouldStartIntersectionMarquee({
        button: 0,
        primaryModifierKey: false,
        shiftKey: true,
        selectedCount: 1,
        isOffBoundsTarget: false,
      }),
    ).toBe(false);

    expect(
      shouldStartIntersectionMarquee({
        button: 0,
        primaryModifierKey: true,
        shiftKey: false,
        selectedCount: 1,
        isOffBoundsTarget: false,
      }),
    ).toBe(false);

    expect(
      shouldStartIntersectionMarquee({
        button: 0,
        primaryModifierKey: true,
        shiftKey: true,
        selectedCount: 0,
        isOffBoundsTarget: false,
      }),
    ).toBe(false);

    expect(
      shouldStartIntersectionMarquee({
        button: 0,
        primaryModifierKey: true,
        shiftKey: true,
        selectedCount: 1,
        isOffBoundsTarget: true,
      }),
    ).toBe(false);
  });

  it('checks drag distance against the movement threshold', () => {
    expect(
      didMovePastThreshold({ x: 0, y: 0 }, { x: 6, y: 0 }),
    ).toBe(true);

    expect(
      didMovePastThreshold({ x: 0, y: 0 }, { x: 5, y: 0 }),
    ).toBe(false);

    expect(
      didMovePastThreshold({ x: 0, y: 0 }, { x: 6, y: 1 }),
    ).toBe(true);

    expect(
      didMovePastThreshold({ x: 0, y: 0 }, { x: 2, y: 2 }, 2),
    ).toBe(true);
  });
});

describe('visbug-marquee component', () => {
  it('registers the custom element', async () => {
    await import('../../public/page-edit/vendor/app/components/selection/marquee.element.js');

    expect(customElements.get('visbug-marquee')).toBeTypeOf('function');
  });

  it('updates public position state and host sizing styles after calling position', async () => {
    const { Marquee } = await import('../../public/page-edit/vendor/app/components/selection/marquee.element.js');

    const marquee = new Marquee();
    document.body.appendChild(marquee);

    marquee.position = {
      top: 24,
      left: 16,
      width: 120,
      height: 80,
    };

    expect(marquee.position).toEqual({
      top: 24,
      left: 16,
      width: 120,
      height: 80,
    });
    expect('renderVersion' in marquee).toBe(false);
    expect(marquee.style.getPropertyValue('--left')).toBe('16px');
    expect(marquee.style.getPropertyValue('--top')).toBe('24px');
    expect(marquee.style.getPropertyValue('--width')).toBe('120px');
    expect(marquee.style.getPropertyValue('--height')).toBe('80px');
    expect(marquee.getAttribute('width')).toBe('120');
    expect(marquee.getAttribute('height')).toBe('80');
    expect(marquee.ready).toBe(true);
  });

  it('reuses the initialized overlay state across subsequent position updates', async () => {
    const { Marquee } = await import('../../public/page-edit/vendor/app/components/selection/marquee.element.js');

    const marquee = new Marquee();
    document.body.appendChild(marquee);

    marquee.position = {
      top: 10,
      left: 12,
      width: 60,
      height: 40,
    };

    expect(() => {
      marquee.position = {
        top: 18,
        left: 20,
        width: 140,
        height: 90,
      };
    }).not.toThrow();

    expect(marquee.position).toEqual({
      top: 18,
      left: 20,
      width: 140,
      height: 90,
    });
    expect(marquee.style.getPropertyValue('--left')).toBe('20px');
    expect(marquee.style.getPropertyValue('--top')).toBe('18px');
    expect(marquee.style.getPropertyValue('--width')).toBe('140px');
    expect(marquee.style.getPropertyValue('--height')).toBe('90px');
    expect(marquee.getAttribute('width')).toBe('140');
    expect(marquee.getAttribute('height')).toBe('90');
  });
});

describe('Selectable intersection marquee', () => {
  it('keeps only selected snapshot hits after mouseup and suppresses the trailing click', async () => {
    await withSelectableFixture(({ selectable }) => {
      const first = document.createElement('div');
      const second = document.createElement('div');
      const extra = document.createElement('div');

      first.id = 'first';
      second.id = 'second';
      extra.id = 'extra';

      first.getBoundingClientRect = () => ({ left: 0, top: 0, right: 40, bottom: 40 });
      second.getBoundingClientRect = () => ({ left: 140, top: 0, right: 180, bottom: 40 });
      extra.getBoundingClientRect = () => ({ left: 50, top: 0, right: 90, bottom: 40 });

      document.body.append(first, second, extra);

      document.elementFromPoint = (x: number) => {
        if (x <= 40) return first;
        if (x <= 100) return extra;
        return second;
      };

      selectable.select(first);
      selectable.select(second);

      dispatchMouse(first, 'mousedown', {
        button: 0,
        ctrlKey: true,
        shiftKey: true,
        clientX: 5,
        clientY: 5,
      });

      dispatchMouse(document.body, 'mousemove', {
        ctrlKey: true,
        shiftKey: true,
        clientX: 100,
        clientY: 40,
      });

      expect(selectable.selection().map((element) => element.id)).toEqual(['second', 'first']);

      dispatchMouse(document.body, 'mouseup', {
        ctrlKey: true,
        shiftKey: true,
        clientX: 100,
        clientY: 40,
      });

      expect(selectable.selection().map((element) => element.id)).toEqual(['first']);

      dispatchMouse(document.body, 'click', {
        button: 0,
        clientX: 100,
        clientY: 40,
      });

      expect(selectable.selection().map((element) => element.id)).toEqual(['first']);
    });
  });

  it('allows the next normal click when a drag commits without any trailing click event', async () => {
    await withSelectableFixture(({ selectable }) => {
      const first = document.createElement('div');
      const second = document.createElement('div');
      const extra = document.createElement('div');

      first.id = 'first';
      second.id = 'second';
      extra.id = 'extra';

      first.getBoundingClientRect = () => ({ left: 0, top: 0, right: 40, bottom: 40 });
      second.getBoundingClientRect = () => ({ left: 140, top: 0, right: 180, bottom: 40 });
      extra.getBoundingClientRect = () => ({ left: 50, top: 0, right: 90, bottom: 40 });

      document.body.append(first, second, extra);

      document.elementFromPoint = (x: number) => {
        if (x <= 40) return first;
        if (x <= 100) return extra;
        return second;
      };

      selectable.select(first);
      selectable.select(second);

      dispatchMouse(first, 'mousedown', {
        button: 0,
        ctrlKey: true,
        shiftKey: true,
        clientX: 5,
        clientY: 5,
      });

      dispatchMouse(document.body, 'mousemove', {
        ctrlKey: true,
        shiftKey: true,
        clientX: 100,
        clientY: 40,
      });

      dispatchMouse(document.body, 'mouseup', {
        ctrlKey: true,
        shiftKey: true,
        clientX: 100,
        clientY: 40,
      });

      expect(selectable.selection().map((element) => element.id)).toEqual(['first']);

      dispatchMouse(document.body, 'mousedown', {
        button: 0,
        clientX: 140,
        clientY: 20,
      });

      dispatchMouse(document.body, 'mouseup', {
        button: 0,
        clientX: 140,
        clientY: 20,
      });

      dispatchMouse(document.body, 'click', {
        button: 0,
        clientX: 140,
        clientY: 20,
      });

      expect(selectable.selection().map((element) => element.id)).toEqual(['second']);
    });
  });

  it('supports command plus shift drag on macOS without ctrl', async () => {
    await withSelectableFixture(({ selectable }) => {
      const first = document.createElement('div');
      const second = document.createElement('div');
      const extra = document.createElement('div');

      first.id = 'first';
      second.id = 'second';
      extra.id = 'extra';

      first.getBoundingClientRect = () => ({ left: 0, top: 0, right: 40, bottom: 40 });
      second.getBoundingClientRect = () => ({ left: 140, top: 0, right: 180, bottom: 40 });
      extra.getBoundingClientRect = () => ({ left: 50, top: 0, right: 90, bottom: 40 });

      document.body.append(first, second, extra);

      document.elementFromPoint = (x: number) => {
        if (x <= 40) return first;
        if (x <= 100) return extra;
        return second;
      };

      selectable.select(first);
      selectable.select(second);

      dispatchMouse(first, 'mousedown', {
        button: 0,
        metaKey: true,
        shiftKey: true,
        clientX: 5,
        clientY: 5,
      });

      dispatchMouse(document.body, 'mousemove', {
        metaKey: true,
        shiftKey: true,
        clientX: 100,
        clientY: 40,
      });

      dispatchMouse(document.body, 'mouseup', {
        metaKey: true,
        shiftKey: true,
        clientX: 100,
        clientY: 40,
      });

      expect(selectable.selection().map((element) => element.id)).toEqual(['first']);
    }, {
      platform: 'MacIntel',
    });
  });

  it('does not suppress click semantics when ctrl+shift never crosses the drag threshold', async () => {
    await withSelectableFixture(({ selectable }) => {
      const first = document.createElement('div');
      const second = document.createElement('div');

      first.id = 'first';
      second.id = 'second';

      first.getBoundingClientRect = () => ({ left: 0, top: 0, right: 40, bottom: 40 });
      second.getBoundingClientRect = () => ({ left: 60, top: 0, right: 100, bottom: 40 });

      document.body.append(first, second);

      document.elementFromPoint = (x: number) => (x <= 40 ? first : second);

      selectable.select(first);
      selectable.select(second);

      dispatchMouse(first, 'mousedown', {
        button: 0,
        ctrlKey: true,
        shiftKey: true,
        clientX: 5,
        clientY: 5,
      });

      dispatchMouse(document.body, 'mouseup', {
        ctrlKey: true,
        shiftKey: true,
        button: 0,
        clientX: 5,
        clientY: 5,
      });

      expect(selectable.selection().map((element) => element.id)).toEqual(['second', 'first']);

      dispatchMouse(document.body, 'mousedown', {
        button: 0,
        clientX: 80,
        clientY: 5,
      });

      dispatchMouse(document.body, 'mouseup', {
        button: 0,
        clientX: 80,
        clientY: 5,
      });

      dispatchMouse(document.body, 'click', {
        button: 0,
        clientX: 80,
        clientY: 5,
      });

      expect(selectable.selection().map((element) => element.id)).toEqual(['second']);
    });
  });

  it('cancels the marquee when ctrl or shift is released before dragging and preserves later click semantics', async () => {
    await withSelectableFixture(({ selectable }) => {
      const first = document.createElement('div');
      const second = document.createElement('div');

      first.id = 'first';
      second.id = 'second';

      first.getBoundingClientRect = () => ({ left: 0, top: 0, right: 40, bottom: 40 });
      second.getBoundingClientRect = () => ({ left: 60, top: 0, right: 100, bottom: 40 });

      document.body.append(first, second);

      document.elementFromPoint = (x: number) => (x <= 40 ? first : second);

      selectable.select(first);
      selectable.select(second);

      dispatchMouse(first, 'mousedown', {
        button: 0,
        ctrlKey: true,
        shiftKey: true,
        clientX: 5,
        clientY: 5,
      });

      dispatchMouse(document.body, 'mousemove', {
        ctrlKey: true,
        shiftKey: true,
        clientX: 8,
        clientY: 8,
      });

      dispatchMouse(document.body, 'mousemove', {
        ctrlKey: true,
        shiftKey: false,
        clientX: 8,
        clientY: 8,
      });

      dispatchMouse(document.body, 'mouseup', {
        ctrlKey: true,
        shiftKey: false,
        button: 0,
        clientX: 8,
        clientY: 8,
      });

      expect(selectable.selection().map((element) => element.id)).toEqual(['second', 'first']);
      expect(document.querySelector('visbug-marquee')).toBeNull();

      dispatchMouse(document.body, 'mousedown', {
        button: 0,
        clientX: 80,
        clientY: 5,
      });

      dispatchMouse(document.body, 'mouseup', {
        button: 0,
        clientX: 80,
        clientY: 5,
      });

      dispatchMouse(document.body, 'click', {
        button: 0,
        clientX: 80,
        clientY: 5,
      });

      expect(selectable.selection().map((element) => element.id)).toEqual(['second']);
    });
  });

  it('suppresses the trailing click after a drag-cancel even when mouseup happens at different coordinates, then allows the next normal click', async () => {
    await withSelectableFixture(({ selectable }) => {
      const first = document.createElement('div');
      const second = document.createElement('div');
      const extra = document.createElement('div');

      first.id = 'first';
      second.id = 'second';
      extra.id = 'extra';

      first.getBoundingClientRect = () => ({ left: 0, top: 0, right: 40, bottom: 40 });
      second.getBoundingClientRect = () => ({ left: 140, top: 0, right: 180, bottom: 40 });
      extra.getBoundingClientRect = () => ({ left: 50, top: 0, right: 90, bottom: 40 });

      document.body.append(first, second, extra);

      document.elementFromPoint = (x: number) => {
        if (x <= 40) return first;
        if (x <= 100) return extra;
        return second;
      };

      selectable.select(first);
      selectable.select(second);

      dispatchMouse(first, 'mousedown', {
        button: 0,
        ctrlKey: true,
        shiftKey: true,
        clientX: 5,
        clientY: 5,
      });

      dispatchMouse(document.body, 'mousemove', {
        ctrlKey: true,
        shiftKey: true,
        clientX: 110,
        clientY: 35,
      });

      dispatchMouse(document.body, 'mousemove', {
        ctrlKey: true,
        shiftKey: false,
        clientX: 120,
        clientY: 38,
      });

      dispatchMouse(document.body, 'mouseup', {
        ctrlKey: true,
        shiftKey: false,
        button: 0,
        clientX: 70,
        clientY: 20,
      });

      dispatchMouse(document.body, 'click', {
        button: 0,
        clientX: 70,
        clientY: 20,
      });

      expect(selectable.selection().map((element) => element.id)).toEqual(['second', 'first']);

      dispatchMouse(document.body, 'mousedown', {
        button: 0,
        clientX: 70,
        clientY: 20,
      });

      dispatchMouse(document.body, 'mouseup', {
        button: 0,
        clientX: 70,
        clientY: 20,
      });

      dispatchMouse(document.body, 'click', {
        button: 0,
        clientX: 70,
        clientY: 20,
      });

      expect(selectable.selection().map((element) => element.id)).toEqual(['extra']);
    });
  });

  it('keeps deletion working after class multi-select followed by intersection marquee', async () => {
    await withSelectableFixture(({ selectable }) => {
      document.body.innerHTML = `
        <main id="root">
          <div id="first" class="target">1</div>
          <div id="second" class="target">2</div>
          <div id="third" class="target">3</div>
          <div id="other">4</div>
        </main>
      `;

      const root = document.getElementById('root') as HTMLElement;
      const first = document.getElementById('first') as HTMLElement;
      const second = document.getElementById('second') as HTMLElement;
      const third = document.getElementById('third') as HTMLElement;
      const other = document.getElementById('other') as HTMLElement;

      first.getBoundingClientRect = () => ({ left: 0, top: 100, right: 40, bottom: 140 });
      second.getBoundingClientRect = () => ({ left: 50, top: 100, right: 90, bottom: 140 });
      third.getBoundingClientRect = () => ({ left: 100, top: 100, right: 140, bottom: 140 });
      other.getBoundingClientRect = () => ({ left: 150, top: 100, right: 190, bottom: 140 });

      document.elementFromPoint = (x: number) => {
        if (x <= 40) return first;
        if (x <= 90) return second;
        if (x <= 140) return third;
        return other;
      };

      selectable.select(first);

      const label = document.querySelector('visbug-label') as HTMLElement;
      label.dispatchEvent(
        new window.CustomEvent('query', {
          bubbles: true,
          detail: {
            text: '.target',
            activator: 'click',
          },
        }),
      );

      expect(selectable.selection().map((element) => element.id)).toEqual([
        'third',
        'second',
        'first',
      ]);

      dispatchMouse(first, 'mousedown', {
        button: 0,
        ctrlKey: true,
        shiftKey: true,
        clientX: 5,
        clientY: 105,
      });

      dispatchMouse(document.body, 'mousemove', {
        ctrlKey: true,
        shiftKey: true,
        clientX: 90,
        clientY: 140,
      });

      dispatchMouse(document.body, 'mouseup', {
        ctrlKey: true,
        shiftKey: true,
        clientX: 90,
        clientY: 140,
      });

      expect(selectable.selection().map((element) => element.id)).toEqual(['second', 'first']);

      triggerShortcut({ key: 'Backspace', keyCode: 8 });

      expect(Array.from(root.children).map((element) => element.id)).toEqual(['third', 'other']);
      expect(selectable.selection().map((element) => element.id)).toEqual(['third']);
    }, { activeTool: 'inspector' });
  });

  it('keeps delete hotkey working after command+shift marquee releases on macOS', async () => {
    await withSelectableFixture(({ selectable }) => {
      document.body.innerHTML = `
        <main id="root">
          <div id="first" class="target">1</div>
          <div id="second" class="target">2</div>
          <div id="third">3</div>
        </main>
      `;

      const root = document.getElementById('root') as HTMLElement;
      const first = document.getElementById('first') as HTMLElement;
      const second = document.getElementById('second') as HTMLElement;
      const third = document.getElementById('third') as HTMLElement;

      first.getBoundingClientRect = () => ({ left: 0, top: 100, right: 40, bottom: 140 });
      second.getBoundingClientRect = () => ({ left: 50, top: 100, right: 90, bottom: 140 });
      third.getBoundingClientRect = () => ({ left: 100, top: 100, right: 140, bottom: 140 });

      document.elementFromPoint = (x: number) => {
        if (x <= 40) return first;
        if (x <= 90) return second;
        return third;
      };

      selectable.select(first);

      const label = document.querySelector('visbug-label') as HTMLElement;
      label.dispatchEvent(
        new window.CustomEvent('query', {
          bubbles: true,
          detail: {
            text: '.target',
            activator: 'click',
          },
        }),
      );

      dispatchKeyboard('keydown', {
        key: 'Meta',
        metaKey: true,
        keyCode: 91,
      });
      dispatchKeyboard('keydown', {
        key: 'Shift',
        metaKey: true,
        shiftKey: true,
        keyCode: 16,
      });

      dispatchMouse(first, 'mousedown', {
        button: 0,
        metaKey: true,
        shiftKey: true,
        clientX: 5,
        clientY: 105,
      });

      dispatchMouse(document.body, 'mousemove', {
        metaKey: true,
        shiftKey: true,
        clientX: 90,
        clientY: 140,
      });

      dispatchMouse(document.body, 'mouseup', {
        metaKey: true,
        shiftKey: true,
        clientX: 90,
        clientY: 140,
      });

      dispatchKeyboard('keyup', {
        key: 'Meta',
        keyCode: 91,
      });
      dispatchKeyboard('keyup', {
        key: 'Shift',
        keyCode: 16,
      });

      expect(selectable.selection().map((element) => element.id)).toEqual(['second', 'first']);

      dispatchKeyboard('keydown', {
        key: 'Backspace',
        keyCode: 8,
      });
      dispatchKeyboard('keyup', {
        key: 'Backspace',
        keyCode: 8,
      });

      expect(Array.from(root.children).map((element) => element.id)).toEqual(['third']);
      expect(selectable.selection().map((element) => element.id)).toEqual(['third']);
    }, { activeTool: 'inspector', platform: 'MacIntel' });
  });

  it('keeps keyboard move working after class multi-select followed by intersection marquee', async () => {
    await withSelectableFixture(async ({ selectable }) => {
      const { Moveable } = await import('../../public/page-edit/vendor/app/features/move.js');

      document.body.innerHTML = `
        <main id="root">
          <div id="moving" class="target">1</div>
          <section id="container" class="target">
            <span id="existing">2</span>
          </section>
          <div id="tail">3</div>
        </main>
      `;

      const root = document.getElementById('root') as HTMLElement;
      const moving = document.getElementById('moving') as HTMLElement;
      const container = document.getElementById('container') as HTMLElement;
      const tail = document.getElementById('tail') as HTMLElement;

      moving.getBoundingClientRect = () => ({ left: 0, top: 100, right: 40, bottom: 140 });
      container.getBoundingClientRect = () => ({ left: 50, top: 100, right: 120, bottom: 160 });
      tail.getBoundingClientRect = () => ({ left: 130, top: 100, right: 170, bottom: 140 });

      document.elementFromPoint = (x: number) => {
        if (x <= 40) return moving;
        if (x <= 120) return container;
        return tail;
      };

      const disconnectMove = Moveable(selectable);

      try {
        selectable.select(moving);

        const label = document.querySelector('visbug-label') as HTMLElement;
        label.dispatchEvent(
          new window.CustomEvent('query', {
            bubbles: true,
            detail: {
              text: '.target',
              activator: 'click',
            },
          }),
        );

        dispatchMouse(moving, 'mousedown', {
          button: 0,
          ctrlKey: true,
          shiftKey: true,
          clientX: 5,
          clientY: 105,
        });

        dispatchMouse(document.body, 'mousemove', {
          ctrlKey: true,
          shiftKey: true,
          clientX: 40,
          clientY: 140,
        });

        dispatchMouse(document.body, 'mouseup', {
          ctrlKey: true,
          shiftKey: true,
          clientX: 40,
          clientY: 140,
        });

        expect(selectable.selection().map((element) => element.id)).toEqual(['moving']);

        triggerShortcut({ key: 'ArrowDown', keyCode: 40 });

        expect(Array.from(root.children).map((element) => element.id)).toEqual([
          'container',
          'moving',
          'tail',
        ]);
        expect(Array.from(container.children).map((element) => element.id)).toEqual(['existing']);
      } finally {
        disconnectMove();
      }
    }, { activeTool: 'inspector' });
  });
});
