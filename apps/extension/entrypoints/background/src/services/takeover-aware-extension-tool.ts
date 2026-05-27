import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import {
  type AllowedNavigation,
  type WindowTakeoverState,
  windowTakeoverService,
} from './window-takeover';

type ToolInput = Record<string, unknown> | undefined;

const WINDOW_TAKEOVER_NAVIGATION_TTL_MS = 10_000;

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : undefined;
}

function asString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim().length > 0 ? value : undefined;
}

function asNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function asBoolean(value: unknown): boolean | undefined {
  return typeof value === 'boolean' ? value : undefined;
}

function asNumberArray(value: unknown): number[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.filter((item): item is number => typeof item === 'number' && Number.isFinite(item));
}

function createAllowedNavigation(
  takeoverState: WindowTakeoverState,
  expiresAt: number,
  input: Omit<AllowedNavigation, 'windowId' | 'expiresAt'>
): AllowedNavigation {
  return {
    windowId: takeoverState.windowId,
    expiresAt,
    ...input,
  };
}

function getAllowedNavigationsForTabTool(
  takeoverState: WindowTakeoverState,
  input: ToolInput,
  expiresAt: number
): AllowedNavigation[] {
  const action = asString(input?.action);
  const params = asRecord(input?.params);

  if (!action) {
    return [];
  }

  switch (action) {
    case 'createTab': {
      const active = asBoolean(params?.active);
      if (active === false) {
        return [];
      }

      return [
        createAllowedNavigation(takeoverState, expiresAt, {
          fromTabId: takeoverState.lockedTabId,
          reason: 'ai-tab-switch',
        }),
      ];
    }
    case 'updateTab': {
      const targetTabId = asNumber(params?.tabId) ?? takeoverState.lockedTabId;
      const targetIsLockedTab = targetTabId === takeoverState.lockedTabId;
      const wantsActivation = asBoolean(params?.active) === true;
      const wantsNavigation = Boolean(asString(params?.url));
      const allowedNavigations: AllowedNavigation[] = [];

      if (wantsActivation && !targetIsLockedTab) {
        allowedNavigations.push(
          createAllowedNavigation(takeoverState, expiresAt, {
            fromTabId: takeoverState.lockedTabId,
            toTabId: targetTabId,
            reason: 'ai-tab-switch',
          })
        );
      }

      if (wantsNavigation) {
        allowedNavigations.push(
          createAllowedNavigation(takeoverState, expiresAt, {
            fromTabId: targetIsLockedTab ? takeoverState.lockedTabId : undefined,
            toTabId: targetTabId,
            reason: 'ai-navigation',
          })
        );
      }

      return allowedNavigations;
    }
    case 'navigateHistory': {
      const targetTabId = asNumber(input?.params && asRecord(input.params)?.tabId) ?? takeoverState.lockedTabId;
      return [
        createAllowedNavigation(takeoverState, expiresAt, {
          fromTabId: targetTabId === takeoverState.lockedTabId ? takeoverState.lockedTabId : undefined,
          toTabId: targetTabId,
          reason: 'ai-navigation',
        }),
      ];
    }
    case 'reloadTab': {
      const targetTabId = asNumber(input?.params && asRecord(input.params)?.tabId) ?? takeoverState.lockedTabId;
      return [
        createAllowedNavigation(takeoverState, expiresAt, {
          fromTabId: targetTabId === takeoverState.lockedTabId ? takeoverState.lockedTabId : undefined,
          toTabId: targetTabId,
          reason: 'ai-refresh',
        }),
      ];
    }
    case 'duplicateTab': {
      return [
        createAllowedNavigation(takeoverState, expiresAt, {
          fromTabId: takeoverState.lockedTabId,
          reason: 'ai-tab-switch',
        }),
      ];
    }
    case 'highlightTabs': {
      const paramsRecord = asRecord(input?.params);
      const tabIds = asNumberArray(paramsRecord?.tabs);
      const firstTabId = tabIds[0];

      if (typeof firstTabId !== 'number' || firstTabId === takeoverState.lockedTabId) {
        return [];
      }

      return [
        createAllowedNavigation(takeoverState, expiresAt, {
          fromTabId: takeoverState.lockedTabId,
          toTabId: firstTabId,
          reason: 'ai-tab-switch',
        }),
      ];
    }
    default:
      return [];
  }
}

function getAllowedNavigationsForSearchTool(
  takeoverState: WindowTakeoverState,
  input: ToolInput,
  expiresAt: number
): AllowedNavigation[] {
  const disposition = asString(input?.disposition);
  const targetTabId = asNumber(input?.tabId) ?? takeoverState.lockedTabId;

  if (disposition === 'NEW_TAB' || disposition === 'NEW_WINDOW') {
    return [];
  }

  return [
    createAllowedNavigation(takeoverState, expiresAt, {
      fromTabId: targetTabId === takeoverState.lockedTabId ? takeoverState.lockedTabId : undefined,
      toTabId: targetTabId,
      reason: 'ai-navigation',
    }),
  ];
}

function getAllowedNavigationsForRestoreSessionTool(
  takeoverState: WindowTakeoverState,
  expiresAt: number
): AllowedNavigation[] {
  return [
    createAllowedNavigation(takeoverState, expiresAt, {
      fromTabId: takeoverState.lockedTabId,
      reason: 'ai-tab-switch',
    }),
  ];
}

export function getAllowedWindowTakeoverNavigationsForExtensionTool(
  toolName: string,
  input: ToolInput,
  takeoverState: WindowTakeoverState | null,
  now: number = Date.now()
): AllowedNavigation[] {
  if (!takeoverState || takeoverState.status !== 'active') {
    return [];
  }

  const expiresAt = now + WINDOW_TAKEOVER_NAVIGATION_TTL_MS;

  switch (toolName) {
    case 'extension_tool_tab_operations':
      return getAllowedNavigationsForTabTool(takeoverState, input, expiresAt);
    case 'extension_tool_search_query':
      return getAllowedNavigationsForSearchTool(takeoverState, input, expiresAt);
    case 'extension_tool_restore_session':
      return getAllowedNavigationsForRestoreSessionTool(takeoverState, expiresAt);
    default:
      return [];
  }
}

export function createTakeoverAwareExtensionToolServer(server: McpServer): McpServer {
  return new Proxy(server, {
    get(target, property, receiver) {
      if (property !== 'registerTool') {
        return Reflect.get(target, property, receiver);
      }

      const registerTool = (name: string, config: unknown, handler: (...args: unknown[]) => unknown) => {
        const wrappedHandler = async (...args: unknown[]) => {
          const input = asRecord(args[0]) ?? {};
          const takeoverState = windowTakeoverService.getState();
          const allowedNavigations = getAllowedWindowTakeoverNavigationsForExtensionTool(
            name,
            input,
            takeoverState
          );

          for (const navigation of allowedNavigations) {
            windowTakeoverService.allowNavigation(navigation);
          }

          return handler(...args);
        };

        return target.registerTool(name, config as never, wrappedHandler as never);
      };

      return registerTool as unknown as McpServer['registerTool'];
    },
  });
}
