import type { PickedElementContext } from '@/entrypoints/lib/page-picker';
import type { CaptureSessionMeta, PageEvidence } from '@mcp-b/dom-analysis-contracts';
import { domAnalysisCdpService, type DomAnalysisCdpService } from './dom-analysis-cdp';
import { buildPageEvidence } from './dom-analysis-evidence';
import {
  domAnalysisSessionStore,
  normalizeDomAnalysisCaptureSessionMode,
  type DomAnalysisSessionMode,
  type DomAnalysisSessionStore,
} from './dom-analysis-session-store';
import { runPagePickerInPage } from './page-picker-script';

export const PAGE_PICKER_TIMEOUT_MS = 30_000;
const PAGE_PICKER_EXECUTION_TIMEOUT_BUFFER_MS = 1_000;
const DOM_ANALYSIS_PRE_CAPTURE_WINDOW_MS = 15_000;
const DOM_ANALYSIS_POST_CAPTURE_WINDOW_MS = 2_000;

type BeginPageDomAnalysisEvidenceCaptureOptions = {
  preCaptureWindowMs?: number;
  postCaptureWindowMs?: number;
  now?: () => number;
  sessionStore?: DomAnalysisSessionStore;
  cdpService?: DomAnalysisCdpService;
  buildEvidence?: typeof buildPageEvidence;
};

type StartDomAnalysisSessionOptions = {
  tabId?: number;
  windowId?: number;
  now?: () => number;
  sessionStore?: DomAnalysisSessionStore;
};

type CaptureDomAnalysisEvidenceForSessionOptions = {
  sessionId: string;
  includeFrames?: boolean;
  maxChars?: number;
  preCaptureWindowMs?: number;
  postCaptureWindowMs?: number;
  now?: () => number;
  sessionStore?: DomAnalysisSessionStore;
  cdpService?: DomAnalysisCdpService;
  buildEvidence?: typeof buildPageEvidence;
};

type BuildDomAnalysisEvidenceForTargetOptions = {
  tabId: number;
  sessionId: string;
  targetElement: PickedElementContext;
  mode: DomAnalysisSessionMode | CaptureSessionMeta['mode'];
  startedAt: number;
  capturedAt?: number;
  includeFrames?: boolean;
  maxChars?: number;
  preCaptureWindowMs?: number;
  postCaptureWindowMs?: number;
  now?: () => number;
  buildEvidence?: typeof buildPageEvidence;
};

function buildEvidenceRequest(input: {
  tab: chrome.tabs.Tab;
  tabId: number;
  sessionId: string;
  targetElement: PickedElementContext;
  mode: DomAnalysisSessionMode | CaptureSessionMeta['mode'];
  startedAt: number;
  capturedAt: number;
  includeFrames?: boolean;
  maxChars?: number;
  preCaptureWindowMs?: number;
  postCaptureWindowMs?: number;
}): Parameters<typeof buildPageEvidence>[0] {
  return {
    tab: input.tab,
    targetElement: input.targetElement,
    captureSessionMeta: {
      sessionId: input.sessionId,
      tabId: input.tabId,
      capturedAt: input.capturedAt,
      mode: normalizeDomAnalysisCaptureSessionMode(input.mode),
    },
    networkWindow: {
      startTime:
        input.startedAt - (input.preCaptureWindowMs ?? DOM_ANALYSIS_PRE_CAPTURE_WINDOW_MS),
      endTime:
        input.capturedAt + (input.postCaptureWindowMs ?? DOM_ANALYSIS_POST_CAPTURE_WINDOW_MS),
    },
    includeFrames: input.includeFrames,
    maxChars: input.maxChars,
  };
}

export function isSupportedPagePickerUrl(url: string | undefined): boolean {
  if (!url) {
    return false;
  }

  return !/^(chrome|chrome-extension|edge|about):/i.test(url);
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, message: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = globalThis.setTimeout(() => {
      reject(new Error(message));
    }, timeoutMs);

    promise.then(
      (value) => {
        globalThis.clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        globalThis.clearTimeout(timer);
        reject(error);
      }
    );
  });
}

async function resolveActiveTab(): Promise<chrome.tabs.Tab> {
  return resolveTargetTab();
}

async function resolveTargetTab(input: {
  tabId?: number;
  windowId?: number;
} = {}): Promise<chrome.tabs.Tab> {
  const tab =
    typeof input.tabId === 'number'
      ? await getTabById(input.tabId)
      : (
          await chrome.tabs.query(
            typeof input.windowId === 'number'
              ? {
                  active: true,
                  windowId: input.windowId,
                }
              : {
                  active: true,
                  currentWindow: true,
                }
          )
        )[0];

  if (tab?.id === undefined) {
    throw new Error('未找到当前活动页面');
  }

  if (!isSupportedPagePickerUrl(tab.url)) {
    throw new Error('当前页面不支持拾取');
  }

  return tab;
}

async function getTabById(tabId: number): Promise<chrome.tabs.Tab | undefined> {
  if (typeof chrome.tabs.get === 'function') {
    return chrome.tabs.get(tabId);
  }

  const tabs = await chrome.tabs.query({});
  return tabs.find((tab) => tab.id === tabId);
}

async function beginPageElementPickForTab(tabId: number): Promise<PickedElementContext> {
  const [injectionResult] = await withTimeout(
    chrome.scripting.executeScript({
    target: { tabId },
    world: 'MAIN',
    func: runPagePickerInPage,
      args: [PAGE_PICKER_TIMEOUT_MS],
    }),
    PAGE_PICKER_TIMEOUT_MS + PAGE_PICKER_EXECUTION_TIMEOUT_BUFFER_MS,
    '页面元素拾取超时'
  );

  if (!injectionResult?.result) {
    throw new Error('页面元素拾取未返回结果');
  }

  return injectionResult.result as PickedElementContext;
}

export async function beginPageElementPick(): Promise<PickedElementContext> {
  const activeTab = await resolveActiveTab();
  return beginPageElementPickForTab(activeTab.id as number);
}

export async function startDomAnalysisSession(
  options: StartDomAnalysisSessionOptions = {}
) {
  const tab = await resolveTargetTab({
    tabId: options.tabId,
    windowId: options.windowId,
  });
  const sessionStore = options.sessionStore ?? domAnalysisSessionStore;
  const now = options.now ?? (() => Date.now());

  return sessionStore.startSession({
    tabId: tab.id as number,
    mode: 'interactive',
    startedAt: now(),
  });
}

export async function buildDomAnalysisEvidenceForTarget(
  options: BuildDomAnalysisEvidenceForTargetOptions
): Promise<PageEvidence> {
  const buildEvidenceImpl = options.buildEvidence ?? buildPageEvidence;
  const now = options.now ?? (() => Date.now());
  const tab = await getTabById(options.tabId);
  if (tab?.id === undefined || !isSupportedPagePickerUrl(tab.url)) {
    throw new Error('页面元素分析关联页面不可用');
  }

  const capturedAt = options.capturedAt ?? now();
  return buildEvidenceImpl(
    buildEvidenceRequest({
      tab,
      tabId: options.tabId,
      sessionId: options.sessionId,
      targetElement: options.targetElement,
      mode: options.mode,
      startedAt: options.startedAt,
      capturedAt,
      includeFrames: options.includeFrames,
      maxChars: options.maxChars,
      preCaptureWindowMs: options.preCaptureWindowMs,
      postCaptureWindowMs: options.postCaptureWindowMs,
    })
  );
}

export async function captureDomAnalysisEvidenceForSession(
  options: CaptureDomAnalysisEvidenceForSessionOptions
): Promise<PageEvidence> {
  const sessionStore = options.sessionStore ?? domAnalysisSessionStore;
  const cdpService = options.cdpService ?? domAnalysisCdpService;
  const buildEvidenceImpl = options.buildEvidence ?? buildPageEvidence;
  const now = options.now ?? (() => Date.now());
  const session = sessionStore.getSession(options.sessionId);

  if (!session) {
    throw new Error(`未找到 DOM 分析会话: ${options.sessionId}`);
  }

  const tab = await getTabById(session.tabId);
  if (tab?.id === undefined || !isSupportedPagePickerUrl(tab.url)) {
    throw new Error('DOM 分析会话关联页面不可用');
  }

  try {
    await cdpService.startCaptureForTab(session.tabId);

    const targetElement = await beginPageElementPickForTab(session.tabId);
    if (!targetElement) {
      throw new Error('DOM 分析会话缺少目标元素，无法生成证据');
    }

    const captureSessionMeta = sessionStore.completeSession(session.sessionId, {
      targetElement,
      capturedAt: now(),
    });

    return await buildEvidenceImpl(
      buildEvidenceRequest({
        tab,
        tabId: session.tabId,
        sessionId: captureSessionMeta.sessionId,
        targetElement,
        mode: captureSessionMeta.mode,
        startedAt: session.startedAt,
        capturedAt: captureSessionMeta.capturedAt,
        includeFrames: options.includeFrames,
        maxChars: options.maxChars,
        preCaptureWindowMs: options.preCaptureWindowMs,
        postCaptureWindowMs: options.postCaptureWindowMs,
      })
    );
  } finally {
    sessionStore.deleteSession(session.sessionId);
    await cdpService.stopCaptureForTab(session.tabId).catch(() => undefined);
  }
}

export async function beginPageDomAnalysisEvidenceCapture(
  options: BeginPageDomAnalysisEvidenceCaptureOptions = {}
): Promise<PageEvidence> {
  const session = await startDomAnalysisSession({
    now: options.now,
    sessionStore: options.sessionStore,
  });

  return captureDomAnalysisEvidenceForSession({
    sessionId: session.sessionId,
    preCaptureWindowMs: options.preCaptureWindowMs,
    postCaptureWindowMs: options.postCaptureWindowMs,
    now: options.now,
    sessionStore: options.sessionStore,
    cdpService: options.cdpService,
    buildEvidence: options.buildEvidence,
  });
}
