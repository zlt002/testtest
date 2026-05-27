// @vitest-environment node

import { describe, expect, it } from 'vitest';

import { getAllowedWindowTakeoverNavigationsForExtensionTool } from './takeover-aware-extension-tool';

const activeTakeoverState = {
  sessionId: 'session-1',
  runId: 'run-1',
  windowId: 7,
  lockedTabId: 101,
  lockedUrl: 'https://example.com/current',
  status: 'active' as const,
  startedAt: 1_000,
};

describe('getAllowedWindowTakeoverNavigationsForExtensionTool', () => {
  it('allows AI createTab before a foreground tab switch', () => {
    const result = getAllowedWindowTakeoverNavigationsForExtensionTool(
      'extension_tool_tab_operations',
      {
        action: 'createTab',
        params: {
          url: 'https://example.com/new',
        },
      },
      activeTakeoverState,
      5_000
    );

    expect(result).toEqual([
      {
        windowId: 7,
        fromTabId: 101,
        reason: 'ai-tab-switch',
        expiresAt: 15_000,
      },
    ]);
  });

  it('allows AI updateTab activation and navigation on another tab', () => {
    const result = getAllowedWindowTakeoverNavigationsForExtensionTool(
      'extension_tool_tab_operations',
      {
        action: 'updateTab',
        params: {
          tabId: 202,
          active: true,
          url: 'https://example.com/target',
        },
      },
      activeTakeoverState,
      5_000
    );

    expect(result).toEqual([
      {
        windowId: 7,
        fromTabId: 101,
        toTabId: 202,
        reason: 'ai-tab-switch',
        expiresAt: 15_000,
      },
      {
        windowId: 7,
        toTabId: 202,
        reason: 'ai-navigation',
        expiresAt: 15_000,
      },
    ]);
  });

  it('allows AI reload on the locked tab', () => {
    const result = getAllowedWindowTakeoverNavigationsForExtensionTool(
      'extension_tool_tab_operations',
      {
        action: 'reloadTab',
        params: {},
      },
      activeTakeoverState,
      5_000
    );

    expect(result).toEqual([
      {
        windowId: 7,
        fromTabId: 101,
        toTabId: 101,
        reason: 'ai-refresh',
        expiresAt: 15_000,
      },
    ]);
  });

  it('allows search query when AI navigates the current tab', () => {
    const result = getAllowedWindowTakeoverNavigationsForExtensionTool(
      'extension_tool_search_query',
      {
        text: 'hello world',
      },
      activeTakeoverState,
      5_000
    );

    expect(result).toEqual([
      {
        windowId: 7,
        fromTabId: 101,
        toTabId: 101,
        reason: 'ai-navigation',
        expiresAt: 15_000,
      },
    ]);
  });

  it('does not allow unrelated tools or inactive takeover state', () => {
    expect(
      getAllowedWindowTakeoverNavigationsForExtensionTool(
        'extension_tool_storage_operations',
        {
          action: 'getStorage',
        },
        activeTakeoverState,
        5_000
      )
    ).toEqual([]);

    expect(
      getAllowedWindowTakeoverNavigationsForExtensionTool(
        'extension_tool_tab_operations',
        {
          action: 'createTab',
          params: {
            url: 'https://example.com/new',
          },
        },
        {
          ...activeTakeoverState,
          status: 'released',
        },
        5_000
      )
    ).toEqual([]);
  });
});
