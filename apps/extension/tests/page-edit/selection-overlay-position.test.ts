// @vitest-environment node

import { JSDOM } from 'jsdom';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import handleCss from '../../public/page-edit/vendor/app/components/selection/handles.element.css.js';
import boxModelCss from '../../public/page-edit/vendor/app/components/selection/box-model.element.css.js';
import distanceCss from '../../public/page-edit/vendor/app/components/selection/distance.element.css.js';
import gripCss from '../../public/page-edit/vendor/app/components/selection/grip.element.css.js';
import labelCss from '../../public/page-edit/vendor/app/components/selection/label.element.css.js';
import marqueeCss from '../../public/page-edit/vendor/app/components/selection/marquee.element.css.js';
import overlayCss from '../../public/page-edit/vendor/app/components/selection/overlay.element.css.js';
import selectedCss from '../../public/page-edit/vendor/app/components/selection/selected.element.css.js';

let dom: JSDOM;
let previousGlobals: Record<string, unknown>;

beforeAll(() => {
  dom = new JSDOM(`<!doctype html><html><body></body></html>`, {
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
    CustomEvent: globalThis.CustomEvent,
    CSSStyleSheet: globalThis.CSSStyleSheet,
    Document: globalThis.Document,
    CSS: globalThis.CSS,
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
    CSS: dom.window.CSS ?? { escape: (value: string) => value },
  });
});

beforeEach(() => {
  document.body.innerHTML = '<div data-label-id="node-1"></div>';

  Object.defineProperty(window, 'scrollX', {
    configurable: true,
    value: 240,
  });
  Object.defineProperty(window, 'scrollY', {
    configurable: true,
    value: 360,
  });
  Object.defineProperty(window, 'innerWidth', {
    configurable: true,
    value: 1280,
  });
  Object.defineProperty(window, 'requestAnimationFrame', {
    configurable: true,
    value: (callback: FrameRequestCallback) => {
      callback(0);
      return 1;
    },
  });
});

afterAll(() => {
  dom.window.close();
  Object.assign(globalThis, previousGlobals);
});

describe('selection overlay positioning', () => {
  it('keeps overlay styles fixed so they do not expand page scroll bounds', () => {
    expect(handleCss).toContain('position: fixed;');
    expect(boxModelCss).toContain('position: fixed;');
    expect(distanceCss).toContain('position: fixed;');
    expect(gripCss).toContain('translate(calc(50% - 10%), 6px)');
    expect(labelCss).toContain('position: fixed;');
    expect(marqueeCss).toContain('position: fixed;');
    expect(overlayCss).toContain('position: fixed;');
    expect(selectedCss).toContain('position: fixed;');
  });

  it('positions selected overlays with viewport coordinates only', async () => {
    const { Selected } = await import('../../public/page-edit/vendor/app/components/selection/selected.element.js');
    const { Handles } = await import('../../public/page-edit/vendor/app/components/selection/handles.element.js');
    const { Label } = await import('../../public/page-edit/vendor/app/components/selection/label.element.js');

    const source = document.querySelector('[data-label-id="node-1"]') as HTMLElement;
    source.getBoundingClientRect = () =>
      ({
        x: 12,
        y: 24,
        top: 24,
        left: 12,
        right: 212,
        bottom: 104,
        width: 200,
        height: 80,
      }) as DOMRect;

    const selected = new Selected();
    document.body.appendChild(selected);
    selected.position = { el: source, node_label_id: 'node-1' };

    const handles = new Handles();
    document.body.appendChild(handles);
    handles.position = { el: source, node_label_id: 'node-1' };

    const label = new Label();
    label.text = '<a node>div</a>';
    document.body.appendChild(label);
    label.position = {
      node_label_id: 'node-1',
      boundingRect: source.getBoundingClientRect(),
    };

    expect(selected.style.getPropertyValue('--top')).toBe('24px');
    expect(selected.style.getPropertyValue('--left')).toBe('12px');
    expect(handles.style.getPropertyValue('--top')).toBe('24px');
    expect(handles.style.getPropertyValue('--left')).toBe('12px');
    expect(label.style.getPropertyValue('--top')).toBe('24px');
    expect(label.style.getPropertyValue('--left')).toBe('11px');
  });

  it('repositions move-tool overlays on scroll even when they do not have a node label id', async () => {
    const { Grip } = await import('../../public/page-edit/vendor/app/components/selection/grip.element.js');
    const { Label } = await import('../../public/page-edit/vendor/app/components/selection/label.element.js');

    const source = document.createElement('div');
    document.body.appendChild(source);

    let rectTop = 40;
    let rectLeft = 18;
    source.getBoundingClientRect = () =>
      ({
        x: rectLeft,
        y: rectTop,
        top: rectTop,
        left: rectLeft,
        right: rectLeft + 300,
        bottom: rectTop + 120,
        width: 300,
        height: 120,
      }) as DOMRect;

    const grip = new Grip();
    document.body.appendChild(grip);
    grip.position = { el: source };

    const label = new Label();
    label.text = 'Drag Bounds';
    label.setAttribute('data-readonly-label', 'true');
    document.body.appendChild(label);
    label.position = {
      boundingRect: source.getBoundingClientRect(),
      sourceElement: source,
    };

    rectTop = 12;
    rectLeft = 6;
    window.dispatchEvent(new window.Event('scroll'));
    await Promise.resolve();

    expect(grip.style.getPropertyValue('--top')).toBe('12px');
    expect(grip.style.getPropertyValue('--left')).toBe('6px');
    expect(label.style.getPropertyValue('--top')).toBe('12px');
    expect(label.style.getPropertyValue('--left')).toBe('5px');
  });

  it('moves the selection label inside the box when the selected element is pinned to the viewport top', async () => {
    const { Label } = await import('../../public/page-edit/vendor/app/components/selection/label.element.js');

    const source = document.querySelector('[data-label-id="node-1"]') as HTMLElement;
    source.getBoundingClientRect = () =>
      ({
        x: 12,
        y: 4,
        top: 4,
        left: 12,
        right: 332,
        bottom: 124,
        width: 320,
        height: 120,
      }) as DOMRect;

    const label = new Label();
    label.text = '<a node>div</a>';
    document.body.appendChild(label);

    label.position = {
      node_label_id: 'node-1',
      boundingRect: source.getBoundingClientRect(),
    };

    expect(label.style.getPropertyValue('--translate-y')).toBe('1px');
    expect(label.getAttribute('data-inside-label')).toBe('true');
    expect(labelCss).toContain(':host([data-inside-label="true"]) > span.label-shell');
  });

  it('positions box-model and distance overlays with viewport coordinates only', async () => {
    const { BoxModel } = await import('../../public/page-edit/vendor/app/components/selection/box-model.element.js');
    const { Distance } = await import('../../public/page-edit/vendor/app/components/selection/distance.element.js');

    const source = document.querySelector('[data-label-id="node-1"]') as HTMLElement;
    source.getBoundingClientRect = () =>
      ({
        x: 12,
        y: 24,
        top: 24,
        left: 12,
        right: 212,
        bottom: 104,
        width: 200,
        height: 80,
      }) as DOMRect;

    const boxModel = new BoxModel();
    document.body.appendChild(boxModel);
    boxModel.position = {
      mode: 'padding',
      bounds: source.getBoundingClientRect(),
      sides: { top: 20, right: 10, bottom: 20, left: 10 },
      color: 'purple',
    };
    expect(document.querySelectorAll('visbug-distance')).toHaveLength(0);

    const distance = new Distance();
    document.body.appendChild(distance);
    distance.position = {
      line_model: { x: 44, y: 18, d: 20, q: 'top', v: true, color: 'purple' },
      node_label_id: 'node-1',
    };

    expect(boxModel.style.getPropertyValue('--top')).toBe('24px');
    expect(boxModel.style.getPropertyValue('--left')).toBe('12px');
    expect(distance.style.getPropertyValue('--top')).toBe('18px');
    expect(distance.style.getPropertyValue('--left')).toBe('44px');
  });

  it('keeps drag bounds label close to the container edge', async () => {
    await import('../../public/page-edit/vendor/app/components/selection/hover.element.js');
    await import('../../public/page-edit/vendor/app/components/selection/grip.element.js');
    await import('../../public/page-edit/vendor/app/components/selection/label.element.js');
    const { dragNDrop, clearListeners } = await import(
      '../../public/page-edit/vendor/app/features/move.js'
    );

    document.body.innerHTML = `
      <div id="parent">
        <div id="first"></div>
        <div id="second"></div>
      </div>
    `;

    const parent = document.getElementById('parent') as HTMLElement;
    const first = document.getElementById('first') as HTMLElement;

    parent.getBoundingClientRect = () =>
      ({
        x: 20,
        y: 30,
        top: 30,
        left: 20,
        right: 220,
        bottom: 130,
        width: 200,
        height: 100,
      }) as DOMRect;

    first.getBoundingClientRect = () =>
      ({
        x: 20,
        y: 30,
        top: 30,
        left: 20,
        right: 120,
        bottom: 80,
        width: 100,
        height: 50,
      }) as DOMRect;

    dragNDrop([first]);

    const label = document.querySelector('visbug-label') as HTMLElement;
    expect(label).toBeTruthy();
    expect(label.getAttribute('data-edge-attached-label')).toBe('true');
    expect(label.style.getPropertyValue('--stack-offset-y')).toBe('0px');
    expect(labelCss).toContain(':host([data-edge-attached-label="true"]) > span.label-shell');
    expect(labelCss).toContain('translateY(calc(-100% + 1px))');

    clearListeners();
  });
});
