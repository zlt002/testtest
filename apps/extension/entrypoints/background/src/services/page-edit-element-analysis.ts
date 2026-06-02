import type { PickedElementContext } from '@/entrypoints/lib/page-picker';
import type { DomAnalyzeRequest, DomAnalyzeResult } from '@/entrypoints/sidepanel/lib/dom-analysis/types';
import { domAnalysisCdpService, type DomAnalysisCdpService } from './dom-analysis-cdp';
import {
  DOM_ANALYSIS_SESSION_TTL_MS,
  domAnalysisSessionStore,
  type DomAnalysisSessionStore,
} from './dom-analysis-session-store';
import { ensureCompanionReady } from './NativeHostManager';
import { buildDomAnalysisEvidenceForTarget } from './page-picker';

export type PageEditElementAnalysisMode = 'interactive' | 'display';
export type PageEditElementAnalysisStatus = 'waiting-interaction' | 'waiting-refresh';

type StartSelectionAnalysisInput = {
  tabId: number;
  targetElement: PickedElementContext;
};

type CompleteSelectionAnalysisInput = {
  sessionId: string;
};

type AnalyzeDomInput = {
  agentBaseUrl: string;
  input: DomAnalyzeRequest;
};

type CreatePageEditElementAnalysisServiceOptions = {
  sessionStore?: DomAnalysisSessionStore;
  cdpService?: DomAnalysisCdpService;
  now?: () => number;
  ttlMs?: number;
  setTimeout?: typeof globalThis.setTimeout;
  clearTimeout?: typeof globalThis.clearTimeout;
  classifyTarget?: (targetElement: PickedElementContext) => PageEditElementAnalysisMode;
  buildEvidenceForTarget?: typeof buildDomAnalysisEvidenceForTarget;
  analyzeDom?: (
    input: AnalyzeDomInput
  ) => Promise<Pick<DomAnalyzeResult, 'analysisCard' | 'suggestedCommand' | 'chatSummary'>>;
  ensureCompanionReady?: typeof ensureCompanionReady;
};

async function defaultAnalyzeDom(
  input: AnalyzeDomInput
): Promise<Pick<DomAnalyzeResult, 'analysisCard' | 'suggestedCommand' | 'chatSummary'>> {
  const response = await fetch(`${input.agentBaseUrl}/api/agent-v2/page-code-analysis/dom-analyze`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input.input),
  });

  if (!response.ok) {
    throw new Error(`页面元素分析失败：${response.status}`);
  }

  return response.json();
}

function hasInteractiveRole(targetElement: PickedElementContext): boolean {
  const snippet = targetElement.outerHTMLSnippet?.toLowerCase() ?? '';
  return /role=["']?(button|link|tab|switch|checkbox|radio|textbox|menuitem)["'\s>]/i.test(
    snippet
  );
}

function hasInteractiveTabIndex(targetElement: PickedElementContext): boolean {
  const snippet = targetElement.outerHTMLSnippet?.toLowerCase() ?? '';
  const match = snippet.match(/tabindex\s*=\s*["']?(-?\d+)["']?/i);
  if (!match) {
    return false;
  }

  return Number(match[1]) !== -1;
}

function hasInteractiveContentEditable(targetElement: PickedElementContext): boolean {
  const snippet = targetElement.outerHTMLSnippet?.toLowerCase() ?? '';
  const match = snippet.match(/contenteditable(?:\s*=\s*["']?([^"' >]+)["']?)?/i);
  if (!match) {
    return false;
  }

  const value = match[1]?.trim().toLowerCase();
  return value !== 'false';
}

function hasInteractiveAffordance(targetElement: PickedElementContext): boolean {
  const snippet = targetElement.outerHTMLSnippet?.toLowerCase() ?? '';
  if (/(?:onclick|href=)/i.test(snippet)) {
    return true;
  }

  return (
    hasInteractiveTabIndex(targetElement) || hasInteractiveContentEditable(targetElement)
  );
}

export function classifyPickedElement(
  targetElement: PickedElementContext
): PageEditElementAnalysisMode {
  const tagName = targetElement.tagName.toLowerCase();
  if (
    new Set([
      'a',
      'button',
      'input',
      'select',
      'textarea',
      'summary',
      'option',
      'label',
      'details',
    ]).has(tagName)
  ) {
    return 'interactive';
  }

  if (hasInteractiveRole(targetElement) || hasInteractiveAffordance(targetElement)) {
    return 'interactive';
  }

  return 'display';
}

export function createPageEditElementAnalysisService(
  options: CreatePageEditElementAnalysisServiceOptions = {}
) {
  const sessionStore = options.sessionStore ?? domAnalysisSessionStore;
  const cdpService = options.cdpService ?? domAnalysisCdpService;
  const now = options.now ?? (() => Date.now());
  const ttlMs = options.ttlMs ?? DOM_ANALYSIS_SESSION_TTL_MS;
  const scheduleTimeout = options.setTimeout ?? globalThis.setTimeout;
  const cancelTimeout = options.clearTimeout ?? globalThis.clearTimeout;
  const classifyTarget = options.classifyTarget ?? classifyPickedElement;
  const buildEvidenceForTarget = options.buildEvidenceForTarget ?? buildDomAnalysisEvidenceForTarget;
  const analyzeDom = options.analyzeDom ?? defaultAnalyzeDom;
  const ensureCompanionReadyImpl = options.ensureCompanionReady ?? ensureCompanionReady;
  const cleanupTimers = new Map<string, ReturnType<typeof globalThis.setTimeout>>();

  const clearCleanupTimer = (sessionId: string) => {
    const timer = cleanupTimers.get(sessionId);
    if (timer === undefined) {
      return;
    }

    cancelTimeout(timer);
    cleanupTimers.delete(sessionId);
  };

  const stopCaptureAndDeleteSession = async (sessionId: string, tabId: number) => {
    clearCleanupTimer(sessionId);
    sessionStore.deleteSession(sessionId);
    await cdpService.stopCaptureForTab(tabId).catch(() => undefined);
  };

  return {
    async startSelectionAnalysis(input: StartSelectionAnalysisInput): Promise<{
      sessionId: string;
      tabId: number;
      analysisMode: PageEditElementAnalysisMode;
      status: PageEditElementAnalysisStatus;
    }> {
      const analysisMode = classifyTarget(input.targetElement);
      const session = sessionStore.startSession({
        tabId: input.tabId,
        mode:
          analysisMode === 'interactive' ? 'selection-interactive' : 'selection-display',
        startedAt: now(),
        targetElement: input.targetElement,
      });

      try {
        await cdpService.startCaptureForTab(input.tabId);
      } catch (error) {
        sessionStore.deleteSession(session.sessionId);
        throw error;
      }

      cleanupTimers.set(
        session.sessionId,
        scheduleTimeout(() => {
          void stopCaptureAndDeleteSession(session.sessionId, session.tabId);
        }, ttlMs)
      );

      return {
        sessionId: session.sessionId,
        tabId: session.tabId,
        analysisMode,
        status: analysisMode === 'interactive' ? 'waiting-interaction' : 'waiting-refresh',
      };
    },

    async cancelSelectionAnalysis(sessionId: string): Promise<void> {
      const session = sessionStore.getSession(sessionId);
      if (!session) {
        clearCleanupTimer(sessionId);
        return;
      }

      await stopCaptureAndDeleteSession(sessionId, session.tabId);
    },

    async completeSelectionAnalysis(
      input: CompleteSelectionAnalysisInput
    ): Promise<{
      markdown: string;
      analysisCard: DomAnalyzeResult['analysisCard'];
      suggestedCommand: string | null;
    }> {
      const session = sessionStore.getSession(input.sessionId);
      if (!session || !session.targetElement) {
        throw new Error(`未找到页面元素分析会话: ${input.sessionId}`);
      }

      try {
        const [discovery, pageEvidence] = await Promise.all([
          ensureCompanionReadyImpl(),
          buildEvidenceForTarget({
            sessionId: session.sessionId,
            tabId: session.tabId,
            targetElement: session.targetElement,
            mode: session.mode,
            startedAt: session.startedAt,
          }),
        ]);

        const result = await analyzeDom({
          agentBaseUrl: discovery.agentBaseUrl,
          input: {
            pageEvidence,
          },
        });

        return {
          markdown: result.chatSummary.markdown,
          analysisCard: result.analysisCard ?? null,
          suggestedCommand: result.suggestedCommand ?? null,
        };
      } finally {
        clearCleanupTimer(session.sessionId);
        sessionStore.deleteSession(session.sessionId);
        cdpService.clearTab(session.tabId);
        await cdpService.stopCaptureForTab(session.tabId).catch(() => undefined);
      }
    },
  };
}

export const pageEditElementAnalysisService = createPageEditElementAnalysisService();
