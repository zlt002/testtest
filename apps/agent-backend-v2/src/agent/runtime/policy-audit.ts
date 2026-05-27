export type PolicyAuditEventType =
  | 'resource_misclassified'
  | 'wrong_primary_tool_attempted'
  | 'unsafe_fallback_attempted'
  | 'browser_context_mismatch'
  | 'visual_overuse_detected';

export type PolicyAuditEvent = {
  runId: string;
  type: PolicyAuditEventType;
  resourceKind?: string;
  toolName?: string;
  detail?: string;
  timestamp: string;
};

export function createPolicyAuditLog(runId: string) {
  const entries: PolicyAuditEvent[] = [];

  return {
    record(event: Omit<PolicyAuditEvent, 'runId' | 'timestamp'>) {
      entries.push({
        runId,
        timestamp: new Date().toISOString(),
        ...event,
      });
    },
    events() {
      return [...entries];
    },
  };
}

function formatContextValue(value: unknown): string {
  if (typeof value === 'number') {
    return String(value);
  }

  if (typeof value === 'string') {
    return `"${value}"`;
  }

  if (value === undefined) {
    return '缺失';
  }

  return String(value);
}

function numberArrayValues(value: unknown): number[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.filter((item): item is number => typeof item === 'number');
}

export function detectBrowserContextMismatch(
  browserContext:
    | {
        tabId?: unknown;
        windowId?: unknown;
        url?: unknown;
        allowedTabIds?: unknown;
        primaryTabId?: unknown;
      }
    | undefined,
  toolInput: { tabId?: unknown; windowId?: unknown } | undefined,
  options?: { requireExactContext?: boolean },
) {
  if (!browserContext) {
    return null;
  }

  const requireExactContext = options?.requireExactContext === true;
  const allowedTabIds = numberArrayValues(browserContext.allowedTabIds);
  const authorizedTabIds =
    allowedTabIds.length > 0
      ? allowedTabIds
      : typeof browserContext.tabId === 'number'
        ? [browserContext.tabId]
        : [];

  if (!toolInput) {
    if (requireExactContext) {
      if (typeof browserContext.tabId === 'number') {
        return {
          type: 'browser_context_mismatch' as const,
          detail: `当前标签页上下文字段无效：期望 tabId=${browserContext.tabId}，实际收到 tabId=缺失`,
        };
      }

      if (typeof browserContext.windowId === 'number') {
        return {
          type: 'browser_context_mismatch' as const,
          detail: `当前窗口上下文字段无效：期望 windowId=${browserContext.windowId}，实际收到 windowId=缺失`,
        };
      }
    }

    return null;
  }

  if (typeof browserContext.tabId === 'number' && typeof toolInput.tabId !== 'number') {
    if (requireExactContext) {
      return {
        type: 'browser_context_mismatch' as const,
        detail: `当前标签页上下文字段无效：期望 tabId=${browserContext.tabId}，实际收到 tabId=${formatContextValue(toolInput.tabId)}`,
      };
    }
  }

  if (typeof toolInput.tabId === 'number' && authorizedTabIds.length > 0) {
    if (!authorizedTabIds.includes(toolInput.tabId)) {
      return {
        type: 'browser_context_mismatch' as const,
        detail: `当前标签页未获授权：允许 tabId=${authorizedTabIds.join(', ')}，实际收到 tabId=${toolInput.tabId}`,
      };
    }
  } else if (
    typeof browserContext.tabId === 'number' &&
    typeof toolInput.tabId === 'number' &&
    browserContext.tabId !== toolInput.tabId
  ) {
    return {
      type: 'browser_context_mismatch' as const,
      detail: `当前标签页上下文不一致：期望 tabId=${browserContext.tabId}，实际收到 tabId=${toolInput.tabId}`,
    };
  }

  if (typeof browserContext.windowId === 'number' && typeof toolInput.windowId !== 'number') {
    if (requireExactContext) {
      return {
        type: 'browser_context_mismatch' as const,
        detail: `当前窗口上下文字段无效：期望 windowId=${browserContext.windowId}，实际收到 windowId=${formatContextValue(toolInput.windowId)}`,
      };
    }
  }

  if (
    typeof browserContext.windowId === 'number' &&
    typeof toolInput.windowId === 'number' &&
    browserContext.windowId !== toolInput.windowId
  ) {
    return {
      type: 'browser_context_mismatch' as const,
      detail: `当前窗口上下文不一致：期望 windowId=${browserContext.windowId}，实际收到 windowId=${toolInput.windowId}`,
    };
  }

  return null;
}
