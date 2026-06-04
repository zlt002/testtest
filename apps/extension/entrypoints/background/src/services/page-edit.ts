import {
  publishAgentV2ComposerAppend,
  publishAgentV2DomAnalysisSuggestion,
  publishAgentV2QuickActionFeedback,
} from '@/entrypoints/sidepanel/lib/agent-v2/session-selection';
import type { PickedElementContext } from '@/entrypoints/lib/page-picker';

import { ensureCompanionReady } from './NativeHostManager';
import {
  createPageAnnotationStore,
  normalizeSelectionTarget,
  type AnnotationPageType,
  type ElementAnnotation,
  type SelectionTarget,
} from './page-annotations';
import { capturePageToCurrentWorkspace } from './page-capture';
import {
  createPageEditFileSaveClient,
  fileUrlToLocalPath,
  savePageEditHtmlToFile,
} from './page-edit-file-save';
import {
  getPageModeCapabilities,
  getPageModeForUrl,
  type PageMode,
  type PageModeCapabilities,
} from './page-mode';
import { pageEditElementAnalysisService } from './page-edit-element-analysis';
import { createPageEditElementAnalysisSummaryBuilder } from './page-edit-element-analysis-summary';

export type PageEditStatus = 'activating' | 'active' | 'deactivating' | 'capturing' | 'saving';

export type PageEditState = {
  tabId: number;
  windowId: number;
  url: string;
  status: PageEditStatus;
  pageMode: PageMode;
  capabilities: PageModeCapabilities;
  sourcePageUrl?: string | null;
  sourcePageType?: AnnotationPageType | null;
  activatedAt?: number;
  selectionSessionNonce?: string;
  lastError?: string;
};

type ActiveTabLike = {
  id?: number;
  url?: string;
  windowId?: number;
};

type TabLike = ActiveTabLike;
type PendingPageEditSelectionAnalysis = {
  sessionId: string;
  tabId: number;
  windowId?: number;
  nonce: string;
  analysisMode: 'interactive' | 'display';
};

type ExecuteScriptInput = {
  target: {
    tabId: number;
  };
  args?: any[];
  files?: string[];
  func?: (...args: any[]) => unknown;
  world?: 'ISOLATED' | 'MAIN';
};

type PageEditDeps = {
  now?: () => number;
  createSessionNonce?: () => string;
  getActiveTab?: () => Promise<ActiveTabLike | undefined>;
  getTabById?: (tabId: number) => Promise<TabLike | undefined>;
  executeScript?: (input: ExecuteScriptInput) => Promise<unknown>;
};

type PageEditFileSaveInput = {
  pageUrl: string;
  html: string;
};

export type PageEditService = ReturnType<typeof createPageEditService>;

const PAGE_EDIT_INJECT_FILES = ['page-edit/inject.js'];
const PAGE_EDIT_EJECT_FILES = ['page-edit/eject.js'];
const PAGE_EDIT_EXECUTION_WORLD = 'MAIN' as const;

function writePageEditConfigToDocument(input?: {
  pageMode?: PageMode;
  selectionSessionNonce?: string;
}) {
  const configAttribute = 'data-webmcp-page-edit-config';
  const runtime = typeof browser === 'undefined' ? chrome : browser;
  const getUrl = runtime.runtime.getURL as (path: string) => string;
  const protocol = window.location.protocol;
  const pageMode =
    input?.pageMode ??
    (protocol === 'file:' ? 'local-snapshot' : /^https?:$/i.test(protocol) ? 'live-page' : 'unsupported');
  const config = {
    styleUrl: getUrl('page-edit/vendor/app/bundle.css'),
    moduleUrl: getUrl('page-edit/vendor/app/components/vis-bug/vis-bug.element.js'),
    tutsBaseUrl: getUrl('page-edit/vendor/app/tuts'),
    pageMode,
    selectionSessionNonce:
      typeof input?.selectionSessionNonce === 'string' ? input.selectionSessionNonce : null,
  };

  document.documentElement.setAttribute(configAttribute, JSON.stringify(config));
}

function clearPageEditConfigFromDocument() {
  const configAttribute = 'data-webmcp-page-edit-config';
  document.documentElement.removeAttribute(configAttribute);
}

function defaultGetActiveTab(): Promise<ActiveTabLike | undefined> {
  if (typeof chrome === 'undefined' || !chrome.tabs?.query) {
    return Promise.resolve(undefined);
  }

  return chrome.tabs
    .query({
      active: true,
      currentWindow: true,
    })
    .then(([activeTab]) => activeTab);
}

async function defaultExecuteScript(input: ExecuteScriptInput): Promise<unknown> {
  if (typeof chrome === 'undefined' || !chrome.scripting?.executeScript) {
    return undefined;
  }

  return chrome.scripting.executeScript(
    input as unknown as Parameters<typeof chrome.scripting.executeScript>[0]
  );
}

function defaultGetTabById(tabId: number): Promise<TabLike | undefined> {
  if (typeof chrome === 'undefined' || !chrome.tabs?.get) {
    return Promise.resolve(undefined);
  }

  return chrome.tabs.get(tabId).catch(() => undefined);
}

function defaultCreateSessionNonce(): string {
  if (typeof globalThis.crypto?.randomUUID === 'function') {
    return globalThis.crypto.randomUUID();
  }

  return `page-edit-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function defaultCreateAnnotationRecordId(): string {
  return defaultCreateSessionNonce();
}

const pendingPageEditSelectionAnalyses = new Map<string, PendingPageEditSelectionAnalysis>();

function rememberPendingPageEditSelectionAnalysis(input: PendingPageEditSelectionAnalysis) {
  pendingPageEditSelectionAnalyses.set(input.sessionId, input);
}

function getPendingPageEditSelectionAnalysis(sessionId: string) {
  return pendingPageEditSelectionAnalyses.get(sessionId) ?? null;
}

function clearPendingPageEditSelectionAnalysis(sessionId: string) {
  pendingPageEditSelectionAnalyses.delete(sessionId);
}

function listPendingPageEditSelectionAnalysesByTabId(tabId: number) {
  return Array.from(pendingPageEditSelectionAnalyses.values()).filter(
    (pending) => pending.tabId === tabId
  );
}

type PickedElementFramePathEntry = {
  selector: string | null;
  id: string | null;
  tagName: string;
};

function normalizeElementText(value: string | null | undefined): string {
  return String(value || '')
    .replace(/\s+/g, ' ')
    .trim();
}

function isHtmlElementNode(value: unknown): value is HTMLElement {
  return (
    !!value &&
    (value as { nodeType?: unknown }).nodeType === 1 &&
    typeof (value as { tagName?: unknown }).tagName === 'string'
  );
}

function resolveTargetInDocument(
  doc: Document,
  config: {
    selector: string | null;
    id: string | null;
    tagName: string;
    text?: string | null;
  }
): HTMLElement | null {
  if (config.selector) {
    try {
      const matched = doc.querySelector(config.selector);
      if (isHtmlElementNode(matched)) {
        return matched;
      }
    } catch {
      // Ignore invalid selectors and continue with other heuristics.
    }
  }

  if (config.id) {
    const matched = doc.getElementById(config.id);
    if (isHtmlElementNode(matched)) {
      return matched;
    }
  }

  const normalizedTargetText = normalizeElementText(config.text);
  if (normalizedTargetText) {
    const matched = Array.from(doc.querySelectorAll(config.tagName)).find(
      (candidate) =>
        isHtmlElementNode(candidate) &&
        normalizeElementText(candidate.innerText || candidate.textContent) === normalizedTargetText
    );
    if (isHtmlElementNode(matched)) {
      return matched;
    }
  }

  const fallback = doc.querySelector(config.tagName);
  return isHtmlElementNode(fallback) ? fallback : null;
}

function resolveFrameDocument(
  rootDocument: Document,
  framePath: PickedElementFramePathEntry[] | undefined
): Document | null {
  if (!framePath?.length) {
    return rootDocument;
  }

  let currentDocument: Document | null = rootDocument;
  for (const frameConfig of framePath) {
    if (!currentDocument) return null;

    const frameElement = resolveTargetInDocument(currentDocument, {
      selector: frameConfig.selector,
      id: frameConfig.id,
      tagName: frameConfig.tagName,
    });
    if (!isHtmlElementNode(frameElement) || frameElement.tagName.toLowerCase() !== 'iframe') {
      return null;
    }

    try {
      currentDocument = frameElement.contentDocument || frameElement.contentWindow?.document || null;
    } catch {
      return null;
    }
  }

  return currentDocument;
}

export async function armInteractiveSelectionAnalysis(input: {
  tabId: number;
  sessionId: string;
  nonce: string;
  targetElement: PickedElementContext;
  executeScript?: typeof defaultExecuteScript;
}) {
  const executeScript = input.executeScript ?? defaultExecuteScript;
  await executeScript({
    target: { tabId: input.tabId },
    world: 'ISOLATED',
    args: [
      {
        sessionId: input.sessionId,
        nonce: input.nonce,
        selector: input.targetElement.selector,
        id: input.targetElement.id,
        tagName: input.targetElement.tagName,
        text: input.targetElement.text,
        framePath: input.targetElement.framePath ?? [],
      },
    ],
    func: (config: {
      sessionId: string;
      nonce: string;
      selector: string | null;
      id: string | null;
      tagName: string;
      text: string | null;
      framePath: PickedElementFramePathEntry[];
    }) => {
      const normalizeText = (value: string | null | undefined) =>
        String(value || '')
          .replace(/\s+/g, ' ')
          .trim();
      const debugBadgeSelector = '[data-webmcp-page-edit-analysis-debug="true"]';
      const ensureDebugBadge = () => {
        let badge = document.querySelector(debugBadgeSelector) as HTMLDivElement | null;
        if (badge) {
          return badge;
        }

        badge = document.createElement('div');
        badge.setAttribute('data-webmcp-page-edit-analysis-debug', 'true');
        badge.style.position = 'fixed';
        badge.style.right = '16px';
        badge.style.bottom = '16px';
        badge.style.zIndex = '2147483647';
        badge.style.maxWidth = 'min(420px, calc(100vw - 32px))';
        badge.style.padding = '8px 10px';
        badge.style.borderRadius = '10px';
        badge.style.background = 'rgba(15, 23, 42, 0.92)';
        badge.style.color = '#fff';
        badge.style.font = '500 12px/1.45 -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", sans-serif';
        badge.style.boxShadow = '0 10px 24px rgba(15, 23, 42, 0.24)';
        badge.style.pointerEvents = 'none';
        badge.style.whiteSpace = 'pre-wrap';
        document.body.appendChild(badge);
        return badge;
      };
      const appendDebugBadgeText = (text: string) => {
        const badge = ensureDebugBadge();
        const lines = (badge.textContent || '')
          .split('\n')
          .filter(Boolean)
          .slice(0, 10);
        const nextLine = `${new Date().toLocaleTimeString('zh-CN', {
          hour12: false,
          hour: '2-digit',
          minute: '2-digit',
          second: '2-digit',
        })} ${text}`;
        const nextLines = ['分析调试', nextLine, ...lines.filter((line) => line !== '分析调试')].slice(
          0,
          8
        );
        badge.textContent = nextLines.join('\n');
      };
      const isElementNode = (value: unknown): value is HTMLElement =>
        !!value &&
        (value as { nodeType?: unknown }).nodeType === 1 &&
        typeof (value as { tagName?: unknown }).tagName === 'string';

      const resolveTargetInDoc = (
        doc: Document,
        targetConfig: {
          selector: string | null;
          id: string | null;
          tagName: string;
          text?: string | null;
        }
      ) => {
        if (targetConfig.selector) {
          try {
            const matched = doc.querySelector(targetConfig.selector);
            if (isElementNode(matched)) {
              return matched;
            }
          } catch {
            // Ignore invalid selectors and continue with other heuristics.
          }
        }

        if (targetConfig.id) {
          const matched = doc.getElementById(targetConfig.id);
          if (isElementNode(matched)) {
            return matched;
          }
        }

        const normalizedTargetText = normalizeText(targetConfig.text);
        if (normalizedTargetText) {
          const matched = Array.from(doc.querySelectorAll(targetConfig.tagName)).find(
            (candidate) =>
              isElementNode(candidate) &&
              normalizeText(candidate.innerText || candidate.textContent) === normalizedTargetText
          );
          if (isElementNode(matched)) {
            return matched;
          }
        }

        const fallback = doc.querySelector(targetConfig.tagName);
        return isElementNode(fallback) ? fallback : null;
      };

      const resolveFrameDoc = (rootDocument: Document, framePath: PickedElementFramePathEntry[]) => {
        let currentDocument: Document | null = rootDocument;
        for (const frameConfig of framePath) {
          if (!currentDocument) return null;
          const frameElement = resolveTargetInDoc(currentDocument, {
            selector: frameConfig.selector,
            id: frameConfig.id,
            tagName: frameConfig.tagName,
            text: null,
          });
          if (!isElementNode(frameElement) || frameElement.tagName.toLowerCase() !== 'iframe') {
            return null;
          }

          try {
            currentDocument = frameElement.contentDocument || frameElement.contentWindow?.document || null;
          } catch {
            return null;
          }
        }

        return currentDocument;
      };

      const matchesTarget = (startNode: EventTarget | null) => {
        let current = isElementNode(startNode) ? startNode : null;
        while (current) {
          if (config.selector) {
            try {
              if (current.matches(config.selector)) {
                return true;
              }
            } catch {
              // Ignore invalid selectors and fall through to other heuristics.
            }
          }

          if (config.id && current.id === config.id) {
            return true;
          }

          if (
            normalizeText(config.text) &&
            current.tagName.toLowerCase() === config.tagName.toLowerCase() &&
            normalizeText((current as HTMLElement).innerText || current.textContent) ===
              normalizeText(config.text)
          ) {
            return true;
          }

          if (current.tagName.toLowerCase() === config.tagName.toLowerCase()) {
            return true;
          }

          current = current.parentElement;
        }

        return false;
      };

      const isPageEditUiTarget = (startNode: EventTarget | null) => {
        let current = isElementNode(startNode) ? startNode : null;
        while (current) {
          const tagName = current.tagName.toLowerCase();
          if (
            tagName === 'vis-bug' ||
            tagName.startsWith('visbug-') ||
            current.getAttribute('data-webmcp-annotation-ui') === 'true'
          ) {
            return true;
          }

          current = current.parentElement;
        }

        return false;
      };

      const targetDocument = resolveFrameDoc(document, config.framePath) || document;
      const collectListenerDocuments = (rootDocument: Document) => {
        const visited = new Set<Document>();
        const queue: Document[] = [rootDocument];
        const documents: Document[] = [];

        while (queue.length > 0) {
          const currentDocument = queue.shift();
          if (!currentDocument || visited.has(currentDocument)) {
            continue;
          }

          visited.add(currentDocument);
          documents.push(currentDocument);

          const frameElements = Array.from(currentDocument.querySelectorAll('iframe'));
          for (const frameElement of frameElements) {
            try {
              const childDocument = frameElement.contentDocument || frameElement.contentWindow?.document;
              if (childDocument && !visited.has(childDocument)) {
                queue.push(childDocument);
              }
            } catch {
              // Ignore inaccessible subframes.
            }
          }
        }

        return documents;
      };
      const listenerDocuments = collectListenerDocuments(targetDocument);
      const listenerTargets = listenerDocuments.flatMap((listenerDocument) => {
        const targets: EventTarget[] = [listenerDocument];
        if (listenerDocument.defaultView) {
          targets.unshift(listenerDocument.defaultView);
        }
        return targets;
      });

      let completed = false;
      let pendingCompletionTimer: number | null = null;
      const cleanup = () => {
        if (pendingCompletionTimer !== null) {
          window.clearTimeout(pendingCompletionTimer);
          pendingCompletionTimer = null;
        }
        for (const listenerTarget of listenerTargets) {
          listenerTarget.removeEventListener('pointerdown', handler, true);
          listenerTarget.removeEventListener('mousedown', handler, true);
          listenerTarget.removeEventListener('click', handler, true);
        }
      };

      const resolveEventStartNode = (event: MouseEvent | PointerEvent) => {
        const path = typeof event.composedPath === 'function' ? event.composedPath() : [];
        const pathTarget = path.find(
          (entry) =>
            !!entry &&
            (entry as { nodeType?: unknown }).nodeType === 1 &&
            typeof (entry as { tagName?: unknown }).tagName === 'string'
        );
        return pathTarget ?? event.target;
      };

      const sendCompletion = (event: MouseEvent | PointerEvent, startNode: EventTarget | null) => {
        if (completed) {
          return;
        }

        completed = true;
        cleanup();
        const startLabel = isElementNode(startNode)
          ? `${startNode.tagName.toLowerCase()} ${normalizeText(startNode.innerText || startNode.textContent).slice(0, 24)}`
          : String(startNode);
        appendDebugBadgeText(`分析监听准备发送完成消息 | ${event.type} | ${startLabel}`);
        chrome.runtime
          .sendMessage({
            type: 'page_edit_selection_analysis_complete',
            payload: {
              sessionId: config.sessionId,
              nonce: config.nonce,
              trigger: 'interaction-complete',
            },
          })
          .then(() => {
            appendDebugBadgeText(`分析监听完成消息已发送 | ${event.type} | ${startLabel}`);
          })
          .catch((error) => {
            appendDebugBadgeText(
              `分析监听发送失败 | ${error instanceof Error ? error.message : String(error)}`
            );
          });
      };

      const handler = (event: MouseEvent | PointerEvent) => {
        if (completed) {
          return;
        }

        const startNode = resolveEventStartNode(event);
        const startLabel = isElementNode(startNode)
          ? `${startNode.tagName.toLowerCase()} ${normalizeText(startNode.innerText || startNode.textContent).slice(0, 24)}`
          : String(startNode);
        appendDebugBadgeText(`分析监听捕获 ${event.type} | ${startLabel}`);

        if (!matchesTarget(startNode) && isPageEditUiTarget(startNode)) {
          appendDebugBadgeText(`分析监听忽略 UI 事件 ${event.type} | ${startLabel}`);
          return;
        }

        if (event.type === 'click') {
          if (pendingCompletionTimer !== null) {
            window.clearTimeout(pendingCompletionTimer);
            pendingCompletionTimer = null;
          }
          appendDebugBadgeText(`分析监听立即收口 | click | ${startLabel}`);
          sendCompletion(event, startNode);
          return;
        }

        if (pendingCompletionTimer !== null) {
          return;
        }

        appendDebugBadgeText(`分析监听延迟收口 | ${event.type} | ${startLabel} | 320ms`);
        pendingCompletionTimer = window.setTimeout(() => {
          pendingCompletionTimer = null;
          sendCompletion(event, startNode);
        }, 320);
      };

      window.setTimeout(() => {
        for (const listenerTarget of listenerTargets) {
          listenerTarget.addEventListener('pointerdown', handler, true);
          listenerTarget.addEventListener('mousedown', handler, true);
          listenerTarget.addEventListener('click', handler, true);
        }
        appendDebugBadgeText(`分析监听已挂载 | 监听目标数: ${listenerTargets.length}`);
      }, 0);
    },
  });
}

export async function showSelectionAnalysisGuidance(input: {
  tabId: number;
  analysisMode: 'interactive' | 'display';
  targetElement: PickedElementContext;
  sessionId?: string;
  nonce?: string;
  executeScript?: typeof defaultExecuteScript;
}) {
  const executeScript = input.executeScript ?? defaultExecuteScript;
  await executeScript({
    target: { tabId: input.tabId },
    world: 'MAIN',
    args: [
      {
        analysisMode: input.analysisMode,
        selector: input.targetElement.selector,
        id: input.targetElement.id,
        tagName: input.targetElement.tagName,
        text: input.targetElement.text,
        framePath: input.targetElement.framePath ?? [],
        sessionId: typeof input.sessionId === 'string' ? input.sessionId : null,
        nonce: typeof input.nonce === 'string' ? input.nonce : null,
      },
    ],
    func: (config: {
      analysisMode: 'interactive' | 'display';
      selector: string | null;
      id: string | null;
      tagName: string;
      text: string | null;
      framePath: PickedElementFramePathEntry[];
      sessionId: string | null;
      nonce: string | null;
    }) => {
      const normalizeText = (value: string | null | undefined) =>
        String(value || '')
          .replace(/\s+/g, ' ')
          .trim();
      const isElementNode = (value: unknown): value is HTMLElement =>
        !!value &&
        (value as { nodeType?: unknown }).nodeType === 1 &&
        typeof (value as { tagName?: unknown }).tagName === 'string';

      const resolveTargetInDoc = (
        doc: Document,
        targetConfig: {
          selector: string | null;
          id: string | null;
          tagName: string;
          text?: string | null;
        }
      ) => {
        if (targetConfig.selector) {
          try {
            const matched = doc.querySelector(targetConfig.selector);
            if (isElementNode(matched)) {
              return matched;
            }
          } catch (_) {}
        }

        if (targetConfig.id) {
          const matched = doc.getElementById(targetConfig.id);
          if (isElementNode(matched)) {
            return matched;
          }
        }

        const normalizedTargetText = normalizeText(targetConfig.text);
        if (normalizedTargetText) {
          const matched = Array.from(doc.querySelectorAll(targetConfig.tagName)).find(
            (candidate) =>
              isElementNode(candidate) &&
              normalizeText(candidate.innerText || candidate.textContent) === normalizedTargetText
          );
          if (isElementNode(matched)) {
            return matched;
          }
        }

        const fallback = doc.querySelector(targetConfig.tagName);
        return isElementNode(fallback) ? fallback : null;
      };

      const resolveFrameDoc = (rootDocument: Document, framePath: PickedElementFramePathEntry[]) => {
        let currentDocument: Document | null = rootDocument;
        for (const frameConfig of framePath) {
          if (!currentDocument) return null;
          const frameElement = resolveTargetInDoc(currentDocument, {
            selector: frameConfig.selector,
            id: frameConfig.id,
            tagName: frameConfig.tagName,
            text: null,
          });
          if (!isElementNode(frameElement) || frameElement.tagName.toLowerCase() !== 'iframe') {
            return null;
          }

          try {
            currentDocument = frameElement.contentDocument || frameElement.contentWindow?.document || null;
          } catch (_) {
            return null;
          }
        }

        return currentDocument;
      };

      const root = document.querySelector('vis-bug[data-webmcp-page-edit-root="true"]');
      const guidanceSelector = '[data-webmcp-page-edit-analysis-guidance="true"]';
      const focusSelector = 'visbug-selected[data-webmcp-page-edit-analysis-focus="true"]';

      document.documentElement.setAttribute(
        'data-webmcp-page-edit-analysis-mode',
        config.analysisMode,
      );
      if (config.sessionId) {
        document.documentElement.setAttribute(
          'data-webmcp-page-edit-analysis-session-id',
          config.sessionId
        );
      } else {
        document.documentElement.removeAttribute('data-webmcp-page-edit-analysis-session-id');
      }
      if (config.nonce) {
        document.documentElement.setAttribute('data-webmcp-page-edit-analysis-nonce', config.nonce);
      } else {
        document.documentElement.removeAttribute('data-webmcp-page-edit-analysis-nonce');
      }
      document.documentElement.removeAttribute('data-webmcp-page-edit-analysis-complete');
      document.querySelectorAll(guidanceSelector).forEach((node) => node.remove());
      document.querySelectorAll(focusSelector).forEach((node) => node.remove());

      if (
        root instanceof HTMLElement &&
        typeof (root as { selectorEngine?: { unselect_all?: (input?: { silent?: boolean }) => void } })
          .selectorEngine?.unselect_all === 'function'
      ) {
        (root as {
          selectorEngine: { unselect_all: (input?: { silent?: boolean }) => void };
        }).selectorEngine.unselect_all({ silent: true });
      }

      const resolveTarget = () => {
        const targetDocument = resolveFrameDoc(document, config.framePath) || document;
        return resolveTargetInDoc(targetDocument, config);
      };

      const hint = document.createElement('div');
      hint.setAttribute('data-webmcp-page-edit-analysis-guidance', 'true');
      hint.style.position = 'fixed';
      hint.style.top = '16px';
      hint.style.left = '50%';
      hint.style.transform = 'translateX(-50%)';
      hint.style.zIndex = '2147483647';
      hint.style.maxWidth = 'min(720px, calc(100vw - 32px))';
      hint.style.padding = '10px 14px';
      hint.style.borderRadius = '12px';
      hint.style.background = 'rgba(17, 24, 39, 0.92)';
      hint.style.color = '#fff';
      hint.style.font = '600 13px/1.45 -apple-system, BlinkMacSystemFont, \"Segoe UI\", \"PingFang SC\", sans-serif';
      hint.style.boxShadow = '0 12px 28px rgba(15, 23, 42, 0.28)';
      hint.style.pointerEvents = 'none';
      hint.textContent =
        config.analysisMode === 'interactive'
          ? '已进入接口分析，请直接点击高亮元素完成一次真实交互。'
          : '已进入接口分析，请刷新页面或触发一次重载，系统会自动抓取候选请求。';
      document.body.appendChild(hint);

      if (config.analysisMode !== 'interactive') {
        return;
      }

      const target = resolveTarget();
      if (!target) {
        return;
      }

      const focus = document.createElement('visbug-selected');
      focus.setAttribute('data-webmcp-page-edit-analysis-focus', 'true');
      focus.style.pointerEvents = 'none';
      document.body.appendChild(focus);
      (focus as unknown as { position: { el: HTMLElement; node_label_id: string } }).position = {
        el: target,
        node_label_id: 'analysis-focus',
      };
    },
  });
}

async function clearSelectionAnalysisGuidance(input: {
  tabId: number;
  executeScript?: typeof defaultExecuteScript;
}) {
  const executeScript = input.executeScript ?? defaultExecuteScript;
  await executeScript({
    target: { tabId: input.tabId },
    world: 'MAIN',
    func: () => {
      document.documentElement.removeAttribute('data-webmcp-page-edit-analysis-mode');
      document.documentElement.removeAttribute('data-webmcp-page-edit-analysis-session-id');
      document.documentElement.removeAttribute('data-webmcp-page-edit-analysis-nonce');
      document.documentElement.removeAttribute('data-webmcp-page-edit-analysis-complete');
      document
        .querySelectorAll('[data-webmcp-page-edit-analysis-guidance="true"], visbug-selected[data-webmcp-page-edit-analysis-focus="true"]')
        .forEach((node) => node.remove());
    },
  });
}

async function appendPageEditAnalysisDebugLine(input: {
  tabId: number;
  text: string;
  executeScript?: typeof defaultExecuteScript;
}) {
  const executeScript = input.executeScript ?? defaultExecuteScript;
  await executeScript({
    target: { tabId: input.tabId },
    world: 'ISOLATED',
    args: [input.text],
    func: (text: string) => {
      const debugBadgeSelector = '[data-webmcp-page-edit-analysis-debug="true"]';
      let badge = document.querySelector(debugBadgeSelector) as HTMLDivElement | null;
      if (!badge) {
        badge = document.createElement('div');
        badge.setAttribute('data-webmcp-page-edit-analysis-debug', 'true');
        badge.style.position = 'fixed';
        badge.style.right = '16px';
        badge.style.bottom = '16px';
        badge.style.zIndex = '2147483647';
        badge.style.maxWidth = 'min(420px, calc(100vw - 32px))';
        badge.style.padding = '8px 10px';
        badge.style.borderRadius = '10px';
        badge.style.background = 'rgba(15, 23, 42, 0.92)';
        badge.style.color = '#fff';
        badge.style.font = '500 12px/1.45 -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", sans-serif';
        badge.style.boxShadow = '0 10px 24px rgba(15, 23, 42, 0.24)';
        badge.style.pointerEvents = 'none';
        badge.style.whiteSpace = 'pre-wrap';
        document.body.appendChild(badge);
      }

      const lines = (badge.textContent || '')
        .split('\n')
        .filter(Boolean)
        .slice(0, 10);
      const nextLine = `${new Date().toLocaleTimeString('zh-CN', {
        hour12: false,
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
      })} ${text}`;
      const nextLines = ['分析调试', nextLine, ...lines.filter((line) => line !== '分析调试')].slice(
        0,
        8
      );
      badge.textContent = nextLines.join('\n');
    },
  });
}

async function publishPageEditSelectionAnalysisResult(input: {
  pending: PendingPageEditSelectionAnalysis;
  completeSelectionAnalysis: typeof pageEditElementAnalysisService.completeSelectionAnalysis;
  publishDomAnalysisSuggestion: typeof publishAgentV2DomAnalysisSuggestion;
  publishComposerAppend: typeof publishAgentV2ComposerAppend;
  openSidePanel: (windowId: number) => Promise<void>;
  executeScript?: typeof defaultExecuteScript;
}) {
  const openSidePanelTask =
    typeof input.pending.windowId === 'number'
      ? input.openSidePanel(input.pending.windowId).catch(() => undefined)
      : undefined;
  const appendDebugLine = (text: string) =>
    appendPageEditAnalysisDebugLine({
      tabId: input.pending.tabId,
      text,
      executeScript: input.executeScript,
    }).catch(() => undefined);

  try {
    await appendDebugLine('分析收口开始');
    const completed = await input.completeSelectionAnalysis({
      sessionId: input.pending.sessionId,
      onProgress: (message) => appendDebugLine(`分析收口进度 | ${message}`),
    });
    await appendDebugLine(
      `分析收口完成 | hasCard=${completed.analysisCard ? 'yes' : 'no'} | hasMarkdown=${completed.markdown?.trim() ? 'yes' : 'no'}`
    );

    const publishTasks: Promise<unknown>[] = [];

    if (completed.analysisCard) {
      await appendDebugLine('开始发布页面分析建议卡');
      publishTasks.push(
        input.publishDomAnalysisSuggestion({
          card: completed.analysisCard,
          suggestedCommand: completed.suggestedCommand,
        })
      );
      publishTasks.push(
        input.publishComposerAppend({
          text: [
            '页面元素分析已完成，已生成页面分析建议卡。',
            completed.analysisCard.targetAction
              ? `目标操作：${completed.analysisCard.targetAction}`
              : null,
            completed.analysisCard.recommendedApi
              ? `候选接口：${completed.analysisCard.recommendedApi}`
              : null,
            completed.markdown?.trim() ? completed.markdown.trim() : null,
          ]
            .filter(Boolean)
            .join('\n'),
          source: 'page-edit:analyze-result',
        })
      );
    } else {
      await appendDebugLine('未生成页面分析建议卡，改为发布文本结果');
      publishTasks.push(
        input.publishComposerAppend({
          text: completed.markdown || '页面元素分析已完成，但暂未生成建议卡。',
          source: 'page-edit:analyze-result',
        })
      );
    }

    await Promise.allSettled([openSidePanelTask, ...publishTasks]);
    await appendDebugLine('分析结果发布流程结束');
  } catch (error) {
    await appendDebugLine(
      `分析收口失败 | ${error instanceof Error ? error.message : String(error)}`
    );
    const publishComposerAppendTask = input.publishComposerAppend({
      text: `页面元素分析收口失败：${error instanceof Error ? error.message : String(error)}`,
      source: 'page-edit:analyze-result',
    }).catch(() => undefined);

    await Promise.allSettled([openSidePanelTask, publishComposerAppendTask]);
  }
}

function applyPageEditSelectionSessionNonce(selectionSessionNonce: string) {
  const root = document.querySelector('vis-bug[data-webmcp-page-edit-root="true"]');
  if (
    !(root instanceof HTMLElement) ||
    typeof (root as { setSelectionBridgeNonce?: unknown }).setSelectionBridgeNonce !== 'function'
  ) {
    throw new Error('Page Edit Mode selection bridge is unavailable');
  }

  (root as unknown as { setSelectionBridgeNonce: (nonce: string) => void }).setSelectionBridgeNonce(
    selectionSessionNonce
  );
}

function isIgnorablePageEditScriptError(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }

  return (
    error.message.includes('No tab with id') ||
    error.message.includes('Cannot access contents of url') ||
    error.message.includes('The extensions gallery cannot be scripted') ||
    error.message.includes('Frame with ID 0 was removed')
  );
}

function isPageEditFileUrl(url: string | undefined): boolean {
  return typeof url === 'string' && url.startsWith('file://');
}

function isLocalSnapshotPageEditUrl(url: string | undefined): boolean {
  return getPageModeForUrl(url) === 'local-snapshot';
}

type PageEditRuntimeState = {
  active: boolean;
  pageMode: PageMode;
  pageUrl: string | null;
  selectionSessionNonce: string | null;
};

function inspectPageEditRuntimeInDocument(): PageEditRuntimeState {
  const configAttribute = 'data-webmcp-page-edit-config';
  const rootSelector = 'vis-bug[data-webmcp-page-edit-root="true"]';
  const protocol = window.location.protocol;
  let pageMode: PageMode =
    protocol === 'file:' ? 'local-snapshot' : /^https?:$/i.test(protocol) ? 'live-page' : 'unsupported';
  let selectionSessionNonce: string | null = null;
  let hasConfig = false;

  try {
    const rawConfig = document.documentElement.getAttribute(configAttribute);
    if (rawConfig) {
      hasConfig = true;
      const parsed = JSON.parse(rawConfig) as {
        pageMode?: unknown;
        selectionSessionNonce?: unknown;
      };
      if (
        parsed.pageMode === 'live-page' ||
        parsed.pageMode === 'local-snapshot' ||
        parsed.pageMode === 'unsupported'
      ) {
        pageMode = parsed.pageMode;
      }
      if (typeof parsed.selectionSessionNonce === 'string' && parsed.selectionSessionNonce.length > 0) {
        selectionSessionNonce = parsed.selectionSessionNonce;
      }
    }
  } catch {
    // Ignore malformed config and fall back to location-derived mode.
  }

  const hasRoot = document.querySelector(rootSelector) instanceof HTMLElement;

  return {
    active: hasConfig || hasRoot,
    pageMode,
    pageUrl: window.location.href,
    selectionSessionNonce,
  };
}

function readExecuteScriptResult<T>(result: unknown): T | null {
  if (!Array.isArray(result) || result.length === 0) {
    return null;
  }

  const firstEntry = result[0] as { result?: unknown } | undefined;
  return (firstEntry?.result as T | undefined) ?? null;
}

function getProjectPathFromPageUrl(pageUrl: string): string {
  const localPath = fileUrlToLocalPath(pageUrl);
  const projectPath = localPath.replace(/\/[^/]+$/, '') || '/';

  return /^[A-Za-z]:$/.test(projectPath) ? `${projectPath}/` : projectPath;
}

async function defaultSavePageEditFile(input: PageEditFileSaveInput): Promise<void> {
  const discovery = await ensureCompanionReady();
  const client = createPageEditFileSaveClient(discovery.agentBaseUrl);
  const pageMode = getPageModeForUrl(input.pageUrl);

  await savePageEditHtmlToFile(client, {
    projectPath:
      pageMode === 'local-snapshot' && /^file:/i.test(input.pageUrl)
        ? getProjectPathFromPageUrl(input.pageUrl)
        : undefined,
    pageUrl: input.pageUrl,
    html: input.html,
  });
}

function isNullableString(value: unknown): value is string | null {
  return value === null || typeof value === 'string';
}

function isAnnotationPageType(value: unknown): value is AnnotationPageType {
  return value === 'live-page' || value === 'local-snapshot';
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function isPickedElementContext(value: unknown): value is PickedElementContext {
  if (!value || typeof value !== 'object') {
    return false;
  }

  const candidate = value as Partial<PickedElementContext>;
  return (
    typeof candidate.url === 'string' &&
    isNullableString(candidate.selector) &&
    isNullableString(candidate.xpath) &&
    typeof candidate.tagName === 'string' &&
    isNullableString(candidate.id) &&
    Array.isArray(candidate.classList) &&
    candidate.classList.every((item) => typeof item === 'string') &&
    !!candidate.rect &&
    typeof candidate.rect.x === 'number' &&
    typeof candidate.rect.y === 'number' &&
    typeof candidate.rect.width === 'number' &&
    typeof candidate.rect.height === 'number'
  );
}

function summarizePickedElementContext(target: PickedElementContext): string {
  const selector = target.selector?.trim();
  if (selector) {
    return selector;
  }

  const xpath = target.xpath?.trim();
  if (xpath) {
    return xpath;
  }

  const id = target.id?.trim();
  if (id) {
    return `${target.tagName}#${id}`;
  }

  const classSuffix = target.classList.length > 0 ? `.${target.classList.join('.')}` : '';
  const text = target.text?.trim();
  if (text) {
    return `${target.tagName}${classSuffix} 文本: ${text}`;
  }

  return `${target.tagName}${classSuffix}`;
}

function toAnnotationPageType(pageMode: PageMode): AnnotationPageType | null {
  if (pageMode === 'live-page' || pageMode === 'local-snapshot') {
    return pageMode;
  }

  return null;
}

function normalizeRestoredSelectionTarget(value: unknown): SelectionTarget | null {
  if (!value || typeof value !== 'object') {
    return null;
  }

  const candidate = value as Partial<SelectionTarget>;
  if (
    typeof candidate.targetId !== 'string' ||
    typeof candidate.pageUrl !== 'string' ||
    !isAnnotationPageType(candidate.pageType) ||
    !isFiniteNumber(candidate.createdAt)
  ) {
    return null;
  }

  return normalizeSelectionTarget({
    target: candidate,
    targetId: candidate.targetId,
    pageUrl: candidate.pageUrl,
    pageType: candidate.pageType,
    createdAt: candidate.createdAt,
  });
}

function normalizeRestoredAnnotation(value: unknown): ElementAnnotation | null {
  if (!value || typeof value !== 'object') {
    return null;
  }

  const candidate = value as Partial<ElementAnnotation>;
  if (
    typeof candidate.annotationId !== 'string' ||
    typeof candidate.targetId !== 'string' ||
    typeof candidate.content !== 'string' ||
    !isFiniteNumber(candidate.createdAt) ||
    !isFiniteNumber(candidate.updatedAt) ||
    typeof candidate.sourcePageUrl !== 'string' ||
    !isAnnotationPageType(candidate.sourcePageType) ||
    (candidate.status !== 'draft' && candidate.status !== 'sent' && candidate.status !== 'captured')
  ) {
    return null;
  }

  return {
    annotationId: candidate.annotationId,
    targetId: candidate.targetId,
    content: candidate.content,
    createdAt: candidate.createdAt,
    updatedAt: candidate.updatedAt,
    sourcePageUrl: candidate.sourcePageUrl,
    sourcePageType: candidate.sourcePageType,
    status: candidate.status,
  };
}

function areSamePageIdentity(urls: Array<string | undefined>): urls is [string, string, string, string] {
  return urls.every((url): url is string => typeof url === 'string') && new Set(urls).size === 1;
}

export let pageAnnotationStore = createPageAnnotationStore();

export function resetPageAnnotationStoreForTests() {
  pageAnnotationStore = createPageAnnotationStore();
}

export function isSupportedPageEditUrl(url: string | undefined): boolean {
  return getPageModeForUrl(url) !== 'unsupported';
}

export function createPageEditService(deps: PageEditDeps = {}) {
  const now = deps.now ?? Date.now;
  const createSessionNonce = deps.createSessionNonce ?? defaultCreateSessionNonce;
  const getActiveTab = deps.getActiveTab ?? defaultGetActiveTab;
  const getTabById = deps.getTabById ?? defaultGetTabById;
  const executeScript = deps.executeScript ?? defaultExecuteScript;
  const states = new Map<number, PageEditState>();
  const operations = new Map<number, Promise<PageEditState | null>>();

  const clearState = (tabId: number) => {
    states.delete(tabId);
    pageAnnotationStore.clearTab(tabId);
    return null;
  };

  const setState = (tabId: number, nextState: PageEditState) => {
    states.set(tabId, nextState);
    return nextState;
  };

  const inspectTabRuntime = async (tabId: number) => {
    const result = await executeScript({
      target: { tabId },
      func: inspectPageEditRuntimeInDocument,
      world: 'ISOLATED',
    });

    return readExecuteScriptResult<PageEditRuntimeState>(result);
  };

  const ejectPageEditFromTab = async (tabId: number) => {
    await executeScript({
      target: { tabId },
      files: PAGE_EDIT_EJECT_FILES,
      world: PAGE_EDIT_EXECUTION_WORLD,
    });
    await executeScript({
      target: { tabId },
      func: clearPageEditConfigFromDocument,
      world: 'ISOLATED',
    });
  };

  const runExclusive = (tabId: number, operation: () => Promise<PageEditState | null>) => {
    const inFlight = operations.get(tabId);
    if (inFlight) {
      return inFlight;
    }

    const promise = operation().finally(() => {
      if (operations.get(tabId) === promise) {
        operations.delete(tabId);
      }
    });

    operations.set(tabId, promise);
    return promise;
  };

  return {
    async activateForActiveTab() {
      const activeTab = await getActiveTab();
      if (
        activeTab?.id == null ||
        activeTab.windowId == null ||
        !isSupportedPageEditUrl(activeTab.url)
      ) {
        throw new Error('当前页面不支持网页编辑');
      }

      const currentState = states.get(activeTab.id);
      if (currentState?.status === 'active') {
        return currentState;
      }

      return runExclusive(activeTab.id, async () => {
        const selectionSessionNonce = createSessionNonce();
        const tabId = activeTab.id as number;
        const windowId = activeTab.windowId as number;
        const url = activeTab.url ?? '';
        const pageMode = getPageModeForUrl(url);
        const capabilities = getPageModeCapabilities(pageMode);

        setState(tabId, {
          tabId,
          windowId,
          url,
          status: 'activating',
          pageMode,
          capabilities,
          sourcePageUrl: url,
          sourcePageType: toAnnotationPageType(pageMode),
          selectionSessionNonce,
        });

        try {
          await executeScript({
            target: { tabId },
            args: [
              {
                pageMode,
                selectionSessionNonce,
              },
            ],
            func: writePageEditConfigToDocument,
            world: 'ISOLATED',
          });
          await executeScript({
            target: { tabId },
            files: PAGE_EDIT_INJECT_FILES,
            world: PAGE_EDIT_EXECUTION_WORLD,
          });
          await executeScript({
            target: { tabId },
            args: [selectionSessionNonce],
            func: applyPageEditSelectionSessionNonce,
            world: PAGE_EDIT_EXECUTION_WORLD,
          });
        } catch (error) {
          clearState(tabId);
          throw error;
        }

        const restoredState = states.get(tabId);
        return setState(tabId, {
          tabId,
          windowId,
          url,
          status: 'active',
          pageMode,
          capabilities,
          sourcePageUrl: restoredState?.sourcePageUrl ?? url,
          sourcePageType: restoredState?.sourcePageType ?? toAnnotationPageType(pageMode),
          activatedAt: now(),
          selectionSessionNonce,
        });
      });
    },

    async deactivateForTab(tabId: number) {
      return runExclusive(tabId, async () => {
        const currentState = states.get(tabId);
        let shouldAttemptEject = !!currentState;

        if (currentState) {
          setState(tabId, {
            ...currentState,
            status: 'deactivating',
          });
        } else {
          try {
            const runtimeState = await inspectTabRuntime(tabId);
            shouldAttemptEject = runtimeState?.active === true;
          } catch (error) {
            if (!isIgnorablePageEditScriptError(error)) {
              throw error;
            }
          }
        }

        if (!shouldAttemptEject) {
          return clearState(tabId);
        }

        try {
          await ejectPageEditFromTab(tabId);
        } catch (error) {
          clearState(tabId);
          if (!isIgnorablePageEditScriptError(error)) {
            throw error;
          }
        }

        return clearState(tabId);
      });
    },

    async toggleForActiveTab() {
      const activeTab = await getActiveTab();
      if (activeTab?.id != null && states.get(activeTab.id)?.status === 'active') {
        return this.deactivateForTab(activeTab.id);
      }

      return this.activateForActiveTab();
    },

    getState(tabId: number) {
      return states.get(tabId) ?? null;
    },

    async getStateForTab(tabId: number) {
      const currentState = states.get(tabId);

      try {
        const runtimeState = await inspectTabRuntime(tabId);
        if (!runtimeState?.active) {
          if (currentState) {
            return clearState(tabId);
          }
          return null;
        }

        const tab = await getTabById(tabId);
        const url = tab?.url ?? runtimeState.pageUrl ?? currentState?.url ?? '';
        const pageMode = runtimeState.pageMode;
        const capabilities = getPageModeCapabilities(pageMode);

        if (currentState?.status === 'deactivating') {
          return setState(tabId, {
            ...currentState,
            url,
            pageMode,
            capabilities,
            selectionSessionNonce: runtimeState.selectionSessionNonce ?? currentState.selectionSessionNonce,
          });
        }

        if (!currentState) {
          return setState(tabId, {
            tabId,
            windowId: tab?.windowId ?? -1,
            url,
            status: 'active',
            pageMode,
            capabilities,
            sourcePageUrl: url,
            sourcePageType: toAnnotationPageType(pageMode),
            activatedAt: now(),
            selectionSessionNonce: runtimeState.selectionSessionNonce ?? undefined,
          });
        }

        return setState(tabId, {
          ...currentState,
          status: 'active',
          url,
          pageMode,
          capabilities,
          selectionSessionNonce: runtimeState.selectionSessionNonce ?? currentState.selectionSessionNonce,
        });
      } catch (error) {
        if (currentState && isIgnorablePageEditScriptError(error)) {
          return clearState(tabId);
        }

        throw error;
      }
    },

    restoreWorkbenchState(
      tabId: number,
      input: {
        sourcePageUrl: string | null;
        sourcePageType: AnnotationPageType | null;
      }
    ) {
      const currentState = states.get(tabId);
      if (currentState?.status !== 'active' && currentState?.status !== 'activating') {
        return null;
      }

      return setState(tabId, {
        ...currentState,
        sourcePageUrl: input.sourcePageUrl,
        sourcePageType: input.sourcePageType,
      });
    },

    handleTabUpdated(input: { tabId: number; url?: string; status?: string }) {
      const currentState = states.get(input.tabId);
      if (!currentState) {
        return null;
      }

      const urlChanged = typeof input.url === 'string' && input.url !== currentState.url;
      const startedNavigation = input.status === 'loading';
      if (!urlChanged && !startedNavigation) {
        return currentState;
      }

      return clearState(input.tabId);
    },

    handleTabRemoved(input: { tabId: number }) {
      if (!states.has(input.tabId)) {
        return null;
      }

      return clearState(input.tabId);
    },

    clearState,
  };
}

export function createPageEditCommandListener(
  service: Pick<PageEditService, 'toggleForActiveTab'>
) {
  return async (command: string) => {
    if (command !== 'toggle-page-edit') {
      return;
    }

    await service.toggleForActiveTab();
  };
}

export function createPageEditSelectionMessageListener(input: {
  getActiveTab?: () => Promise<ActiveTabLike | undefined>;
  getPageEditState?: (tabId: number) => PageEditState | null;
  publishComposerAppend?: typeof publishAgentV2ComposerAppend;
  openSidePanel?: (windowId: number) => Promise<void>;
}) {
  const getActiveTab = input.getActiveTab ?? defaultGetActiveTab;
  const getPageEditState =
    input.getPageEditState ?? ((tabId: number) => pageEditService.getState(tabId));
  const publishComposerAppend = input.publishComposerAppend ?? publishAgentV2ComposerAppend;
  const openSidePanel =
    input.openSidePanel ?? ((windowId: number) => chrome.sidePanel.open({ windowId }));

  return (message: unknown, sender?: chrome.runtime.MessageSender) => {
    if (
      !message ||
      typeof message !== 'object' ||
      (message as { type?: unknown }).type !== 'page_edit_selection_append'
    ) {
      return false;
    }

    const payload = (
      message as {
        payload?: { nonce?: unknown; text?: unknown; source?: unknown };
      }
    ).payload;
    if (
      !payload ||
      typeof payload.nonce !== 'string' ||
      typeof payload.text !== 'string' ||
      (payload.source !== 'file' && payload.source !== 'live-page')
    ) {
      return false;
    }

    const tabId = sender?.tab?.id;
    if (typeof tabId !== 'number') {
      return false;
    }

    const currentState = getPageEditState(tabId);
    if (
      currentState?.status !== 'active' ||
      typeof currentState.selectionSessionNonce !== 'string' ||
      currentState.selectionSessionNonce !== payload.nonce
    ) {
      return false;
    }

    const windowId = sender?.tab?.windowId;
    const appendText = payload.text;
    const appendSource = payload.source;
    void (async () => {
      const activeTab = await getActiveTab();
      if (activeTab?.id !== tabId || activeTab.windowId !== windowId) {
        return;
      }

      const openSidePanelTask =
        typeof windowId === 'number' ? openSidePanel(windowId).catch(() => undefined) : undefined;
      const publishComposerAppendTask = publishComposerAppend({
        text: appendText,
        source: `page-edit:${appendSource}`,
      });

      await Promise.allSettled([openSidePanelTask, publishComposerAppendTask]);
    })().catch(() => undefined);

    return false;
  };
}

export function createPageEditSelectionCaptureMessageListener(input: {
  getActiveTab?: () => Promise<ActiveTabLike | undefined>;
  getPageEditState?: (tabId: number) => PageEditState | null;
  captureToWorkspace?: typeof capturePageToCurrentWorkspace;
  annotationStore?: Pick<typeof pageAnnotationStore, 'listTargets' | 'listAnnotations'>;
  publishQuickActionFeedback?: typeof publishAgentV2QuickActionFeedback;
  openSidePanel?: (windowId: number) => Promise<void>;
}) {
  const getActiveTab = input.getActiveTab ?? defaultGetActiveTab;
  const getPageEditState =
    input.getPageEditState ?? ((tabId: number) => pageEditService.getState(tabId));
  const captureToWorkspace = input.captureToWorkspace ?? capturePageToCurrentWorkspace;
  const annotationStore = input.annotationStore ?? pageAnnotationStore;
  const publishQuickActionFeedback =
    input.publishQuickActionFeedback ?? publishAgentV2QuickActionFeedback;
  const openSidePanel =
    input.openSidePanel ?? ((windowId: number) => chrome.sidePanel.open({ windowId }));

  return (message: unknown, sender?: chrome.runtime.MessageSender) => {
    if (
      !message ||
      typeof message !== 'object' ||
      (message as { type?: unknown }).type !== 'page_edit_selection_capture'
    ) {
      return false;
    }

    const payload = (
      message as {
        payload?: { nonce?: unknown; target?: unknown };
      }
    ).payload;
    if (!payload || typeof payload.nonce !== 'string' || !isPickedElementContext(payload.target)) {
      return false;
    }

    const target = payload.target;
    const tabId = sender?.tab?.id;
    if (typeof tabId !== 'number') {
      return false;
    }

    const currentState = getPageEditState(tabId);
    if (
      currentState?.status !== 'active' ||
      typeof currentState.selectionSessionNonce !== 'string' ||
      currentState.selectionSessionNonce !== payload.nonce
    ) {
      return false;
    }

    const windowId = sender?.tab?.windowId;
    void (async () => {
      const activeTab = await getActiveTab();
      if (activeTab?.id !== tabId || activeTab.windowId !== windowId) {
        return;
      }

      try {
        const sourcePageType =
          currentState.sourcePageType ?? toAnnotationPageType(currentState.pageMode);
        const result = await captureToWorkspace({
          mode: 'element',
          target,
          workbench: {
            sourcePageUrl: currentState.sourcePageUrl ?? currentState.url,
            sourcePageType,
            targets: annotationStore.listTargets(tabId),
            annotations: annotationStore.listAnnotations(tabId),
          },
        });
        const openSidePanelTask =
          typeof windowId === 'number' ? openSidePanel(windowId).catch(() => undefined) : undefined;
        const publishQuickActionFeedbackTask = publishQuickActionFeedback({
          kind: 'success',
          message: '网页已保存到',
          entryPath: result.entryPath,
          source: 'page-edit:capture',
        });

        await Promise.allSettled([openSidePanelTask, publishQuickActionFeedbackTask]);
      } catch (error) {
        await publishQuickActionFeedback({
          kind: 'error',
          message: '采集选中内容失败：' + (error instanceof Error ? error.message : String(error)),
          source: 'page-edit:capture',
        }).catch(() => undefined);
      }
    })().catch(() => undefined);

    return false;
  };
}

export function createPageEditSelectionAnalyzeMessageListener(input: {
  getActiveTab?: () => Promise<ActiveTabLike | undefined>;
  getPageEditState?: (tabId: number) => PageEditState | null;
  startSelectionAnalysis?: typeof pageEditElementAnalysisService.startSelectionAnalysis;
  cancelSelectionAnalysis?: typeof pageEditElementAnalysisService.cancelSelectionAnalysis;
  armInteractiveSelectionAnalysis?: typeof armInteractiveSelectionAnalysis;
  showSelectionAnalysisGuidance?: typeof showSelectionAnalysisGuidance;
  rememberPendingSelectionAnalysis?: (input: PendingPageEditSelectionAnalysis) => void;
  clearPendingSelectionAnalysis?: (sessionId: string) => void;
  publishComposerAppend?: typeof publishAgentV2ComposerAppend;
  openSidePanel?: (windowId: number) => Promise<void>;
}) {
  const getActiveTab = input.getActiveTab ?? defaultGetActiveTab;
  const getPageEditState =
    input.getPageEditState ?? ((tabId: number) => pageEditService.getState(tabId));
  const startSelectionAnalysis =
    input.startSelectionAnalysis ?? pageEditElementAnalysisService.startSelectionAnalysis;
  const cancelSelectionAnalysis =
    input.cancelSelectionAnalysis ?? pageEditElementAnalysisService.cancelSelectionAnalysis;
  const armInteractiveSelectionAnalysisImpl =
    input.armInteractiveSelectionAnalysis ?? armInteractiveSelectionAnalysis;
  const showSelectionAnalysisGuidanceImpl =
    input.showSelectionAnalysisGuidance ?? showSelectionAnalysisGuidance;
  const rememberPendingSelectionAnalysis =
    input.rememberPendingSelectionAnalysis ?? rememberPendingPageEditSelectionAnalysis;
  const clearPendingSelectionAnalysis =
    input.clearPendingSelectionAnalysis ?? clearPendingPageEditSelectionAnalysis;
  const publishComposerAppend = input.publishComposerAppend ?? publishAgentV2ComposerAppend;
  const openSidePanel =
    input.openSidePanel ??
    ((windowId: number) => chrome.sidePanel?.open({ windowId }).then(() => undefined) ?? Promise.resolve());
  const summaryBuilder = createPageEditElementAnalysisSummaryBuilder();

  return (message: unknown, sender?: chrome.runtime.MessageSender) => {
    if (
      !message ||
      typeof message !== 'object' ||
      (message as { type?: unknown }).type !== 'page_edit_selection_analyze'
    ) {
      return false;
    }

    const payload = (
      message as {
        payload?: { nonce?: unknown; target?: unknown };
      }
    ).payload;
    if (!payload || typeof payload.nonce !== 'string' || !isPickedElementContext(payload.target)) {
      return false;
    }

    const tabId = sender?.tab?.id;
    if (typeof tabId !== 'number') {
      return false;
    }

    const currentState = getPageEditState(tabId);
    if (
      currentState?.status !== 'active' ||
      typeof currentState.selectionSessionNonce !== 'string' ||
      currentState.selectionSessionNonce !== payload.nonce
    ) {
      return false;
    }

    const target = payload.target;
    const selectionNonce = payload.nonce;
    const windowId = sender?.tab?.windowId;
    void (async () => {
      let startedSessionId: string | null = null;
      const activeTab = await getActiveTab();
      if (activeTab?.id !== tabId || activeTab.windowId !== windowId) {
        return;
      }

      try {
        const started = await startSelectionAnalysis({
          tabId,
          targetElement: target,
        });
        startedSessionId = started.sessionId;

        const pendingAnalysis: PendingPageEditSelectionAnalysis = {
          sessionId: started.sessionId,
          tabId,
          windowId,
          nonce: selectionNonce,
          analysisMode: started.analysisMode,
        };
        rememberPendingSelectionAnalysis(pendingAnalysis);

        if (started.analysisMode === 'interactive') {
          await armInteractiveSelectionAnalysisImpl({
            tabId,
            sessionId: started.sessionId,
            nonce: selectionNonce,
            targetElement: target,
          });
        }

        await showSelectionAnalysisGuidanceImpl({
          tabId,
          analysisMode: started.analysisMode,
          targetElement: target,
          sessionId: started.sessionId,
          nonce: selectionNonce,
        }).catch(() => undefined);

        const openSidePanelTask =
          typeof windowId === 'number' ? openSidePanel(windowId).catch(() => undefined) : undefined;
        const publishComposerAppendTask = publishComposerAppend({
          text: summaryBuilder.buildStartMessage({
            analysisMode: started.analysisMode,
            target,
          }),
          source: 'page-edit:analyze',
        });

        await Promise.allSettled([openSidePanelTask, publishComposerAppendTask]);
      } catch (error) {
        if (startedSessionId) {
          clearPendingSelectionAnalysis(startedSessionId);
          await cancelSelectionAnalysis(startedSessionId).catch(() => undefined);
        }

        const openSidePanelTask =
          typeof windowId === 'number' ? openSidePanel(windowId).catch(() => undefined) : undefined;
        const publishComposerAppendTask = publishComposerAppend({
          text: `页面元素分析启动失败：${error instanceof Error ? error.message : String(error)}`,
          source: 'page-edit:analyze',
        }).catch(() => undefined);

        await Promise.allSettled([openSidePanelTask, publishComposerAppendTask]);
      }
    })().catch(() => undefined);

    return false;
  };
}

export function createPageEditSelectionAnalyzeCompletionMessageListener(input: {
  getPageEditState?: (tabId: number) => PageEditState | null;
  getPendingSelectionAnalysis?: (sessionId: string) => PendingPageEditSelectionAnalysis | null;
  clearPendingSelectionAnalysis?: (sessionId: string) => void;
  completeSelectionAnalysis?: typeof pageEditElementAnalysisService.completeSelectionAnalysis;
  clearSelectionAnalysisGuidance?: typeof clearSelectionAnalysisGuidance;
  publishDomAnalysisSuggestion?: typeof publishAgentV2DomAnalysisSuggestion;
  publishComposerAppend?: typeof publishAgentV2ComposerAppend;
  openSidePanel?: (windowId: number) => Promise<void>;
  executeScript?: typeof defaultExecuteScript;
}) {
  const getPageEditState =
    input.getPageEditState ?? ((tabId: number) => pageEditService.getState(tabId));
  const getPendingSelectionAnalysis =
    input.getPendingSelectionAnalysis ?? getPendingPageEditSelectionAnalysis;
  const clearPendingSelectionAnalysis =
    input.clearPendingSelectionAnalysis ?? clearPendingPageEditSelectionAnalysis;
  const completeSelectionAnalysis =
    input.completeSelectionAnalysis ?? pageEditElementAnalysisService.completeSelectionAnalysis;
  const clearSelectionAnalysisGuidanceImpl =
    input.clearSelectionAnalysisGuidance ?? clearSelectionAnalysisGuidance;
  const publishDomAnalysisSuggestion =
    input.publishDomAnalysisSuggestion ?? publishAgentV2DomAnalysisSuggestion;
  const publishComposerAppend = input.publishComposerAppend ?? publishAgentV2ComposerAppend;
  const openSidePanel =
    input.openSidePanel ??
    ((windowId: number) => chrome.sidePanel?.open({ windowId }).then(() => undefined) ?? Promise.resolve());
  const executeScript = input.executeScript ?? defaultExecuteScript;

  return (message: unknown, sender?: chrome.runtime.MessageSender) => {
    if (
      !message ||
      typeof message !== 'object' ||
      (message as { type?: unknown }).type !== 'page_edit_selection_analysis_complete'
    ) {
      return false;
    }

    const payload = (
      message as {
        payload?: { sessionId?: unknown; nonce?: unknown; trigger?: unknown };
      }
    ).payload;

    if (
      !payload ||
      typeof payload.sessionId !== 'string' ||
      typeof payload.nonce !== 'string' ||
      payload.trigger !== 'interaction-complete'
    ) {
      return false;
    }

    const pending = getPendingSelectionAnalysis(payload.sessionId);
    if (pending) {
      void appendPageEditAnalysisDebugLine({
        tabId: pending.tabId,
        text: `BG 收到完成消息 | session=${payload.sessionId}`,
        executeScript,
      }).catch(() => undefined);
    }
    const senderTabId = sender?.tab?.id;
    if (
      !pending ||
      pending.analysisMode !== 'interactive' ||
      (typeof senderTabId === 'number' && senderTabId !== pending.tabId)
    ) {
      if (pending) {
        void appendPageEditAnalysisDebugLine({
          tabId: pending.tabId,
          text: `BG 忽略完成消息 | senderTab=${String(senderTabId)} | pendingTab=${pending.tabId} | mode=${pending.analysisMode}`,
          executeScript,
        }).catch(() => undefined);
      }
      return false;
    }

    const currentState = getPageEditState(pending.tabId);
    if (
      currentState &&
      (currentState.status !== 'active' ||
        currentState.selectionSessionNonce !== pending.nonce ||
        pending.nonce !== payload.nonce)
    ) {
      void appendPageEditAnalysisDebugLine({
        tabId: pending.tabId,
        text: `BG 状态校验失败 | status=${currentState?.status ?? 'null'} | stateNonce=${currentState?.selectionSessionNonce ?? 'null'} | pendingNonce=${pending.nonce} | payloadNonce=${payload.nonce}`,
        executeScript,
      }).catch(() => undefined);
      return false;
    }

    clearPendingSelectionAnalysis(pending.sessionId);
    void appendPageEditAnalysisDebugLine({
      tabId: pending.tabId,
      text: 'BG 已接受完成消息，开始生成分析建议',
      executeScript,
    }).catch(() => undefined);
    void clearSelectionAnalysisGuidanceImpl({
      tabId: pending.tabId,
    }).catch(() => undefined);
    void publishComposerAppend({
      text: '已收到真实交互，正在整理页面分析建议...',
      source: 'page-edit:analyze-progress',
    }).catch(() => undefined);
    void publishPageEditSelectionAnalysisResult({
      pending,
      completeSelectionAnalysis,
      publishDomAnalysisSuggestion,
      publishComposerAppend,
      openSidePanel,
      executeScript,
    }).catch(() => undefined);

    return false;
  };
}

export function createPageEditSelectionAnalyzeTabUpdateListener(input: {
  listPendingSelectionAnalysesByTabId?: (tabId: number) => PendingPageEditSelectionAnalysis[];
  clearPendingSelectionAnalysis?: (sessionId: string) => void;
  completeSelectionAnalysis?: typeof pageEditElementAnalysisService.completeSelectionAnalysis;
  publishDomAnalysisSuggestion?: typeof publishAgentV2DomAnalysisSuggestion;
  publishComposerAppend?: typeof publishAgentV2ComposerAppend;
  openSidePanel?: (windowId: number) => Promise<void>;
}) {
  const listPendingSelectionAnalysesByTabId =
    input.listPendingSelectionAnalysesByTabId ?? listPendingPageEditSelectionAnalysesByTabId;
  const clearPendingSelectionAnalysis =
    input.clearPendingSelectionAnalysis ?? clearPendingPageEditSelectionAnalysis;
  const completeSelectionAnalysis =
    input.completeSelectionAnalysis ?? pageEditElementAnalysisService.completeSelectionAnalysis;
  const publishDomAnalysisSuggestion =
    input.publishDomAnalysisSuggestion ?? publishAgentV2DomAnalysisSuggestion;
  const publishComposerAppend = input.publishComposerAppend ?? publishAgentV2ComposerAppend;
  const openSidePanel =
    input.openSidePanel ??
    ((windowId: number) => chrome.sidePanel?.open({ windowId }).then(() => undefined) ?? Promise.resolve());

  return (tabId: number, changeInfo: chrome.tabs.TabChangeInfo) => {
    if (changeInfo.status !== 'complete') {
      return;
    }

    const pendingAnalyses = listPendingSelectionAnalysesByTabId(tabId).filter(
      (pending) => pending.analysisMode === 'display'
    );

    for (const pending of pendingAnalyses) {
      clearPendingSelectionAnalysis(pending.sessionId);
      void publishPageEditSelectionAnalysisResult({
        pending,
        completeSelectionAnalysis,
        publishDomAnalysisSuggestion,
        publishComposerAppend,
        openSidePanel,
      }).catch(() => undefined);
    }
  };
}

export function createPageEditPageCaptureMessageListener(input: {
  getActiveTab?: () => Promise<ActiveTabLike | undefined>;
  getPageEditState?: (tabId: number) => PageEditState | null;
  captureToWorkspace?: typeof capturePageToCurrentWorkspace;
  annotationStore?: Pick<typeof pageAnnotationStore, 'listTargets' | 'listAnnotations'>;
  publishQuickActionFeedback?: typeof publishAgentV2QuickActionFeedback;
  openSidePanel?: (windowId: number) => Promise<void>;
}) {
  const getActiveTab = input.getActiveTab ?? defaultGetActiveTab;
  const getPageEditState =
    input.getPageEditState ?? ((tabId: number) => pageEditService.getState(tabId));
  const captureToWorkspace = input.captureToWorkspace ?? capturePageToCurrentWorkspace;
  const annotationStore = input.annotationStore ?? pageAnnotationStore;
  const publishQuickActionFeedback =
    input.publishQuickActionFeedback ?? publishAgentV2QuickActionFeedback;
  const openSidePanel =
    input.openSidePanel ??
    ((windowId: number) => chrome.sidePanel?.open({ windowId }).then(() => undefined) ?? Promise.resolve());

  return (message: unknown, sender?: chrome.runtime.MessageSender) => {
    if (
      !message ||
      typeof message !== 'object' ||
      (message as { type?: unknown }).type !== 'page_edit_capture_page'
    ) {
      return false;
    }

    const payload = (
      message as {
        payload?: { nonce?: unknown };
      }
    ).payload;
    if (!payload || typeof payload.nonce !== 'string') {
      return false;
    }

    const tabId = sender?.tab?.id;
    if (typeof tabId !== 'number') {
      return false;
    }

    const currentState = getPageEditState(tabId);
    if (
      currentState?.status !== 'active' ||
      typeof currentState.selectionSessionNonce !== 'string' ||
      currentState.selectionSessionNonce !== payload.nonce
    ) {
      return false;
    }

    const windowId = sender?.tab?.windowId;
    void (async () => {
      const activeTab = await getActiveTab();
      if (activeTab?.id !== tabId || activeTab.windowId !== windowId) {
        return;
      }

      try {
        const sourcePageType =
          currentState.sourcePageType ?? toAnnotationPageType(currentState.pageMode);
        const result = await captureToWorkspace({
          mode: 'page',
          workbench: {
            sourcePageUrl: currentState.sourcePageUrl ?? currentState.url,
            sourcePageType,
            targets: annotationStore.listTargets(tabId),
            annotations: annotationStore.listAnnotations(tabId),
          },
        });
        const openSidePanelTask =
          typeof windowId === 'number' ? openSidePanel(windowId).catch(() => undefined) : undefined;
        const publishQuickActionFeedbackTask = publishQuickActionFeedback({
          kind: 'success',
          message: '网页已保存到',
          entryPath: result.entryPath,
          source: 'page-edit:capture',
        });

        await Promise.allSettled([openSidePanelTask, publishQuickActionFeedbackTask]);
      } catch (error) {
        await publishQuickActionFeedback({
          kind: 'error',
          message: '采集当前页面失败：' + (error instanceof Error ? error.message : String(error)),
          source: 'page-edit:capture',
        }).catch(() => undefined);
      }
    })().catch(() => undefined);

    return false;
  };
}

export function createPageEditSelectionAnnotateMessageListener(input: {
  getActiveTab?: () => Promise<ActiveTabLike | undefined>;
  getPageEditState?: (tabId: number) => PageEditState | null;
  annotationStore?: Pick<
    typeof pageAnnotationStore,
    'upsertTarget' | 'upsertAnnotation' | 'clearTab' | 'listTargets' | 'listAnnotations'
  >;
  now?: () => number;
  createTargetId?: () => string;
  createAnnotationId?: () => string;
}) {
  const getActiveTab = input.getActiveTab ?? defaultGetActiveTab;
  const getPageEditState =
    input.getPageEditState ?? ((tabId: number) => pageEditService.getState(tabId));
  const annotationStore = input.annotationStore ?? pageAnnotationStore;
  const now = input.now ?? Date.now;
  const createTargetId = input.createTargetId ?? defaultCreateAnnotationRecordId;
  const createAnnotationId = input.createAnnotationId ?? defaultCreateAnnotationRecordId;

  return async (message: unknown, sender?: chrome.runtime.MessageSender) => {
    try {
      if (
        !message ||
        typeof message !== 'object' ||
        (message as { type?: unknown }).type !== 'page_edit_selection_annotate'
      ) {
        return false;
      }

      const payload = (
        message as {
          payload?: { nonce?: unknown; target?: unknown; content?: unknown };
        }
      ).payload;
      if (
        !payload ||
        typeof payload.nonce !== 'string' ||
        typeof payload.content !== 'string' ||
        !isPickedElementContext(payload.target)
      ) {
        return false;
      }

      const tabId = sender?.tab?.id;
      if (typeof tabId !== 'number') {
        return false;
      }

      const currentState = getPageEditState(tabId);
      const pageType =
        currentState?.sourcePageType ?? (currentState ? toAnnotationPageType(currentState.pageMode) : null);
      if (
        currentState?.status !== 'active' ||
        typeof currentState.selectionSessionNonce !== 'string' ||
        currentState.selectionSessionNonce !== payload.nonce ||
        !pageType
      ) {
        return false;
      }

      const windowId = sender?.tab?.windowId;
      const content = payload.content;
      const createdAt = now();
      const targetId = createTargetId();
      const sourcePageUrl = currentState.sourcePageUrl ?? currentState.url;
      const targetRecord = normalizeSelectionTarget({
        target: payload.target,
        targetId,
        pageUrl: sourcePageUrl,
        pageType,
        createdAt,
      });
      if (!targetRecord) {
        return false;
      }

      const activeTab = await getActiveTab();
      if (activeTab?.id !== tabId || activeTab.windowId !== windowId) {
        return false;
      }

      const senderTabUrl = sender?.tab?.url;
      if (
        !areSamePageIdentity([currentState.url, activeTab.url, senderTabUrl, targetRecord.url])
      ) {
        return false;
      }

      annotationStore.upsertTarget(tabId, targetRecord);
      annotationStore.upsertAnnotation(tabId, {
        annotationId: createAnnotationId(),
        targetId,
        content,
        createdAt,
        updatedAt: createdAt,
        sourcePageUrl,
        sourcePageType: pageType,
        status: 'draft',
      });

      return false;
    } catch {
      return false;
    }
  };
}

export function createPageWorkbenchStateRestoreMessageListener(input: {
  getActiveTab?: () => Promise<ActiveTabLike | undefined>;
  getPageEditState?: (tabId: number) => PageEditState | null;
  annotationStore?: Pick<
    typeof pageAnnotationStore,
    'clearTab' | 'upsertTarget' | 'upsertAnnotation'
  >;
  updatePageEditState?: (
    tabId: number,
    input: {
      sourcePageUrl: string | null;
      sourcePageType: AnnotationPageType | null;
    }
  ) => PageEditState | null;
}) {
  const getActiveTab = input.getActiveTab ?? defaultGetActiveTab;
  const getPageEditState =
    input.getPageEditState ?? ((tabId: number) => pageEditService.getState(tabId));
  const annotationStore = input.annotationStore ?? pageAnnotationStore;
  const updatePageEditState =
    input.updatePageEditState ??
    ((tabId: number, restoredState: { sourcePageUrl: string | null; sourcePageType: AnnotationPageType | null }) =>
      pageEditService.restoreWorkbenchState(tabId, restoredState));

  return async (message: unknown, sender?: chrome.runtime.MessageSender) => {
    if (
      !message ||
      typeof message !== 'object' ||
      (message as { type?: unknown }).type !== 'page_workbench_state_restore'
    ) {
      return false;
    }

    const payload = (
      message as {
        payload?: {
          nonce?: unknown;
          pageUrl?: unknown;
          sourcePageUrl?: unknown;
          sourcePageType?: unknown;
          targets?: unknown;
          annotations?: unknown;
        };
      }
    ).payload;
    if (
      !payload ||
      typeof payload.nonce !== 'string' ||
      typeof payload.pageUrl !== 'string' ||
      !isNullableString(payload.sourcePageUrl) ||
      !(payload.sourcePageType === null || isAnnotationPageType(payload.sourcePageType)) ||
      !Array.isArray(payload.targets) ||
      !Array.isArray(payload.annotations)
    ) {
      return false;
    }

    const tabId = sender?.tab?.id;
    const windowId = sender?.tab?.windowId;
    if (typeof tabId !== 'number') {
      return false;
    }

    const currentState = getPageEditState(tabId);
    if (
      (currentState?.status !== 'active' && currentState?.status !== 'activating') ||
      currentState.pageMode !== 'local-snapshot' ||
      currentState.selectionSessionNonce !== payload.nonce ||
      currentState.url !== payload.pageUrl ||
      !isPageEditFileUrl(payload.pageUrl)
    ) {
      return false;
    }

    const activeTab = await getActiveTab();
    if (
      activeTab?.id !== tabId ||
      activeTab.windowId !== windowId ||
      activeTab.url !== payload.pageUrl ||
      (typeof sender?.tab?.url === 'string' && sender.tab.url !== payload.pageUrl)
    ) {
      return false;
    }

    const targets = payload.targets.map(normalizeRestoredSelectionTarget);
    const annotations = payload.annotations.map(normalizeRestoredAnnotation);
    if (targets.some((item) => item === null) || annotations.some((item) => item === null)) {
      return false;
    }

    annotationStore.clearTab(tabId);
    targets.forEach((target) => {
      annotationStore.upsertTarget(tabId, target as SelectionTarget);
    });
    annotations.forEach((annotation) => {
      annotationStore.upsertAnnotation(tabId, annotation as ElementAnnotation);
    });
    updatePageEditState(tabId, {
      sourcePageUrl: payload.sourcePageUrl,
      sourcePageType: payload.sourcePageType,
    });

    return false;
  };
}

export function createPageEditFileSaveMessageListener(input: {
  getActiveTab?: () => Promise<ActiveTabLike | undefined>;
  getPageEditState?: (tabId: number) => PageEditState | null;
  saveFile?: (input: PageEditFileSaveInput) => Promise<void>;
}) {
  const getActiveTab = input.getActiveTab ?? defaultGetActiveTab;
  const getPageEditState =
    input.getPageEditState ?? ((tabId: number) => pageEditService.getState(tabId));
  const saveFile = input.saveFile ?? defaultSavePageEditFile;

  return async (message: unknown, sender?: chrome.runtime.MessageSender) => {
    if (
      !message ||
      typeof message !== 'object' ||
      (message as { type?: unknown }).type !== 'page_edit_save_file'
    ) {
      return false;
    }

    const payload = (
      message as {
        payload?: { nonce?: unknown; pageUrl?: unknown; html?: unknown };
      }
    ).payload;
    const tabId = sender?.tab?.id;
    const windowId = sender?.tab?.windowId;
    if (
      !payload ||
      typeof payload.nonce !== 'string' ||
      typeof payload.pageUrl !== 'string' ||
      typeof payload.html !== 'string' ||
      typeof tabId !== 'number'
    ) {
      return { success: false, error: '当前页面不可保存' };
    }

    const currentState = getPageEditState(tabId);
    const currentPageMode = currentState?.pageMode ?? getPageModeForUrl(currentState?.url);
    if (
      currentState?.status !== 'active' ||
      typeof currentState.selectionSessionNonce !== 'string' ||
      currentState.selectionSessionNonce !== payload.nonce
    ) {
      return { success: false, error: '当前页面不可保存' };
    }

    const activeTab = await getActiveTab();
    if (
      activeTab?.id !== tabId ||
      activeTab.windowId !== windowId ||
      currentPageMode !== 'local-snapshot' ||
      !isLocalSnapshotPageEditUrl(payload.pageUrl) ||
      !isLocalSnapshotPageEditUrl(activeTab.url) ||
      currentState.url !== payload.pageUrl ||
      activeTab.url !== payload.pageUrl ||
      (typeof sender?.tab?.url === 'string' && sender.tab.url !== payload.pageUrl)
    ) {
      return { success: false, error: '当前页面不可保存' };
    }

    try {
      await saveFile({
        pageUrl: payload.pageUrl,
        html: payload.html,
      });

      return { success: true };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : '保存失败',
      };
    }
  };
}

export let pageEditService = createPageEditService();

export function resetPageEditServiceForTests(deps: PageEditDeps = {}) {
  pageEditService = createPageEditService(deps);
  pendingPageEditSelectionAnalyses.clear();
}

let pageEditListenersInitialized = false;
let pageEditSelectionListenerInitialized = false;
let pageEditSelectionCaptureListenerInitialized = false;
let pageEditSelectionAnalyzeListenerInitialized = false;
let pageEditSelectionAnalyzeCompletionListenerInitialized = false;
let pageEditPageCaptureListenerInitialized = false;
let pageEditSelectionAnnotateListenerInitialized = false;
let pageEditFileSaveListenerInitialized = false;
let pageWorkbenchStateRestoreListenerInitialized = false;
let pageEditSelectionAnalyzeTabUpdateListenerInitialized = false;

export function initPageEditListeners() {
  if (pageEditListenersInitialized || typeof chrome === 'undefined') {
    return;
  }

  if (!pageEditSelectionListenerInitialized) {
    chrome.runtime?.onMessage?.addListener(createPageEditSelectionMessageListener({}));
    pageEditSelectionListenerInitialized = true;
  }

  if (!pageEditSelectionCaptureListenerInitialized) {
    chrome.runtime?.onMessage?.addListener(createPageEditSelectionCaptureMessageListener({}));
    pageEditSelectionCaptureListenerInitialized = true;
  }

  if (!pageEditSelectionAnalyzeListenerInitialized) {
    chrome.runtime?.onMessage?.addListener(createPageEditSelectionAnalyzeMessageListener({}));
    pageEditSelectionAnalyzeListenerInitialized = true;
  }

  if (!pageEditSelectionAnalyzeCompletionListenerInitialized) {
    chrome.runtime?.onMessage?.addListener(createPageEditSelectionAnalyzeCompletionMessageListener({}));
    pageEditSelectionAnalyzeCompletionListenerInitialized = true;
  }

  if (!pageEditPageCaptureListenerInitialized) {
    chrome.runtime?.onMessage?.addListener(createPageEditPageCaptureMessageListener({}));
    pageEditPageCaptureListenerInitialized = true;
  }

  if (!pageEditSelectionAnnotateListenerInitialized) {
    chrome.runtime?.onMessage?.addListener(createPageEditSelectionAnnotateMessageListener({}));
    pageEditSelectionAnnotateListenerInitialized = true;
  }

  if (!pageEditFileSaveListenerInitialized) {
    chrome.runtime?.onMessage?.addListener(createPageEditFileSaveMessageListener({}));
    pageEditFileSaveListenerInitialized = true;
  }

  if (!pageWorkbenchStateRestoreListenerInitialized) {
    chrome.runtime?.onMessage?.addListener(createPageWorkbenchStateRestoreMessageListener({}));
    pageWorkbenchStateRestoreListenerInitialized = true;
  }

  chrome.tabs?.onUpdated?.addListener((tabId, changeInfo) => {
    if (!changeInfo.url && changeInfo.status !== 'loading') {
      return;
    }

    pageEditService.handleTabUpdated({
      tabId,
      url: changeInfo.url,
      status: changeInfo.status,
    });
  });

  if (!pageEditSelectionAnalyzeTabUpdateListenerInitialized) {
    chrome.tabs?.onUpdated?.addListener(createPageEditSelectionAnalyzeTabUpdateListener({}));
    pageEditSelectionAnalyzeTabUpdateListenerInitialized = true;
  }

  chrome.tabs?.onRemoved?.addListener((tabId) => {
    pageEditService.handleTabRemoved({ tabId });
  });

  pageEditListenersInitialized = true;
}
