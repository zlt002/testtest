import type {
  InteractionIntentKind,
  InteractionResourceKind,
} from './interaction-policy-classifier.ts';
import { detectBrowserContextMismatch } from './policy-audit.ts';

type PolicyBehavior = 'allow' | 'deny' | 'block';
export type PolicyReasonCode =
  | 'browser_context_mismatch'
  | 'file_requires_file_first'
  | 'unsafe_fallback_attempted'
  | 'wrong_primary_tool_attempted';

type ToolGroup =
  | 'browser_extension_read'
  | 'browser_extension_operate'
  | 'external_browser'
  | 'remote_fetch'
  | 'other';

export type PolicyDecision = {
  behavior: PolicyBehavior;
  message?: string;
  reasonCode?: PolicyReasonCode;
};

function groupOf(toolName: string): ToolGroup {
  const normalizedToolName = toolName.trim().toLowerCase();
  if (toolName === 'mcp__browser_extension__read_current_page_content') {
    return 'browser_extension_read';
  }

  if (toolName.startsWith('mcp__browser_extension__')) {
    return 'browser_extension_operate';
  }

  if (
    normalizedToolName.startsWith('mcp__playwright__') ||
    normalizedToolName.startsWith('mcp__plugin_playwright_playwright__') ||
    normalizedToolName.startsWith('mcp__browser__') ||
    normalizedToolName.startsWith('mcp__chrome__') ||
    normalizedToolName.startsWith('mcp_chrome') ||
    normalizedToolName.startsWith('mcp_browser') ||
    normalizedToolName.startsWith('chrome_') ||
    normalizedToolName.startsWith('browser_') ||
    normalizedToolName.includes('playwright') ||
    normalizedToolName.includes('devtools')
  ) {
    return 'external_browser';
  }

  if (toolName.startsWith('WebFetch') || toolName.startsWith('mcp__fetch__')) {
    return 'remote_fetch';
  }

  return 'other';
}

export function createInteractionPolicySession(input: {
  resourceKind: InteractionResourceKind;
  intentKind: InteractionIntentKind;
  browserContext?: Record<string, unknown>;
}) {
  let extensionPrimaryFailed = false;
  const deviationCounts = new Map<string, number>();

  function activeWebFirstHopMessage(): string {
    if (input.intentKind === 'visual_inspect') {
      return '当前网页视觉检查必须先使用当前浏览器扩展工具的读取工具，失败后才能降级。';
    }

    return '当前网页必须先使用当前浏览器扩展工具的读取工具，失败后才能降级。';
  }

  function deviationKey(group: ToolGroup): string {
    return `${input.resourceKind}:${group}`;
  }

  function deny(message: string, group: ToolGroup): PolicyDecision {
    const key = deviationKey(group);
    const count = (deviationCounts.get(key) || 0) + 1;
    deviationCounts.set(key, count);

    return {
      behavior: count >= 2 ? 'block' : 'deny',
      message: count >= 2 ? `${message}；已重复偏离主路径，请按当前策略执行。` : message,
    };
  }

  return {
    beforeToolUse(toolName: string, toolInput: Record<string, unknown>): PolicyDecision {
      const group = groupOf(toolName);
      if (group === 'external_browser') {
        return {
          behavior: 'block',
          message:
            '当前项目始终禁止外部浏览器自动化工具调用，请只使用浏览器扩展自身提供的标签页读取和操作能力。',
          reasonCode: 'unsafe_fallback_attempted',
        };
      }
      const mismatch = detectBrowserContextMismatch(
        input.browserContext as
          | {
              tabId?: unknown;
              windowId?: unknown;
              allowedTabIds?: unknown;
              primaryTabId?: unknown;
            }
          | undefined,
        toolInput as { tabId?: unknown; windowId?: unknown } | undefined,
        {
          requireExactContext:
            input.resourceKind === 'active_web_page' &&
            (group === 'browser_extension_read' || group === 'browser_extension_operate'),
        },
      );

      if (mismatch) {
        return {
          behavior: 'block',
          message: `当前 browser_context 与工具输入不一致：${mismatch.detail}`,
          reasonCode: 'browser_context_mismatch',
        };
      }

      if (input.resourceKind === 'local_file_url') {
        if (group === 'browser_extension_read') {
          return {
            ...deny('file:// 页面默认先读文件，再决定是否降级到页面读取或截图。', group),
            reasonCode: 'file_requires_file_first',
          };
        }

        if (group === 'external_browser' || group === 'remote_fetch') {
          return {
            ...deny('file:// 场景默认禁止直接跳到外部浏览器或远程抓取。', group),
            reasonCode: 'unsafe_fallback_attempted',
          };
        }
      }

      if (input.resourceKind === 'active_web_page') {
        if (group === 'remote_fetch' && !extensionPrimaryFailed) {
          return {
            ...deny(activeWebFirstHopMessage(), group),
            reasonCode: 'wrong_primary_tool_attempted',
          };
        }
      }

      return { behavior: 'allow' };
    },

    recordToolOutcome(result: {
      toolName: string;
      isError: boolean;
      result?: unknown;
    }) {
      const group = groupOf(result.toolName);

      if (
        input.resourceKind === 'active_web_page' &&
        group === 'browser_extension_read' &&
        result.isError
      ) {
        extensionPrimaryFailed = true;
      }
    },
  };
}
