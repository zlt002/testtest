// @vitest-environment node

import { JSDOM } from 'jsdom';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  buildCssSelector,
  buildElementSummary,
  describeSelectedElement,
  findSelectableParentElement,
  isPageEditUiElement,
  tryResolveSourceLocation,
} from '../../public/page-edit/vendor/app/features/selection-actions.js';

let dom: JSDOM;
let previousGlobals: Record<string, unknown>;
let previousElementFromPoint: Document['elementFromPoint'] | undefined;
const baseFixture = `
  <section id="card" class="order-card">
    <span class="status active">已揽收</span>
  </section>
`;

beforeAll(() => {
  dom = new JSDOM(
    `<!doctype html><html><body>${baseFixture}</body></html>`,
    { url: 'https://example.com/orders' },
  );

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
    Element: dom.window.Element,
    SVGElement: dom.window.SVGElement,
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
  document.documentElement.removeAttribute('data-webmcp-page-edit-config');
});

afterEach(() => {
  if (previousElementFromPoint) {
    document.elementFromPoint = previousElementFromPoint;
  } else {
    delete document.elementFromPoint;
  }
  document.onkeydown = null;
  document.onkeyup = null;
  document.documentElement.removeAttribute('data-webmcp-page-edit-config');
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

async function withSelectableFixture(
  run: (fixture: {
    selectable: ReturnType<(typeof import('../../public/page-edit/vendor/app/features/selectable.js'))['Selectable']>;
  }) => Promise<void> | void,
  options: {
    platform?: string;
    activeTool?: string | null;
    showSelectionActionsEverywhere?: boolean;
    selectionBridgeNonce?: string | null;
  } = {},
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
    shouldShowSelectionActionsEverywhere() {
      return options.showSelectionActionsEverywhere === true;
    },
  });
  if (typeof options.selectionBridgeNonce === 'string') {
    selectable.setSelectionBridgeNonce?.(options.selectionBridgeNonce);
  }

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
  type: 'mousedown' | 'mouseup' | 'click' | 'mousemove',
  init: MouseEventInit,
) {
  target.dispatchEvent(
    new window.MouseEvent(type, {
      bubbles: true,
      cancelable: true,
      ...init,
    }),
  );
}

function dispatchKeyboard(
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

  document.dispatchEvent(event);
}

function waitForWindowMessage(timeoutMs = 100) {
  return new Promise<MessageEvent>((resolve, reject) => {
    const timer = window.setTimeout(() => {
      window.removeEventListener('message', onMessage);
      reject(new Error('expected postMessage to dispatch a message event'));
    }, timeoutMs);

    const onMessage = (event: MessageEvent) => {
      window.clearTimeout(timer);
      resolve(event);
    };

    window.addEventListener('message', onMessage, { once: true });
  });
}

async function flushMicrotasks(times = 3) {
  for (let index = 0; index < times; index += 1) {
    await Promise.resolve();
  }
}

describe('selection-actions helpers', () => {
  it('renders parent and send buttons in the selection label', async () => {
    const { Label } = await import('../../public/page-edit/vendor/app/components/selection/label.element.js');
    const label = new Label();
    label.text = '<a node>span</a><a>.status</a>';
    const markup = label.render('1');

    expect(markup).toContain('data-action="select-parent"');
    expect(markup).toContain('>父级<');
    expect(markup).toContain('data-action="send-selection"');
    expect(markup).toContain('>发送<');
  });

  it('hides annotate on live pages and keeps snapshot editing entry hidden', async () => {
    document.documentElement.setAttribute(
      'data-webmcp-page-edit-config',
      JSON.stringify({ pageMode: 'live-page' }),
    );

    const { Label } = await import('../../public/page-edit/vendor/app/components/selection/label.element.js');
    const label = new Label();
    label.text = '<a node>span</a><a>.status</a>';
    const markup = label.render('live-page');

    expect(markup).toContain('data-action="send-selection"');
    expect(markup).toContain('data-action="select-parent"');
    expect(markup).toContain('data-action="capture-selection"');
    expect(markup).toContain('data-action="analyze-selection"');
    expect(markup).toContain('>分析<');
    expect(markup).not.toContain('data-action="annotate-selection"');
    expect(markup).not.toContain('>备注<');
    expect(markup).not.toContain('data-action="edit-selection"');
    expect(markup).not.toContain('>编辑<');
  });

  it('does not render the reserved snapshot editing entry on local snapshot pages', async () => {
    document.documentElement.setAttribute(
      'data-webmcp-page-edit-config',
      JSON.stringify({ pageMode: 'local-snapshot' }),
    );

    const { Label } = await import('../../public/page-edit/vendor/app/components/selection/label.element.js');
    const label = new Label();
    label.text = '<a node>span</a><a>.status</a>';
    const markup = label.render('snapshot');

    expect(markup).toContain('data-action="send-selection"');
    expect(markup).toContain('data-action="select-parent"');
    expect(markup).toContain('data-action="capture-selection"');
    expect(markup).toContain('data-action="annotate-selection"');
    expect(markup).not.toContain('data-action="analyze-selection"');
    expect(markup).toContain('>发送<');
    expect(markup).toContain('>父级<');
    expect(markup).toContain('>采集<');
    expect(markup).toContain('>备注<');
    expect(markup).not.toContain('>分析<');
    expect(markup).not.toContain('data-action="edit-selection"');
    expect(markup).not.toContain('disabled');
    expect(markup).not.toContain('>编辑<');
  });

  it('renders only send and parent buttons for multi-selection labels', async () => {
    document.documentElement.setAttribute(
      'data-webmcp-page-edit-config',
      JSON.stringify({ pageMode: 'local-snapshot' }),
    );

    const { Label } = await import('../../public/page-edit/vendor/app/components/selection/label.element.js');
    const label = new Label();
    label.text = '<a node>已选 3 项</a>';
    label.setAttribute('data-multi-selection-label', 'true');
    const markup = label.render('multi');

    expect(markup).toContain('data-action="send-selection"');
    expect(markup).toContain('data-action="select-parent"');
    expect(markup).toContain('>发送<');
    expect(markup).toContain('>父级<');
    expect(markup).not.toContain('data-action="capture-selection"');
    expect(markup).not.toContain('data-action="annotate-selection"');
    expect(markup).not.toContain('>采集<');
    expect(markup).not.toContain('>备注<');
  });

  it('dispatchAction emits action details with the source label id', async () => {
    const { Label } = await import('../../public/page-edit/vendor/app/components/selection/label.element.js');
    const label = new Label();
    const preventDefault = vi.fn();
    const stopPropagation = vi.fn();
    const onSelectionAction = vi.fn();

    label.addEventListener('selection-action', onSelectionAction as EventListener);
    label.render('7');

    label.dispatchAction({
      preventDefault,
      stopPropagation,
      currentTarget: {
        getAttribute(name: string) {
          return name === 'data-action' ? 'analyze-selection' : null;
        },
      },
    } as unknown as MouseEvent);

    expect(preventDefault).toHaveBeenCalled();
    expect(stopPropagation).toHaveBeenCalled();
    expect(onSelectionAction).toHaveBeenCalledTimes(1);
    expect((onSelectionAction.mock.calls[0][0] as CustomEvent).detail).toEqual({
      action: 'analyze-selection',
      nodeLabelId: '7',
    });
  });

  it('dispatchQuery emits mouseleave so selector previews can be cleared immediately', async () => {
    const { Label } = await import('../../public/page-edit/vendor/app/components/selection/label.element.js');
    const label = new Label();
    const onQuery = vi.fn();

    label.addEventListener('query', onQuery as EventListener);
    label.render('8');

    label.dispatchQuery({
      target: { textContent: '.status' },
      type: 'mouseleave',
    } as unknown as MouseEvent);

    expect(onQuery).toHaveBeenCalledTimes(1);
    expect((onQuery.mock.calls[0][0] as CustomEvent).detail).toEqual({
      text: '.status',
      activator: 'mouseleave',
    });
  });

  it('hides action buttons for readonly labels like drag bounds', async () => {
    const { Label } = await import('../../public/page-edit/vendor/app/components/selection/label.element.js');
    const label = new Label();
    label.text = 'Drag Bounds';
    label.setAttribute('data-readonly-label', 'true');

    const markup = label.render('readonly');

    expect(markup).not.toContain('data-action="select-parent"');
    expect(markup).not.toContain('data-action="send-selection"');
    expect(markup).not.toContain('data-action="capture-selection"');
    expect(markup).not.toContain('data-action="analyze-selection"');
  });

  it('supports stacking readonly labels higher than selection action labels', async () => {
    const { Label } = await import('../../public/page-edit/vendor/app/components/selection/label.element.js');
    const label = new Label();

    label.style.setProperty('--stack-offset-y', '28px');

    expect(label.style.getPropertyValue('--stack-offset-y')).toBe('28px');
  });

  it('shifts the selection action label back into view when it overflows the right edge', async () => {
    const { Label } = await import('../../public/page-edit/vendor/app/components/selection/label.element.js');
    const label = new Label();

    Object.defineProperty(window, 'innerWidth', {
      configurable: true,
      value: 1000,
    });

    document.body.appendChild(label);
    label.text = '<a node>span</a><a>.status</a>';
    label.position = {
      boundingRect: {
        x: 900,
        y: 120,
        width: 40,
      },
      node_label_id: 'edge',
    };

    const shell = (label as HTMLElement & { $shadow?: ShadowRoot }).$shadow?.querySelector(
      '.label-shell'
    ) as HTMLSpanElement;
    vi.spyOn(shell, 'getBoundingClientRect').mockReturnValue({
      x: 899,
      y: 80,
      width: 240,
      height: 28,
      top: 80,
      right: 1139,
      bottom: 108,
      left: 899,
      toJSON: () => ({}),
    });

    label.update = {
      x: 900,
      y: 120,
      width: 40,
    };

    expect(Number.parseFloat(label.style.getPropertyValue('--max-width'))).toBe(984);
    expect(Number.parseFloat(label.style.getPropertyValue('--translate-x'))).toBeLessThan(0);
  });

  it('moves the selection action label inside the element when there is no room above and the box is tall enough', async () => {
    const { Label } = await import('../../public/page-edit/vendor/app/components/selection/label.element.js');
    const label = new Label();

    Object.defineProperty(window, 'innerWidth', {
      configurable: true,
      value: 1000,
    });

    document.body.appendChild(label);
    label.text = '<a node>span</a><a>.status</a>';
    label.position = {
      boundingRect: {
        x: 300,
        y: 4,
        width: 80,
        height: 32,
      },
      node_label_id: 'top-edge',
    };

    const shell = (label as HTMLElement & { $shadow?: ShadowRoot }).$shadow?.querySelector(
      '.label-shell'
    ) as HTMLSpanElement;
    vi.spyOn(shell, 'getBoundingClientRect').mockReturnValue({
      x: 299,
      y: -24,
      width: 240,
      height: 28,
      top: -24,
      right: 539,
      bottom: 4,
      left: 299,
      toJSON: () => ({}),
    });

    label.update = {
      x: 300,
      y: 4,
      width: 80,
      height: 32,
    };

    expect(label.style.getPropertyValue('--translate-y')).toBe('1px');
    expect(label.getAttribute('data-inside-label')).toBe('true');
  });

  it('shifts the selection action label right when the label would overflow past the viewport left edge', async () => {
    const { Label } = await import('../../public/page-edit/vendor/app/components/selection/label.element.js');
    const label = new Label();

    Object.defineProperty(window, 'innerWidth', {
      configurable: true,
      value: 1000,
    });

    document.body.appendChild(label);
    label.text = '<a node>span</a><a>.status</a>';
    label.position = {
      boundingRect: {
        x: 4,
        y: 120,
        width: 40,
      },
      node_label_id: 'left-edge',
    };

    const shell = (label as HTMLElement & { $shadow?: ShadowRoot }).$shadow?.querySelector(
      '.label-shell'
    ) as HTMLSpanElement;
    vi.spyOn(shell, 'getBoundingClientRect').mockReturnValue({
      x: -36,
      y: 80,
      width: 240,
      height: 28,
      top: 80,
      right: 204,
      bottom: 108,
      left: -36,
      toJSON: () => ({}),
    });

    label.update = {
      x: 4,
      y: 120,
      width: 40,
    };

    expect(Number.parseFloat(label.style.getPropertyValue('--translate-x'))).toBeGreaterThan(0);
  });

  it('keeps the selection action label below the element when there is no room above and the box is too short', async () => {
    const { Label } = await import('../../public/page-edit/vendor/app/components/selection/label.element.js');
    const label = new Label();

    Object.defineProperty(window, 'innerWidth', {
      configurable: true,
      value: 1000,
    });

    document.body.appendChild(label);
    label.text = '<a node>span</a><a>.status</a>';
    label.position = {
      boundingRect: {
        x: 300,
        y: 4,
        width: 80,
        height: 20,
      },
      node_label_id: 'top-edge-short',
    };

    const shell = (label as HTMLElement & { $shadow?: ShadowRoot }).$shadow?.querySelector(
      '.label-shell'
    ) as HTMLSpanElement;
    vi.spyOn(shell, 'getBoundingClientRect').mockReturnValue({
      x: 299,
      y: -24,
      width: 240,
      height: 28,
      top: -24,
      right: 539,
      bottom: 4,
      left: 299,
      toJSON: () => ({}),
    });

    label.update = {
      x: 300,
      y: 4,
      width: 80,
      height: 20,
    };

    expect(label.style.getPropertyValue('--translate-y')).toBe('28px');
    expect(label.getAttribute('data-inside-label')).toBeNull();
  });

  it('builds a compact readable element summary for live pages without class metadata', () => {
    const element = document.querySelector('.status.active') as HTMLElement;
    expect(buildElementSummary(element)).toBe('span  文本: 已揽收');
  });

  it('keeps class metadata in the compact readable element summary for local snapshot pages', () => {
    document.documentElement.setAttribute(
      'data-webmcp-page-edit-config',
      JSON.stringify({ pageMode: 'local-snapshot' }),
    );

    const element = document.querySelector('.status.active') as HTMLElement;
    expect(buildElementSummary(element)).toBe('span.status.active  文本: 已揽收');
  });

  it('prefers id and stable classes when building selectors', () => {
    const element = document.querySelector('.status.active') as HTMLElement;
    expect(buildCssSelector(element)).toBe('#card > span.status.active');
  });

  it('escapes utility classes so the selector remains queryable', () => {
    document.body.innerHTML = `
      <section id="card">
        <span class="sm:hover:bg-blue-500 w-1/2">半宽按钮</span>
      </section>
    `;

    const element = document.querySelector('span') as HTMLElement;
    const selector = buildCssSelector(element);

    expect(selector).toBe('#card > span.sm\\:hover\\:bg-blue-500.w-1\\/2');
    expect(document.querySelector(selector)).toBe(element);
  });

  it('escapes numeric-leading ids with fallback escaping so selectors remain queryable', () => {
    const previousCss = globalThis.CSS;
    // @ts-expect-error test fallback without native CSS.escape
    globalThis.CSS = undefined;
    document.body.innerHTML = `
      <section>
        <span id="1card">数字开头</span>
      </section>
    `;

    try {
      const element = document.querySelector('span') as HTMLElement;
      const selector = buildCssSelector(element);

      expect(selector).toBe('#\\31 card');
      expect(document.querySelector(selector)).toBe(element);
    } finally {
      globalThis.CSS = previousCss;
    }
  });

  it('escapes hyphen-digit classes with fallback escaping so selectors remain queryable', () => {
    const previousCss = globalThis.CSS;
    // @ts-expect-error test fallback without native CSS.escape
    globalThis.CSS = undefined;
    document.body.innerHTML = `
      <section id="card">
        <span class="-1foo">连字符数字</span>
      </section>
    `;

    try {
      const element = document.querySelector('span') as HTMLElement;
      const selector = buildCssSelector(element);

      expect(selector).toBe('#card > span.-\\31 foo');
      expect(document.querySelector(selector)).toBe(element);
    } finally {
      globalThis.CSS = previousCss;
    }
  });

  it('formats live page payload with selector and summary', () => {
    const element = document.querySelector('.status.active') as HTMLElement;
    expect(describeSelectedElement(element, { pageUrl: 'https://example.com/orders' })).toEqual({
      source: 'live-page',
      text: '定位信息：\n选择器: #card > span.status.active\n元素: span  文本: 已揽收',
    });
  });

  it('falls back to file path + summary when file source location is unavailable', () => {
    const element = document.querySelector('#card') as HTMLElement;
    expect(
      describeSelectedElement(element, {
        pageUrl: 'file:///Users/demo/Desktop/mock/index.html',
        documentHtml: '<html><body><section class="different"></section></body></html>',
      }),
    ).toEqual({
      source: 'file',
      text: '定位信息：\n文件: /Users/demo/Desktop/mock/index.html\n元素: section#card.order-card  文本: 已揽收',
    });
  });

  it('normalizes windows file urls into local file paths', () => {
    const element = document.querySelector('#card') as HTMLElement;

    expect(
      describeSelectedElement(element, {
        pageUrl: 'file:///C:/demo/index.html',
        documentHtml: '<html><body><section class="different"></section></body></html>',
      }),
    ).toEqual({
      source: 'file',
      text: '定位信息：\n文件: C:/demo/index.html\n元素: section#card.order-card  文本: 已揽收',
    });
  });

  it('resolves source location for the matched sibling instead of the first repeated class', () => {
    document.body.innerHTML = `
      <main>
        <section class="card">
          <span class="label">第一项</span>
        </section>
        <section class="card">
          <span class="label">第二项</span>
        </section>
      </main>
    `;

    const elements = document.querySelectorAll('.label');
    const firstLocation = tryResolveSourceLocation(
      elements[0] as HTMLElement,
      document.documentElement.outerHTML,
    );
    const secondLocation = tryResolveSourceLocation(
      elements[1] as HTMLElement,
      document.documentElement.outerHTML,
    );

    expect(firstLocation).toEqual({ line: 4, column: 11 });
    expect(secondLocation).toEqual({ line: 7, column: 11 });
  });

  it('returns the nearest real page parent and skips visbug overlay nodes', () => {
    const target = document.querySelector('.status.active') as HTMLElement;
    const overlay = document.createElement('visbug-hover');
    target.parentElement?.appendChild(overlay);

    expect(findSelectableParentElement(target)?.id).toBe('card');
    expect(findSelectableParentElement(overlay)).toBeNull();
  });

  it('treats foreign realm dom elements as selectable elements', () => {
    const foreignDom = new JSDOM(
      '<!doctype html><html><body><section id="outer"><span id="inner">跨 realm</span></section></body></html>',
    );

    try {
      const foreignInner = foreignDom.window.document.getElementById('inner') as HTMLElement;

      expect(findSelectableParentElement(foreignInner)?.id).toBe('outer');
      expect(buildCssSelector(foreignInner)).toBe('#inner');
    } finally {
      foreignDom.window.close();
    }
  });

  it('walks across shadow boundaries when resolving the parent element', () => {
    const host = document.createElement('section');
    host.id = 'host';
    const shadowRoot = host.attachShadow({ mode: 'open' });
    const shadowChild = document.createElement('span');
    shadowChild.id = 'inner-shadow-node';

    shadowRoot.appendChild(shadowChild);
    document.body.appendChild(host);

    expect(findSelectableParentElement(shadowChild)).toBe(host);
  });

  it('recognizes page-edit ui descendants in normal dom and shadow dom', () => {
    const toolbar = document.createElement('vis-bug');
    const toolbarButton = document.createElement('button');
    toolbar.appendChild(toolbarButton);
    document.body.appendChild(toolbar);

    const label = document.createElement('visbug-label');
    const shadowHost = document.createElement('div');
    label.appendChild(shadowHost);
    const shadowRoot = shadowHost.attachShadow({ mode: 'open' });
    const shadowButton = document.createElement('button');
    shadowRoot.appendChild(shadowButton);
    document.body.appendChild(label);

    const realContent = document.querySelector('.status.active') as HTMLElement;

    expect(isPageEditUiElement(toolbarButton)).toBe(true);
    expect(isPageEditUiElement(shadowButton)).toBe(true);
    expect(isPageEditUiElement(realContent)).toBe(false);
  });

  it('does not throw when color picker markup is unavailable in live-page mode', async () => {
    const { ColorPicker } = await import('../../public/page-edit/vendor/app/features/color.js');

    const palette = document.createElement('div');

    expect(() =>
      ColorPicker(palette, {
        recordStyleMutation() {},
        onSelectedUpdate(callback: (elements: Element[]) => void) {
          callback([]);
        },
      }),
    ).not.toThrow();
  });

  it('selects the nearest parent when the parent action fires', async () => {
    await withSelectableFixture(({ selectable }) => {
      document.body.innerHTML = `
        <section id="card"><span id="target">运单查询</span></section>
      `;

      const target = document.getElementById('target') as HTMLElement;
      selectable.select(target);

      const label = document.querySelector('visbug-label') as HTMLElement;
      label.dispatchEvent(
        new CustomEvent('selection-action', {
          bubbles: true,
          detail: { action: 'select-parent' },
        }),
      );

      expect(selectable.selection().map((element) => element.id)).toEqual(['card']);
    });
  });

  it('prefers page-edit label targets over elementFromPoint when handling label clicks', async () => {
    await withSelectableFixture(({ selectable }) => {
      document.body.innerHTML = `
        <section id="card"><span id="target">运单查询</span></section>
        <aside id="outside">别误选我</aside>
      `;

      const target = document.getElementById('target') as HTMLElement;
      const outside = document.getElementById('outside') as HTMLElement;
      target.getBoundingClientRect = () =>
        ({
          x: 10,
          y: 20,
          width: 100,
          height: 20,
          top: 20,
          left: 10,
          right: 110,
          bottom: 40,
          toJSON() {},
        }) as DOMRect;
      outside.getBoundingClientRect = () =>
        ({
          x: 200,
          y: 20,
          width: 100,
          height: 20,
          top: 20,
          left: 200,
          right: 300,
          bottom: 40,
          toJSON() {},
        }) as DOMRect;

      selectable.select(target);

      document.elementFromPoint = () => outside;

      const label = document.querySelector('visbug-label') as HTMLElement;

      dispatchMouse(label, 'mousedown', {
        button: 0,
        clientX: 20,
        clientY: 10,
      });
      dispatchMouse(label, 'mouseup', {
        button: 0,
        clientX: 20,
        clientY: 10,
      });
      dispatchMouse(label, 'click', {
        button: 0,
        clientX: 20,
        clientY: 10,
      });

      expect(selectable.selection().map((element) => element.id)).toEqual(['target']);
    });
  });

  it('shows action-only labels outside inspector when the global toggle is enabled', async () => {
    await withSelectableFixture(({ selectable }) => {
      document.body.innerHTML = `
        <section id="card"><span id="target">运单查询</span></section>
      `;

      const target = document.getElementById('target') as HTMLElement;
      selectable.select(target);

      const label = document.querySelector('visbug-label') as HTMLElement;
      expect(label).not.toBeNull();
      expect(label.shadowRoot).toBeNull();
      expect(label.outerHTML).toContain('data-label-id');
    }, {
      activeTool: 'guides',
      showSelectionActionsEverywhere: true,
    });
  });

  it('selects the nearest parent outside inspector when the global toggle is enabled', async () => {
    await withSelectableFixture(({ selectable }) => {
      document.body.innerHTML = `
        <section id="card"><span id="target">运单查询</span></section>
      `;

      const target = document.getElementById('target') as HTMLElement;
      selectable.select(target);

      const label = document.querySelector('visbug-label') as HTMLElement;
      label.dispatchEvent(
        new CustomEvent('selection-action', {
          bubbles: true,
          detail: { action: 'select-parent' },
        }),
      );

      expect(selectable.selection().map((element) => element.id)).toEqual(['card']);
    }, {
      activeTool: 'guides',
      showSelectionActionsEverywhere: true,
    });
  });

  it('posts formatted payload to the page when send action fires', async () => {
    await withSelectableFixture(({ selectable }) => {
      document.body.innerHTML = `
        <section id="card"><span class="status">运单查询</span></section>
      `;
      const target = document.querySelector('.status') as HTMLElement;
      const originalPostMessage = window.postMessage;
      const postMessage = vi.fn();
      window.postMessage = postMessage as typeof window.postMessage;

      try {
        selectable.select(target);
        const label = document.querySelector('visbug-label') as HTMLElement;
        label.dispatchEvent(
          new CustomEvent('selection-action', {
            bubbles: true,
            detail: { action: 'send-selection' },
          }),
        );

        expect(postMessage).toHaveBeenCalledWith(
          {
            type: 'page_edit_selection_append',
            payload: {
              source: 'live-page',
              text: expect.stringContaining('选择器: #card > span.status'),
            },
          },
          window.location.origin,
        );
      } finally {
        window.postMessage = originalPostMessage;
      }
    });
  });

  it('clears pseudo-select previews when leaving a label query anchor', async () => {
    await withSelectableFixture(({ selectable }) => {
      document.body.innerHTML = `
        <section id="card-a"><span class="status alpha">A</span></section>
        <section id="card-b"><span class="status beta">B</span></section>
      `;

      const target = document.querySelector('.alpha') as HTMLElement;
      const sibling = document.querySelector('.beta') as HTMLElement;

      selectable.select(target);

      const label = document.querySelector('visbug-label') as HTMLElement;
      label.dispatchEvent(
        new window.CustomEvent('query', {
          bubbles: true,
          detail: {
            text: '.status',
            activator: 'mouseenter',
          },
        }),
      );

      expect(sibling.getAttribute('data-pseudo-select')).toBe('true');

      label.dispatchEvent(
        new window.CustomEvent('query', {
          bubbles: true,
          detail: {
            text: '.status',
            activator: 'mouseleave',
          },
        }),
      );

      expect(document.querySelectorAll('[data-pseudo-select]')).toHaveLength(0);
    });
  });

  it('clears pseudo-select previews when pointer returns to the page', async () => {
    await withSelectableFixture(({ selectable }) => {
      document.body.innerHTML = `
        <section id="card-a"><span class="status alpha">A</span></section>
        <section id="card-b"><span class="status beta">B</span></section>
      `;

      const target = document.querySelector('.alpha') as HTMLElement;
      const sibling = document.querySelector('.beta') as HTMLElement;

      sibling.getBoundingClientRect = () =>
        ({
          x: 120,
          y: 80,
          top: 80,
          left: 120,
          right: 200,
          bottom: 110,
          width: 80,
          height: 30,
          toJSON() {
            return this;
          },
        }) as DOMRect;

      document.elementFromPoint = () => sibling;

      selectable.select(target);

      const label = document.querySelector('visbug-label') as HTMLElement;
      label.dispatchEvent(
        new window.CustomEvent('query', {
          bubbles: true,
          detail: {
            text: '.status',
            activator: 'mouseenter',
          },
        }),
      );

      expect(sibling.getAttribute('data-pseudo-select')).toBe('true');

      document.body.dispatchEvent(
        new window.MouseEvent('mousemove', {
          bubbles: true,
          clientX: 140,
          clientY: 90,
        }),
      );

      expect(document.querySelectorAll('[data-pseudo-select]')).toHaveLength(0);
    });
  });

  it('uses the primary selection when parent action fires in multi-selection', async () => {
    await withSelectableFixture(({ selectable }) => {
      document.body.innerHTML = `
        <section id="card-a"><span class="alpha">A</span></section>
        <section id="card-b"><span class="beta">B</span></section>
      `;

      const firstTarget = document.querySelector('.alpha') as HTMLElement;
      const secondTarget = document.querySelector('.beta') as HTMLElement;
      selectable.select(firstTarget);
      selectable.select(secondTarget);

      const label = document.querySelector('visbug-label') as HTMLElement;

      label.dispatchEvent(
        new CustomEvent('selection-action', {
          bubbles: true,
          detail: { action: 'select-parent' },
        }),
      );

      expect(selectable.selection().map((element) => element.id)).toEqual(['card-b']);
    });
  });

  it('uses the primary selection first when multi-selection send fires', async () => {
    await withSelectableFixture(({ selectable }) => {
      document.body.innerHTML = `
        <section id="card-a"><span class="alpha">A</span></section>
        <section id="card-b"><span class="beta">B</span></section>
      `;

      const firstTarget = document.querySelector('.alpha') as HTMLElement;
      const secondTarget = document.querySelector('.beta') as HTMLElement;
      const originalPostMessage = window.postMessage;
      const postMessage = vi.fn();
      window.postMessage = postMessage as typeof window.postMessage;

      try {
        selectable.select(firstTarget);
        selectable.select(secondTarget);

        const label = document.querySelector('visbug-label') as HTMLElement;

        label.dispatchEvent(
          new CustomEvent('selection-action', {
            bubbles: true,
            detail: { action: 'send-selection' },
          }),
        );

        expect(postMessage.mock.calls[0][0]).toEqual(
          expect.objectContaining({
            type: 'page_edit_selection_append',
            payload: expect.objectContaining({
              text: expect.stringContaining('选择器: #card-b > span.beta'),
            }),
          }),
        );
      } finally {
        window.postMessage = originalPostMessage;
      }
    });
  });

  it('renders only one multi-selection label and hides capture/annotate buttons', async () => {
    await withSelectableFixture(({ selectable }) => {
      document.body.innerHTML = `
        <section id="card-a"><span class="alpha">A</span></section>
        <section id="card-b"><span class="beta">B</span></section>
      `;

      const firstTarget = document.querySelector('.alpha') as HTMLElement;
      const secondTarget = document.querySelector('.beta') as HTMLElement;

      selectable.select(firstTarget);
      selectable.select(secondTarget);

      const labels = Array.from(document.querySelectorAll('visbug-label')) as Array<
        HTMLElement & { $shadow?: ShadowRoot }
      >;

      expect(labels).toHaveLength(1);
      expect(labels[0].getAttribute('data-multi-selection-label')).toBe('true');

      const buttonActions = Array.from(
        labels[0].$shadow?.querySelectorAll('button[data-action]') ?? [],
      ).map((button) => button.getAttribute('data-action'));

      expect(buttonActions).toEqual(['send-selection', 'select-parent']);
    });
  });

  it('posts payloads for every selected element when multi-selection send fires', async () => {
    await withSelectableFixture(({ selectable }) => {
      document.body.innerHTML = `
        <section id="card-a"><span class="alpha">A</span></section>
        <section id="card-b"><span class="beta">B</span></section>
      `;

      const firstTarget = document.querySelector('.alpha') as HTMLElement;
      const secondTarget = document.querySelector('.beta') as HTMLElement;
      const originalPostMessage = window.postMessage;
      const postMessage = vi.fn();
      window.postMessage = postMessage as typeof window.postMessage;

      try {
        selectable.select(firstTarget);
        selectable.select(secondTarget);

        const label = document.querySelector('visbug-label') as HTMLElement;
        label.dispatchEvent(
          new CustomEvent('selection-action', {
            bubbles: true,
            detail: { action: 'send-selection' },
          }),
        );

        expect(postMessage).toHaveBeenCalledTimes(2);
        expect(postMessage.mock.calls[0][0]).toEqual(
          expect.objectContaining({
            type: 'page_edit_selection_append',
            payload: expect.objectContaining({
              text: expect.stringContaining('选择器: #card-b > span.beta'),
            }),
          }),
        );
        expect(postMessage.mock.calls[1][0]).toEqual(
          expect.objectContaining({
            type: 'page_edit_selection_append',
            payload: expect.objectContaining({
              text: expect.stringContaining('选择器: #card-a > span.alpha'),
            }),
          }),
        );
      } finally {
        window.postMessage = originalPostMessage;
      }
    });
  });

  it('anchors the multi-selection label to a currently visible selected element', async () => {
    await withSelectableFixture(({ selectable }) => {
      Object.defineProperty(window, 'innerHeight', {
        configurable: true,
        value: 300,
      });

      document.body.innerHTML = `
        <section id="card-a"><span class="alpha">A</span></section>
        <section id="card-b"><span class="beta">B</span></section>
      `;

      const firstTarget = document.querySelector('.alpha') as HTMLElement;
      const secondTarget = document.querySelector('.beta') as HTMLElement;

      firstTarget.getBoundingClientRect = () =>
        ({
          x: 0,
          y: 640,
          top: 640,
          left: 0,
          right: 80,
          bottom: 680,
          width: 80,
          height: 40,
          toJSON() {
            return this;
          },
        }) as DOMRect;

      secondTarget.getBoundingClientRect = () =>
        ({
          x: 0,
          y: 120,
          top: 120,
          left: 0,
          right: 80,
          bottom: 160,
          width: 80,
          height: 40,
          toJSON() {
            return this;
          },
        }) as DOMRect;

      selectable.select(firstTarget);
      selectable.select(secondTarget);

      const label = document.querySelector('visbug-label') as HTMLElement;

      expect(label).toBeTruthy();
      expect(label.getAttribute('data-label-id')).toBe(secondTarget.getAttribute('data-label-id'));
      expect(label.style.getPropertyValue('--top')).toBe('120px');
    });
  });

  it('posts formatted payload on file pages when send action fires', async () => {
    const originalUrl = window.location.href;
    dom.reconfigure({ url: 'file:///Users/demo/Desktop/mock/index.html' });

    try {
      await withSelectableFixture(async ({ selectable }) => {
        document.body.innerHTML = `
          <section id="card"><span class="status">运单查询</span></section>
        `;
        const target = document.querySelector('.status') as HTMLElement;
        const originalPostMessage = window.postMessage;
        const postMessage = vi.fn();
        window.postMessage = postMessage as typeof window.postMessage;

        try {
          selectable.select(target);
          const label = document.querySelector('visbug-label') as HTMLElement;
          label.dispatchEvent(
            new CustomEvent('selection-action', {
              bubbles: true,
              detail: { action: 'send-selection' },
            }),
          );

          expect(postMessage).toHaveBeenCalledWith(
            {
              type: 'page_edit_selection_append',
              payload: {
                source: 'file',
                text: expect.stringContaining('文件: /Users/demo/Desktop/mock/index.html'),
              },
            },
            '*',
          );
        } finally {
          window.postMessage = originalPostMessage;
        }
      });
    } finally {
      dom.reconfigure({ url: originalUrl });
    }
  });

  it('alerts users to refresh file pages when send action fires before the bridge nonce is ready', async () => {
    const originalUrl = window.location.href;
    dom.reconfigure({ url: 'file:///Users/demo/Desktop/mock/index.html' });
    document.documentElement.setAttribute(
      'data-webmcp-page-edit-config',
      JSON.stringify({ pageMode: 'local-snapshot' }),
    );
    const alertSpy = vi.spyOn(window, 'alert').mockImplementation(() => {});
    await import('../../public/page-edit/vendor/app/components/vis-bug/vis-bug.element.js');
    const visbug = document.createElement('vis-bug') as HTMLElement & {
      selectorEngine: { select: (element: HTMLElement) => void };
    };

    try {
      document.body.innerHTML = `
        <section id="card"><span class="status">运单查询</span></section>
      `;
      const target = document.querySelector('.status') as HTMLElement;
      const originalPostMessage = window.postMessage;
      const postMessage = vi.fn();
      window.postMessage = postMessage as typeof window.postMessage;
      document.body.appendChild(visbug);

      try {
        visbug.selectorEngine.select(target);
        const label = document.querySelector('visbug-label') as HTMLElement;
        label.dispatchEvent(
          new CustomEvent('selection-action', {
            bubbles: true,
            detail: { action: 'send-selection' },
          }),
        );

        expect(alertSpy).toHaveBeenCalledWith(
          '当前 file:// 页面工作台连接未完成，请先刷新页面后再操作。'
        );
        expect(postMessage).not.toHaveBeenCalled();
      } finally {
        visbug.remove();
        window.postMessage = originalPostMessage;
      }
    } finally {
      alertSpy.mockRestore();
      dom.reconfigure({ url: originalUrl });
    }
  });

  it('opens a readonly selector dialog and posts annotate payload after submit on live pages', async () => {
    await withSelectableFixture(async ({ selectable }) => {
      document.body.innerHTML = `
        <section id="card"><span class="status">运单查询</span></section>
      `;
      const target = document.querySelector('.status') as HTMLElement;
      const originalPostMessage = window.postMessage;
      const postMessage = vi.fn();
      window.postMessage = postMessage as typeof window.postMessage;

      try {
        selectable.select(target);
        const label = document.querySelector('visbug-label') as HTMLElement;
        label.dispatchEvent(
          new CustomEvent('selection-action', {
            bubbles: true,
            detail: { action: 'annotate-selection' },
          }),
        );

        await flushMicrotasks();

        const dialog = document.querySelector(
          'webmcp-page-annotation-dialog',
        ) as HTMLElement & { $shadow?: ShadowRoot };
        expect(dialog).toBeTruthy();

        const shadow = dialog.$shadow;
        const selectorField = shadow?.querySelector(
          'textarea[data-field="selector"]',
        ) as HTMLTextAreaElement | null;
        const noteField = shadow?.querySelector(
          'textarea[data-field="content"]',
        ) as HTMLTextAreaElement | null;
        const submitButton = shadow?.querySelector(
          'button[data-action="submit"]',
        ) as HTMLButtonElement | null;

        expect(selectorField?.readOnly).toBe(true);
        expect(selectorField?.value).toBe('#card > span.status');
        expect(noteField?.value).toBe('');

        noteField!.value = '这里需要补充人工备注';
        noteField!.dispatchEvent(new window.Event('input', { bubbles: true }));
        submitButton?.click();

        await flushMicrotasks();

        expect(postMessage).toHaveBeenCalledWith(
          {
            type: 'page_edit_selection_annotate',
            payload: {
              nonce: 'session-annotate',
              target: expect.objectContaining({
                url: 'https://example.com/orders',
                selector: '#card > span.status',
                tagName: 'span',
                text: '运单查询',
              }),
              content: '这里需要补充人工备注',
            },
          },
          window.location.origin,
        );

        expect(document.querySelector('webmcp-page-annotation-dialog')).toBeNull();
        const markers = Array.from(
          document.querySelectorAll('[data-webmcp-annotation-marker]'),
        ) as HTMLElement[];
        expect(markers).toHaveLength(1);
        expect(markers[0].style.display).toBe('grid');
      } finally {
        window.postMessage = originalPostMessage;
      }
    }, {
      selectionBridgeNonce: 'session-annotate',
    });
  });

  it('posts analyze payload to the page when analyze action fires', async () => {
    await withSelectableFixture(({ selectable }) => {
      document.body.innerHTML = `
        <section id="card"><span class="status">运单查询</span></section>
      `;
      const target = document.querySelector('.status') as HTMLElement;
      const originalPostMessage = window.postMessage;
      const postMessage = vi.fn();
      window.postMessage = postMessage as typeof window.postMessage;

      try {
        selectable.select(target);
        const label = document.querySelector('visbug-label') as HTMLElement;
        label.dispatchEvent(
          new CustomEvent('selection-action', {
            bubbles: true,
            detail: { action: 'analyze-selection' },
          }),
        );

        expect(postMessage).toHaveBeenCalledWith(
          {
            type: 'page_edit_selection_analyze',
            payload: {
              nonce: 'session-analyze',
              target: expect.objectContaining({
                url: 'https://example.com/orders',
                selector: '#card > span.status',
                tagName: 'span',
                text: '运单查询',
              }),
            },
          },
          window.location.origin,
        );
      } finally {
        window.postMessage = originalPostMessage;
      }
    }, {
      selectionBridgeNonce: 'session-analyze',
    });
  });

  it('does not send annotate message when user cancels the dialog', async () => {
    await withSelectableFixture(async ({ selectable }) => {
      document.body.innerHTML = `
        <section id="card"><span class="status">运单查询</span></section>
      `;
      const target = document.querySelector('.status') as HTMLElement;
      const originalPostMessage = window.postMessage;
      const postMessage = vi.fn();
      window.postMessage = postMessage as typeof window.postMessage;

      try {
        selectable.select(target);
        const label = document.querySelector('visbug-label') as HTMLElement;
        label.dispatchEvent(
          new CustomEvent('selection-action', {
            bubbles: true,
            detail: { action: 'annotate-selection' },
          }),
        );

        await flushMicrotasks();

        const dialog = document.querySelector(
          'webmcp-page-annotation-dialog',
        ) as HTMLElement & { $shadow?: ShadowRoot };
        const cancelButton = dialog.$shadow?.querySelector(
          'button[data-action="cancel"]',
        ) as HTMLButtonElement | null;
        cancelButton?.click();

        await flushMicrotasks();

        expect(postMessage).not.toHaveBeenCalled();
        expect(document.querySelector('webmcp-page-annotation-dialog')).toBeNull();
      } finally {
        window.postMessage = originalPostMessage;
      }
    }, {
      selectionBridgeNonce: 'session-annotate',
    });
  });

  it('does not send annotate message when dialog content is blank', async () => {
    await withSelectableFixture(async ({ selectable }) => {
      document.body.innerHTML = `
        <section id="card"><span class="status">运单查询</span></section>
      `;
      const target = document.querySelector('.status') as HTMLElement;
      const originalPostMessage = window.postMessage;
      const postMessage = vi.fn();
      window.postMessage = postMessage as typeof window.postMessage;

      try {
        selectable.select(target);
        const label = document.querySelector('visbug-label') as HTMLElement;
        label.dispatchEvent(
          new CustomEvent('selection-action', {
            bubbles: true,
            detail: { action: 'annotate-selection' },
          }),
        );

        await flushMicrotasks();

        const dialog = document.querySelector(
          'webmcp-page-annotation-dialog',
        ) as HTMLElement & { $shadow?: ShadowRoot };
        const noteField = dialog.$shadow?.querySelector(
          'textarea[data-field="content"]',
        ) as HTMLTextAreaElement | null;
        const submitButton = dialog.$shadow?.querySelector(
          'button[data-action="submit"]',
        ) as HTMLButtonElement | null;

        noteField!.value = '   ';
        noteField!.dispatchEvent(new window.Event('input', { bubbles: true }));
        submitButton?.click();

        await flushMicrotasks();

        expect(postMessage).not.toHaveBeenCalled();
        expect(document.querySelector('webmcp-page-annotation-dialog')).toBeTruthy();
      } finally {
        window.postMessage = originalPostMessage;
      }
    }, {
      selectionBridgeNonce: 'session-annotate',
    });
  });

  it('does not render the bottom toolbar shell in live-page mode', async () => {
    document.documentElement.setAttribute(
      'data-webmcp-page-edit-config',
      JSON.stringify({ pageMode: 'live-page' }),
    );

    const { default: VisBug } = await import(
      '../../public/page-edit/vendor/app/components/vis-bug/vis-bug.element.js'
    );
    const visbug = document.createElement('vis-bug') as InstanceType<typeof VisBug>;
    const markup = visbug.render().replace(/<style[\s\S]*?<\/style>/, '');

    expect(markup).not.toContain('data-bottom-toolbar=');
    expect(markup).not.toContain('data-bottom-toolbar-actions');
    expect(markup).not.toContain('data-action="capture-page"');
    expect(markup).not.toContain('data-action="toggle-annotation-markers"');
    expect(markup).not.toContain('data-role="annotation-count"');
  });

  it('pins live-page bottom toolbar sizing to a fixed host font size instead of page rem scale', async () => {
    const { visbug_css } = await import('../../public/page-edit/vendor/app/components/styles.store.js');

    expect(visbug_css).toContain('font-size: 16px;');
    expect(visbug_css).toContain(':host [data-bottom-toolbar-action] {');
    expect(visbug_css).toContain('width: 34px;');
    expect(visbug_css).toContain(':host [data-bottom-toolbar-action] [data-role="annotation-icon"] > svg {');
    expect(visbug_css).toContain('width: 15px;');
  });

  it('does not block latin keyboard input while editing selected text', async () => {
    const { EditText } = await import('../../public/page-edit/vendor/app/features/text.js');

    await withSelectableFixture(({ selectable }) => {
      const target = document.querySelector('.status.active') as HTMLElement;
      const keyboardEvent = new window.KeyboardEvent('keydown', {
        key: 'a',
        code: 'KeyA',
        bubbles: true,
        cancelable: true,
      });

      selectable.onSelectedUpdate(EditText);
      selectable.select(target);

      target.dispatchEvent(keyboardEvent);

      expect(target.getAttribute('contenteditable')).toBe('true');
      expect(keyboardEvent.defaultPrevented).toBe(false);
    });
  });

  it('allows pointer selection gestures on contenteditable text while editing', async () => {
    const { EditText } = await import('../../public/page-edit/vendor/app/features/text.js');

    await withSelectableFixture(({ selectable }) => {
      const target = document.querySelector('.status.active') as HTMLElement;
      const mouseDownEvent = new window.MouseEvent('mousedown', {
        bubbles: true,
        cancelable: true,
        button: 0,
        clientX: 10,
        clientY: 10,
      });

      selectable.onSelectedUpdate(EditText);
      selectable.select(target);
      document.elementFromPoint = vi.fn(() => target);

      target.dispatchEvent(mouseDownEvent);

      expect(target.getAttribute('contenteditable')).toBe('true');
      expect(mouseDownEvent.defaultPrevented).toBe(false);
    });
  });

  it('does not block selectstart inside a contenteditable selection root', async () => {
    const { EditText } = await import('../../public/page-edit/vendor/app/features/text.js');

    document.body.innerHTML = `
      <div id="editable-root">
        <span id="inner-a">Alpha</span>
        <span id="inner-b">Beta</span>
      </div>
    `;

    await withSelectableFixture(({ selectable }) => {
      const root = document.getElementById('editable-root') as HTMLElement;
      const inner = document.getElementById('inner-a') as HTMLElement;
      const selectStartEvent = new window.Event('selectstart', {
        bubbles: true,
        cancelable: true,
      });

      selectable.onSelectedUpdate(EditText);
      selectable.select(root);

      inner.dispatchEvent(selectStartEvent);

      expect(root.getAttribute('contenteditable')).toBe('true');
      expect(selectStartEvent.defaultPrevented).toBe(false);
    });
  });

  it('prevents link navigation clicks while editing text content', async () => {
    const { EditText } = await import('../../public/page-edit/vendor/app/features/text.js');

    document.body.innerHTML = `
      <a id="editable-link" href="https://example.com/docs">Editable link text</a>
    `;

    await withSelectableFixture(({ selectable }) => {
      const link = document.getElementById('editable-link') as HTMLElement;
      const clickEvent = new window.MouseEvent('click', {
        bubbles: true,
        cancelable: true,
        button: 0,
      });

      selectable.onSelectedUpdate(EditText);
      selectable.select(link);

      link.dispatchEvent(clickEvent);

      expect(link.getAttribute('contenteditable')).toBe('true');
      expect(clickEvent.defaultPrevented).toBe(true);
    });
  });

  it('text tool does not select container elements without direct text content', async () => {
    document.body.innerHTML = `
      <div id="text-container">
        <span id="actual-text">Editable text</span>
      </div>
    `;

    await withSelectableFixture(({ selectable }) => {
      const container = document.getElementById('text-container') as HTMLElement;
      const actualText = document.getElementById('actual-text') as HTMLElement;

      selectable.select(container);

      expect(container.hasAttribute('data-selected')).toBe(false);
      expect(actualText.hasAttribute('data-selected')).toBe(false);
      expect(selectable.selection()).toHaveLength(0);
    }, {
      activeTool: 'text',
    });
  });

  describe('live-page lightweight presentation', () => {
    it('selects the inner business element when a micro-app host wrapper is hit', async () => {
      document.documentElement.setAttribute(
        'data-webmcp-page-edit-config',
        JSON.stringify({ pageMode: 'live-page' }),
      );

      document.body.innerHTML = `
        <div class="micro-app-micro-tms" id="micro-host">
          <micro-app name="otp-tms" id="micro-app-host">
            <micro-app-head></micro-app-head>
            <micro-app-body id="micro-body">
              <section id="pane">
                <div id="table-wrap">
                  <button id="query-button">查询</button>
                </div>
              </section>
            </micro-app-body>
          </micro-app>
        </div>
      `;

      const microHost = document.getElementById('micro-host') as HTMLElement;
      const microAppHost = document.getElementById('micro-app-host') as HTMLElement;
      const microBody = document.getElementById('micro-body') as HTMLElement;
      const pane = document.getElementById('pane') as HTMLElement;
      const tableWrap = document.getElementById('table-wrap') as HTMLElement;
      const queryButton = document.getElementById('query-button') as HTMLElement;

      const bounds = new Map<HTMLElement, DOMRect>([
        [microHost, new window.DOMRect(0, 0, 1200, 600)],
        [microAppHost, new window.DOMRect(0, 0, 1100, 500)],
        [microBody, new window.DOMRect(10, 10, 1000, 420)],
        [pane, new window.DOMRect(20, 20, 960, 380)],
        [tableWrap, new window.DOMRect(30, 30, 920, 340)],
        [queryButton, new window.DOMRect(40, 40, 88, 32)],
      ]);

      for (const [element, rect] of bounds) {
        Object.defineProperty(element, 'getBoundingClientRect', {
          configurable: true,
          value: () => rect,
        });
      }

      document.elementFromPoint = vi.fn(() => microHost);

      await withSelectableFixture(({ selectable }) => {
        dispatchMouse(microHost, 'mousedown', {
          clientX: 60,
          clientY: 52,
          button: 0,
        });
        dispatchMouse(microHost, 'click', {
          clientX: 60,
          clientY: 52,
          button: 0,
        });

        expect(selectable.selection()).toHaveLength(1);
        expect(selectable.selection()[0]).toBe(queryButton);
      });
    });

    it('selects the deepest inner business element when a micro-app container block is hit', async () => {
      document.documentElement.setAttribute(
        'data-webmcp-page-edit-config',
        JSON.stringify({ pageMode: 'live-page' }),
      );

      document.body.innerHTML = `
        <div class="micro-app-micro-tms" id="micro-host">
          <micro-app name="otp-tms" id="micro-app-host">
            <micro-app-body id="micro-body">
              <section id="pane">
                <div id="table-wrap">
                  <div id="toolbar-block">
                    <button id="query-button">查询</button>
                  </div>
                </div>
              </section>
            </micro-app-body>
          </micro-app>
        </div>
      `;

      const elements = [
        ['micro-host', new window.DOMRect(0, 0, 1200, 600)],
        ['micro-app-host', new window.DOMRect(0, 0, 1100, 500)],
        ['micro-body', new window.DOMRect(10, 10, 1000, 420)],
        ['pane', new window.DOMRect(20, 20, 960, 380)],
        ['table-wrap', new window.DOMRect(30, 30, 920, 340)],
        ['toolbar-block', new window.DOMRect(40, 40, 360, 80)],
        ['query-button', new window.DOMRect(48, 44, 88, 32)],
      ].map(([id, rect]) => [document.getElementById(id as string) as HTMLElement, rect] as const);

      for (const [element, rect] of elements) {
        Object.defineProperty(element, 'getBoundingClientRect', {
          configurable: true,
          value: () => rect,
        });
      }

      const toolbarBlock = document.getElementById('toolbar-block') as HTMLElement;
      const queryButton = document.getElementById('query-button') as HTMLElement;
      document.elementFromPoint = vi.fn(() => toolbarBlock);

      await withSelectableFixture(({ selectable }) => {
        dispatchMouse(toolbarBlock, 'mousedown', {
          clientX: 60,
          clientY: 52,
          button: 0,
        });
        dispatchMouse(toolbarBlock, 'click', {
          clientX: 60,
          clientY: 52,
          button: 0,
        });

        expect(selectable.selection()).toHaveLength(1);
        expect(selectable.selection()[0]).toBe(queryButton);
      });
    });

    it('uses elementsFromPoint inside micro-app to skip shell wrappers and page-edit overlays', async () => {
      document.documentElement.setAttribute(
        'data-webmcp-page-edit-config',
        JSON.stringify({ pageMode: 'live-page' }),
      );

      document.body.innerHTML = `
        <div class="micro-app-micro-tms" id="micro-host">
          <micro-app name="otp-tms" id="micro-app-host">
            <micro-app-body id="micro-body">
              <section id="pane">
                <div id="toolbar-block">
                  <button id="query-button">查询</button>
                </div>
              </section>
            </micro-app-body>
          </micro-app>
        </div>
      `;

      const microHost = document.getElementById('micro-host') as HTMLElement;
      const microAppHost = document.getElementById('micro-app-host') as HTMLElement;
      const microBody = document.getElementById('micro-body') as HTMLElement;
      const pane = document.getElementById('pane') as HTMLElement;
      const toolbarBlock = document.getElementById('toolbar-block') as HTMLElement;
      const queryButton = document.getElementById('query-button') as HTMLElement;
      const overlay = document.createElement('visbug-hover');
      document.body.appendChild(overlay);

      const elements = [
        [microHost, new window.DOMRect(0, 0, 1200, 600)],
        [microAppHost, new window.DOMRect(0, 0, 1100, 500)],
        [microBody, new window.DOMRect(10, 10, 1000, 420)],
        [pane, new window.DOMRect(20, 20, 960, 380)],
        [toolbarBlock, new window.DOMRect(40, 40, 360, 80)],
        [queryButton, new window.DOMRect(48, 44, 88, 32)],
        [overlay, new window.DOMRect(48, 44, 88, 32)],
      ] as const;

      for (const [element, rect] of elements) {
        Object.defineProperty(element, 'getBoundingClientRect', {
          configurable: true,
          value: () => rect,
        });
      }

      document.elementFromPoint = vi.fn(() => microHost);
      Object.defineProperty(document, 'elementsFromPoint', {
        configurable: true,
        value: vi.fn(() => [overlay, microAppHost, microBody, toolbarBlock, queryButton, document.body]),
      });

      await withSelectableFixture(({ selectable }) => {
        dispatchMouse(microHost, 'mousedown', {
          clientX: 60,
          clientY: 52,
          button: 0,
        });
        dispatchMouse(microHost, 'click', {
          clientX: 60,
          clientY: 52,
          button: 0,
        });

        expect(selectable.selection()).toHaveLength(1);
        expect(selectable.selection()[0]).toBe(queryButton);
      });
    });

    it('prefers inner business elements over oversized main containers on the same hit point', async () => {
      document.documentElement.setAttribute(
        'data-webmcp-page-edit-config',
        JSON.stringify({ pageMode: 'live-page' }),
      );

      document.body.innerHTML = `
        <main id="main-shell">
          <section id="filter-bar">
            <button id="query-button">查询</button>
          </section>
        </main>
      `;

      const mainShell = document.getElementById('main-shell') as HTMLElement;
      const filterBar = document.getElementById('filter-bar') as HTMLElement;
      const queryButton = document.getElementById('query-button') as HTMLElement;

      const elements = [
        [mainShell, new window.DOMRect(0, 0, 1400, 900)],
        [filterBar, new window.DOMRect(120, 140, 420, 72)],
        [queryButton, new window.DOMRect(160, 156, 88, 32)],
      ] as const;

      for (const [element, rect] of elements) {
        Object.defineProperty(element, 'getBoundingClientRect', {
          configurable: true,
          value: () => rect,
        });
      }

      document.elementFromPoint = vi.fn(() => mainShell);
      Object.defineProperty(document, 'elementsFromPoint', {
        configurable: true,
        value: vi.fn(() => [mainShell, filterBar, queryButton, document.body, document.documentElement]),
      });

      await withSelectableFixture(({ selectable }) => {
        dispatchMouse(mainShell, 'mousedown', {
          clientX: 180,
          clientY: 168,
          button: 0,
        });
        dispatchMouse(mainShell, 'click', {
          clientX: 180,
          clientY: 168,
          button: 0,
        });

        expect(selectable.selection()).toHaveLength(1);
        expect(selectable.selection()[0]).toBe(queryButton);
      });
    });

    it('keeps descending through micro-app business containers until it reaches an inner control', async () => {
      document.documentElement.setAttribute(
        'data-webmcp-page-edit-config',
        JSON.stringify({ pageMode: 'live-page' }),
      );

      document.body.innerHTML = `
        <micro-app id="micro-app-host">
          <micro-app-body id="micro-body">
            <div id="otp-app">
              <section id="outer-section">
                <main id="inner-main">
                  <div id="layout-content">
                    <div id="toolbar-block">
                      <button id="query-button">查询</button>
                    </div>
                  </div>
                </main>
              </section>
            </div>
          </micro-app-body>
        </micro-app>
      `;

      const microAppHost = document.getElementById('micro-app-host') as HTMLElement;
      const microBody = document.getElementById('micro-body') as HTMLElement;
      const otpApp = document.getElementById('otp-app') as HTMLElement;
      const outerSection = document.getElementById('outer-section') as HTMLElement;
      const innerMain = document.getElementById('inner-main') as HTMLElement;
      const layoutContent = document.getElementById('layout-content') as HTMLElement;
      const toolbarBlock = document.getElementById('toolbar-block') as HTMLElement;
      const queryButton = document.getElementById('query-button') as HTMLElement;

      const elements = [
        [microAppHost, new window.DOMRect(0, 0, 1462, 476)],
        [microBody, new window.DOMRect(0, 0, 1462, 476)],
        [otpApp, new window.DOMRect(0, 0, 1462, 476)],
        [outerSection, new window.DOMRect(0, 0, 1462, 476)],
        [innerMain, new window.DOMRect(0, 0, 1420, 430)],
        [layoutContent, new window.DOMRect(20, 20, 1380, 390)],
        [toolbarBlock, new window.DOMRect(1040, 46, 220, 40)],
        [queryButton, new window.DOMRect(1054, 50, 72, 32)],
      ] as const;

      for (const [element, rect] of elements) {
        Object.defineProperty(element, 'getBoundingClientRect', {
          configurable: true,
          value: () => rect,
        });
      }

      document.elementFromPoint = vi.fn(() => outerSection);
      Object.defineProperty(document, 'elementsFromPoint', {
        configurable: true,
        value: vi.fn(() => [outerSection, innerMain, layoutContent, toolbarBlock, document.body]),
      });

      await withSelectableFixture(({ selectable }) => {
        dispatchMouse(outerSection, 'mousedown', {
          clientX: 1060,
          clientY: 60,
          button: 0,
        });
        dispatchMouse(outerSection, 'click', {
          clientX: 1060,
          clientY: 60,
          button: 0,
        });

        expect(selectable.selection()).toHaveLength(1);
        expect(selectable.selection()[0]).toBe(queryButton);
      });
    });

    it('promotes inline leaf hits inside a button to the button itself', async () => {
      document.documentElement.setAttribute(
        'data-webmcp-page-edit-config',
        JSON.stringify({ pageMode: 'live-page' }),
      );

      document.body.innerHTML = `
        <section id="panel">
          <button id="query-button" class="md-button md-button--primary">
            <i id="query-icon" class="el-icon-search"></i>
            <span id="query-text">查询</span>
          </button>
        </section>
      `;

      const panel = document.getElementById('panel') as HTMLElement;
      const queryButton = document.getElementById('query-button') as HTMLElement;
      const queryIcon = document.getElementById('query-icon') as HTMLElement;
      const queryText = document.getElementById('query-text') as HTMLElement;

      const elements = [
        [panel, new window.DOMRect(0, 0, 400, 200)],
        [queryButton, new window.DOMRect(100, 80, 96, 32)],
        [queryIcon, new window.DOMRect(110, 88, 14, 14)],
        [queryText, new window.DOMRect(132, 86, 32, 18)],
      ] as const;

      for (const [element, rect] of elements) {
        Object.defineProperty(element, 'getBoundingClientRect', {
          configurable: true,
          value: () => rect,
        });
      }

      document.elementFromPoint = vi.fn(() => queryIcon);
      Object.defineProperty(document, 'elementsFromPoint', {
        configurable: true,
        value: vi.fn(() => [queryIcon, queryButton, panel, document.body, document.documentElement]),
      });

      await withSelectableFixture(({ selectable }) => {
        dispatchMouse(queryIcon, 'mousedown', {
          clientX: 116,
          clientY: 94,
          button: 0,
        });
        dispatchMouse(queryIcon, 'click', {
          clientX: 116,
          clientY: 94,
          button: 0,
        });

        expect(selectable.selection()).toHaveLength(1);
        expect(selectable.selection()[0]).toBe(queryButton);
      });
    });

    it('clears the previous selection after SPA route changes', async () => {
      document.documentElement.setAttribute(
        'data-webmcp-page-edit-config',
        JSON.stringify({ pageMode: 'live-page' }),
      );

      document.body.innerHTML = `
        <aside>
          <span id="menu-entry">订单工作台-干线</span>
        </aside>
        <main>
          <button id="query-button">查询</button>
        </main>
      `;

      const menuEntry = document.getElementById('menu-entry') as HTMLElement;

      Object.defineProperty(menuEntry, 'getBoundingClientRect', {
        configurable: true,
        value: () => new window.DOMRect(0, 0, 180, 32),
      });

      document.elementFromPoint = vi.fn(() => menuEntry);

      await withSelectableFixture(({ selectable }) => {
        dispatchMouse(menuEntry, 'mousedown', {
          clientX: 12,
          clientY: 12,
          button: 0,
        });
        dispatchMouse(menuEntry, 'click', {
          clientX: 12,
          clientY: 12,
          button: 0,
        });

        expect(selectable.selection().map((element) => element.id)).toEqual(['menu-entry']);

        window.history.pushState({}, '', 'https://example.com/orders#/dispatch/single-list');

        expect(selectable.selection()).toHaveLength(0);
      });
    });

    it('renders tag + class metadata on selection while keeping action buttons', async () => {
      document.documentElement.setAttribute(
        'data-webmcp-page-edit-config',
        JSON.stringify({ pageMode: 'live-page' }),
      );

      await withSelectableFixture(({ selectable }) => {
        const target = document.querySelector('.status.active') as HTMLElement;

        selectable.select(target);

        const labels = Array.from(document.querySelectorAll('visbug-label'));
        expect(labels).toHaveLength(1);

        const shadow = (labels[0] as HTMLElement & { $shadow?: ShadowRoot }).$shadow;
        const actions = Array.from(
          shadow?.querySelectorAll('button[data-action]') ?? [],
        ).map((button) => button.getAttribute('data-action'));
        const visibleMetadata = Array.from(
          shadow?.querySelectorAll('.label-text a') ?? [],
        )
          .map((anchor) => anchor.textContent?.trim() ?? '')
          .filter(Boolean);

        expect(actions).toEqual([
          'send-selection',
          'select-parent',
          'capture-selection',
          'analyze-selection',
        ]);
        expect(visibleMetadata).toEqual(['span']);
      });
    });

    it('keeps a lightweight selected overlay without restoring handles', async () => {
      document.documentElement.setAttribute(
        'data-webmcp-page-edit-config',
        JSON.stringify({ pageMode: 'live-page' }),
      );

      await withSelectableFixture(({ selectable }) => {
        const target = document.querySelector('.status.active') as HTMLElement;

        selectable.select(target);

        expect(document.querySelectorAll('visbug-selected')).toHaveLength(1);
        expect(document.querySelectorAll('visbug-handles')).toHaveLength(0);
      });
    });

    it('does not show an extra hover frame inside the selected subtree on live pages', async () => {
      document.documentElement.setAttribute(
        'data-webmcp-page-edit-config',
        JSON.stringify({ pageMode: 'live-page' }),
      );

      await withSelectableFixture(({ selectable }) => {
        document.body.innerHTML = `
          <section id="card">
            <div id="cell"><span id="text" class="status active">美的热水器供应商</span></div>
          </section>
        `;

        const selectedTarget = document.getElementById('cell') as HTMLElement;
        const hoverTarget = document.getElementById('text') as HTMLElement;

        selectable.select(selectedTarget);
        document.elementFromPoint = vi.fn(() => hoverTarget);

        dispatchMouse(document.body, 'mousemove', {
          clientX: 20,
          clientY: 20,
        });

        expect(document.querySelectorAll('visbug-selected')).toHaveLength(1);
        expect(document.querySelectorAll('visbug-hover')).toHaveLength(0);
      });
    });

    it('does not create measurement or a second hover helper on hover', async () => {
      document.documentElement.setAttribute(
        'data-webmcp-page-edit-config',
        JSON.stringify({ pageMode: 'live-page' }),
      );

      await withSelectableFixture(({ selectable }) => {
        const selectedTarget = document.querySelector('.status.active') as HTMLElement;
        const hoverTarget = document.getElementById('card') as HTMLElement;

        selectable.select(selectedTarget);
        document.elementFromPoint = vi.fn(() => hoverTarget);

        dispatchMouse(document.body, 'mousemove', {
          clientX: 20,
          clientY: 20,
        });

        expect(document.querySelector('[data-measuring="true"]')).toBeNull();
        expect(document.querySelectorAll('visbug-hover')).toHaveLength(1);
        expect(document.querySelectorAll('visbug-distance')).toHaveLength(0);
      }, {
        activeTool: 'guides',
      });
    });

    it('does not show hover outlines while selection analysis guidance is active', async () => {
      document.documentElement.setAttribute(
        'data-webmcp-page-edit-config',
        JSON.stringify({ pageMode: 'live-page' }),
      );
      document.documentElement.setAttribute(
        'data-webmcp-page-edit-analysis-mode',
        'interactive',
      );

      try {
        await withSelectableFixture(({ selectable }) => {
          const hoverTarget = document.querySelector('.status.active') as HTMLElement;
          document.elementFromPoint = vi.fn(() => hoverTarget);

          dispatchMouse(document.body, 'mousemove', {
            clientX: 20,
            clientY: 20,
          });

          expect(document.querySelectorAll('visbug-hover')).toHaveLength(0);
          expect(document.querySelectorAll('visbug-label')).toHaveLength(0);
        });
      } finally {
        document.documentElement.removeAttribute('data-webmcp-page-edit-analysis-mode');
      }
    });

    it('does not re-enter normal selection mode while selection analysis guidance is active', async () => {
      document.documentElement.setAttribute(
        'data-webmcp-page-edit-config',
        JSON.stringify({ pageMode: 'live-page' }),
      );
      document.documentElement.setAttribute(
        'data-webmcp-page-edit-analysis-mode',
        'interactive',
      );

      try {
        await withSelectableFixture(({ selectable }) => {
          const target = document.querySelector('.status.active') as HTMLElement;

          dispatchMouse(target, 'mousedown', {
            clientX: 20,
            clientY: 20,
            button: 0,
          });
          dispatchMouse(target, 'click', {
            clientX: 20,
            clientY: 20,
            button: 0,
          });

          expect(selectable.selection()).toHaveLength(0);
          expect(document.querySelectorAll('visbug-selected')).toHaveLength(0);
          expect(document.querySelectorAll('visbug-label')).toHaveLength(0);
        });
      } finally {
        document.documentElement.removeAttribute('data-webmcp-page-edit-analysis-mode');
      }
    });

    it('honors policy-driven action bar visibility instead of relying on page mode defaults', async () => {
      vi.resetModules();
      vi.doMock('../../public/page-edit/vendor/app/features/selection-presentation.js', async () => {
        const actual = await vi.importActual<
          typeof import('../../public/page-edit/vendor/app/features/selection-presentation.js')
        >('../../public/page-edit/vendor/app/features/selection-presentation.js');

        return {
          ...actual,
          createSelectionPresentationPolicy() {
            return {
              kind: 'test-policy',
              showHoverLabel: false,
              showSelectionLabel: true,
              showSelectionMetadata: false,
              showMeasurement: false,
              showGridlines: false,
              showHandles: false,
              showActionBar: false,
            };
          },
        };
      });

      document.documentElement.setAttribute(
        'data-webmcp-page-edit-config',
        JSON.stringify({ pageMode: 'live-page' }),
      );

      try {
        await withSelectableFixture(({ selectable }) => {
          const target = document.querySelector('.status.active') as HTMLElement;
          selectable.select(target);

          const label = document.querySelector('visbug-label') as HTMLElement;
          const shadow = (label as HTMLElement & { $shadow?: ShadowRoot }).$shadow;
          const actions = shadow?.querySelectorAll('button[data-action]') ?? [];
          const visibleMetadata = Array.from(
            shadow?.querySelectorAll('.label-text a') ?? [],
          ).map((anchor) => anchor.textContent?.trim() ?? '');

          expect(actions).toHaveLength(0);
          expect(visibleMetadata).toEqual(['span']);
        });
      } finally {
        vi.doUnmock('../../public/page-edit/vendor/app/features/selection-presentation.js');
      }
    });
  });

  it('blocks destructive delete hotkey on live pages', async () => {
    document.documentElement.setAttribute(
      'data-webmcp-page-edit-config',
      JSON.stringify({ pageMode: 'live-page' }),
    );

    await withSelectableFixture(({ selectable }) => {
      document.body.innerHTML = `
        <section id="card"><span id="target" class="status">运单查询</span></section>
      `;
      const target = document.getElementById('target') as HTMLElement;
      selectable.select(target);

      dispatchKeyboard('keydown', { key: 'Delete', keyCode: 46 });
      dispatchKeyboard('keyup', { key: 'Delete', keyCode: 46 });

      expect(document.getElementById('target')).toBe(target);
      expect(document.querySelector('#card .status')?.textContent).toBe('运单查询');
    });
  });
});
