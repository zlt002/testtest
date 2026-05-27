// @vitest-environment node

import { describe, expect, it } from 'vitest';
import { buildSelectedTabsBrowserContext } from './selected-tab-context';

describe('buildSelectedTabsBrowserContext', () => {
  it('builds a multi-tab browser context with primary-tab compatibility', () => {
    const context = buildSelectedTabsBrowserContext({
      tabs: [
        {
          tabId: 11,
          windowId: 2,
          title: 'Baidu',
          url: 'https://www.baidu.com',
          content: 'hello',
        },
        {
          tabId: 12,
          windowId: 2,
          title: 'GitHub',
          url: 'https://github.com',
          content: 'world',
        },
      ],
      primaryTabId: 12,
    });

    expect(context).toMatchObject({
      windowId: 2,
      tabId: 12,
      primaryTabId: 12,
      title: 'GitHub',
      url: 'https://github.com',
      source: 'selected-tabs',
      allowedTabIds: [11, 12],
    });
    expect(context?.selectedTabs).toEqual([
      {
        tabId: 11,
        windowId: 2,
        title: 'Baidu',
        url: 'https://www.baidu.com',
        content: 'hello',
      },
      {
        tabId: 12,
        windowId: 2,
        title: 'GitHub',
        url: 'https://github.com',
        content: 'world',
      },
    ]);
  });

  it('keeps capture errors on individual selected tabs without dropping the bundle', () => {
    const context = buildSelectedTabsBrowserContext({
      tabs: [
        {
          tabId: 21,
          windowId: 8,
          title: 'Docs',
          url: 'https://example.com/docs',
          captureError: 'capture failed',
        },
      ],
      primaryTabId: null,
    });

    expect(context).toMatchObject({
      tabId: 21,
      primaryTabId: 21,
      allowedTabIds: [21],
      source: 'selected-tabs',
    });
    expect(context?.selectedTabs).toEqual([
      {
        tabId: 21,
        windowId: 8,
        title: 'Docs',
        url: 'https://example.com/docs',
        captureError: 'capture failed',
      },
    ]);
  });

  it('returns undefined when no selected tabs are available', () => {
    expect(buildSelectedTabsBrowserContext({ tabs: [], primaryTabId: null })).toBeUndefined();
  });
});
