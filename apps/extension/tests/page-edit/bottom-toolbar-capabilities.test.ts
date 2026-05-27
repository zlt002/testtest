// @vitest-environment node

import { JSDOM } from 'jsdom';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

let dom: JSDOM;
let previousGlobals: Record<string, unknown>;

beforeAll(() => {
  dom = new JSDOM('<!doctype html><html><body></body></html>', {
    url: 'https://example.com/',
  });

  previousGlobals = {
    window: globalThis.window,
    document: globalThis.document,
    Element: globalThis.Element,
    HTMLElement: globalThis.HTMLElement,
    Node: globalThis.Node,
  };

  Object.assign(globalThis, {
    window: dom.window,
    document: dom.window.document,
    Element: dom.window.Element,
    HTMLElement: dom.window.HTMLElement,
    Node: dom.window.Node,
  });
});

afterAll(() => {
  dom.window.close();
  Object.assign(globalThis, previousGlobals);
});

describe('bottom toolbar capabilities', () => {
  it('marks table cells as unavailable for move, resize, margin, and reorder', async () => {
    const { getBottomToolbarAvailability } = await import(
      '../../public/page-edit/vendor/app/components/vis-bug/bottom-toolbar.capabilities.js'
    );

    document.body.innerHTML = '<table><tr><td id="cell">A</td></tr></table>';
    const cell = document.getElementById('cell') as HTMLElement;

    const availability = getBottomToolbarAvailability(cell);

    expect(availability.move.available).toBe(false);
    expect(availability.resize.available).toBe(false);
    expect(availability.margin.available).toBe(false);
    expect(availability.reorder.available).toBe(false);
    expect(availability.move.reason).toBe('当前元素不适合直接拖动位置');
  });

  it('allows text-oriented tools for plain text leaves', async () => {
    const { getBottomToolbarAvailability } = await import(
      '../../public/page-edit/vendor/app/components/vis-bug/bottom-toolbar.capabilities.js'
    );

    document.body.innerHTML = '<div id="text-node">Hello</div><div id="sibling"></div>';
    const textNode = document.getElementById('text-node') as HTMLElement;

    const availability = getBottomToolbarAvailability(textNode);

    expect(availability.content.available).toBe(true);
    expect(availability.typography.available).toBe(true);
    expect(availability.reorder.available).toBe(true);
  });
});
