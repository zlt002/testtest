export type FrameStrategy = 'main-only' | 'all-accessible' | 'wps-priority';

export type FrameCandidateBlock = {
  selector: string;
  tag: string;
  id: string;
  className: string;
  textLen: number;
  sample: string;
};

export type FrameWpsSignals = {
  hostMatched: boolean;
  runtimeDetected: boolean;
  editorContainerDetected: boolean;
};

export type FrameSelectionSummary = {
  mode?: 'spreadsheet' | 'document' | 'unknown';
  source?: string | null;
  address?: string | null;
  text?: string | null;
  formula?: string | null;
  value2?: unknown;
  row?: number;
  column?: number;
  rowsCount?: number;
  columnsCount?: number;
  isCollapsed?: boolean;
  rangeCount?: number;
  domSelection?: {
    type?: string | null;
    isCollapsed?: boolean;
    rangeCount?: number;
    text?: string;
  } | null;
} | null;

type FrameDomSelectionSummary = NonNullable<NonNullable<FrameSelectionSummary>['domSelection']>;

export type FrameContentInspection = {
  frameId: number;
  parentFrameId: number;
  url: string;
  title: string;
  bodyTextLen: number;
  bodySample: string;
  candidates: FrameCandidateBlock[];
  wpsSignals: FrameWpsSignals;
  selection: FrameSelectionSummary;
};

export type ScoredFrameInspection = FrameContentInspection & {
  score: number;
  role: 'main' | 'shell' | 'wps-content' | 'auxiliary';
  reasons: string[];
};

export type ReadCurrentPageContentOptions = {
  tabId?: number;
  windowId?: number;
  maxChars?: number;
  includeFrames?: boolean;
  maxFrames?: number;
  frameStrategy?: FrameStrategy;
  includeFrameAnalysis?: boolean;
};

export type ReadCurrentPageContentResult = {
  success: boolean;
  title: string;
  url: string;
  text: string;
  selection?: FrameSelectionSummary;
  frameAnalysis?: {
    frameCount: number;
    bestFrameId?: number;
    bestFrameUrl?: string;
    bestCandidateSelector?: string;
    reasons: string[];
    frames: Array<{
      frameId: number;
      parentFrameId: number;
      url: string;
      title: string;
      score: number;
      role: 'main' | 'shell' | 'wps-content' | 'auxiliary';
      bodyTextLen: number;
      candidateCount: number;
      topCandidateTextLen?: number;
      wpsSignals: FrameWpsSignals;
      selection?: FrameSelectionSummary;
    }>;
  };
};

type ChromeScriptingResult = {
  frameId?: number;
  result?: unknown;
};

const DEFAULT_MAX_CHARS = 12_000;
const DEFAULT_MAX_FRAMES = 12;
const CANDIDATE_SELECTORS = [
  'main',
  'article',
  '[role="main"]',
  '.editor',
  '.document',
  '.doc-content',
  '.ql-editor',
  '.ProseMirror',
  '.markdown-body',
  '.content',
  '.viewer',
  '#app',
  '#webDoc',
];
const WPS_HOST_PATTERNS = ['webedit.midea.com', 'doc.midea.com', 'kdocs.cn', 'kdocs.com'];
const SHELL_TEXT_TERMS = [
  '分享',
  '协作',
  '权限',
  '更多设置',
  '下载',
  '历史版本',
  '开始',
  '插入',
  '数据',
  '公式',
  '视图',
  '效率',
  '导航',
  '目录',
];
const SCRIPT_NOISE_PATTERNS = [
  '.kd-stroke-width-icon',
  '.kd-color-icon',
  'System.import(',
  'window.__CONFIG__',
  'window.__WPSENV__',
];

function normalizeWhitespace(value: unknown): string {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function isSupportedTabUrl(url: string | undefined): boolean {
  if (!url) {
    return false;
  }

  return !/^(chrome|chrome-extension|edge|about):/i.test(url);
}

function looksLikeShellText(text: string): boolean {
  if (!text) {
    return false;
  }
  return SHELL_TEXT_TERMS.filter((term) => text.includes(term)).length >= 3;
}

function looksLikeScriptNoise(text: string): boolean {
  if (!text) {
    return false;
  }
  return SCRIPT_NOISE_PATTERNS.some((pattern) => text.includes(pattern));
}

function isWpsHost(url: string): boolean {
  try {
    const hostname = new URL(url).hostname.toLowerCase();
    return WPS_HOST_PATTERNS.some((host) => hostname === host || hostname.endsWith(`.${host}`));
  } catch {
    return false;
  }
}

export function chooseBestCandidate(frame: FrameContentInspection): FrameCandidateBlock | undefined {
  if (!frame.candidates.length) {
    return undefined;
  }

  const ranked = [...frame.candidates].sort((left, right) => {
    const leftPenalty = looksLikeShellText(left.sample) || looksLikeScriptNoise(left.sample) ? 1 : 0;
    const rightPenalty =
      looksLikeShellText(right.sample) || looksLikeScriptNoise(right.sample) ? 1 : 0;

    if (leftPenalty !== rightPenalty) {
      return leftPenalty - rightPenalty;
    }

    if (left.textLen !== right.textLen) {
      return right.textLen - left.textLen;
    }

    return left.selector.localeCompare(right.selector);
  });

  return ranked[0];
}

export function scoreFrameInspection(
  frame: FrameContentInspection,
  strategy: FrameStrategy
): Pick<ScoredFrameInspection, 'score' | 'role' | 'reasons'> {
  let score = 0;
  const reasons: string[] = [];
  const bestCandidate = chooseBestCandidate(frame);
  const bodySample = frame.bodySample;

  if (frame.bodyTextLen > 0) {
    score += 10;
    reasons.push('has_text');
  }

  if (frame.bodyTextLen > 200) {
    score += 15;
    reasons.push('body_text_substantial');
  }

  if (bestCandidate && bestCandidate.textLen > 100) {
    score += 15;
    reasons.push('content_candidate_detected');
  }

  if (bestCandidate && frame.bodyTextLen > 0) {
    const density = bestCandidate.textLen / Math.max(frame.bodyTextLen, 1);
    if (density >= 0.35 && density <= 1.15) {
      score += 10;
      reasons.push('candidate_density_good');
    }
  }

  if (frame.url === 'about:blank') {
    score -= 30;
    reasons.push('blank_frame_penalty');
  }

  if (looksLikeShellText(bodySample) || (bestCandidate && looksLikeShellText(bestCandidate.sample))) {
    score -= 20;
    reasons.push('shell_text_penalty');
  }

  if (looksLikeScriptNoise(bodySample) || (bestCandidate && looksLikeScriptNoise(bestCandidate.sample))) {
    score -= 25;
    reasons.push('script_noise_penalty');
  }

  if (strategy === 'wps-priority') {
    if (isWpsHost(frame.url)) {
      score += frame.url.includes('webedit.') ? 40 : 25;
      reasons.push('wps_host_matched');
    }
    if (frame.wpsSignals.hostMatched) {
      score += 15;
      reasons.push('wps_signal_host_matched');
    }
    if (frame.wpsSignals.runtimeDetected) {
      score += 50;
      reasons.push('wps_runtime_detected');
    }
    if (frame.wpsSignals.editorContainerDetected) {
      score += 20;
      reasons.push('wps_editor_container_detected');
    }
  }

  let role: ScoredFrameInspection['role'] = frame.frameId === 0 ? 'main' : 'auxiliary';
  if (frame.wpsSignals.runtimeDetected || (isWpsHost(frame.url) && frame.wpsSignals.editorContainerDetected)) {
    role = 'wps-content';
  } else if (score <= 10 || looksLikeShellText(bodySample)) {
    role = 'shell';
  }

  return { score, role, reasons };
}

export function selectBestFrameInspection(
  frames: FrameContentInspection[],
  strategy: FrameStrategy
): ScoredFrameInspection | undefined {
  const scored = frames.map((frame) => ({
    ...frame,
    ...scoreFrameInspection(frame, strategy),
  }));

  scored.sort((left, right) => {
    if (right.score !== left.score) {
      return right.score - left.score;
    }
    return right.bodyTextLen - left.bodyTextLen;
  });

  if (strategy === 'main-only') {
    return scored.find((frame) => frame.frameId === 0) || scored[0];
  }

  if (strategy === 'wps-priority') {
    return (
      scored.find((frame) => frame.wpsSignals.runtimeDetected) ||
      scored.find((frame) => isWpsHost(frame.url)) ||
      scored[0]
    );
  }

  return scored[0];
}

function buildFrameAnalysis(
  frames: FrameContentInspection[],
  strategy: FrameStrategy,
  bestFrame: ScoredFrameInspection | undefined
): ReadCurrentPageContentResult['frameAnalysis'] {
  const scored = frames
    .map((frame) => ({
      ...frame,
      ...scoreFrameInspection(frame, strategy),
    }))
    .sort((left, right) => right.score - left.score);
  const bestCandidate = bestFrame ? chooseBestCandidate(bestFrame) : undefined;

  return {
    frameCount: frames.length,
    bestFrameId: bestFrame?.frameId,
    bestFrameUrl: bestFrame?.url,
    bestCandidateSelector: bestCandidate?.selector,
    reasons: bestFrame?.reasons || [],
    frames: scored.map((frame) => ({
      frameId: frame.frameId,
      parentFrameId: frame.parentFrameId,
      url: frame.url,
      title: frame.title,
      score: frame.score,
      role: frame.role,
      bodyTextLen: frame.bodyTextLen,
      candidateCount: frame.candidates.length,
      topCandidateTextLen: chooseBestCandidate(frame)?.textLen,
      wpsSignals: frame.wpsSignals,
      selection: frame.selection,
    })),
  };
}

function pickResultText(frame: FrameContentInspection | undefined, maxChars: number): string {
  if (!frame) {
    return '';
  }

  const candidateText = chooseBestCandidate(frame)?.sample;
  const text = normalizeWhitespace(candidateText || frame.bodySample);
  return text.slice(0, maxChars);
}

async function resolveTargetTabId(tabId: number | undefined, windowId: number | undefined) {
  if (tabId !== undefined) {
    return tabId;
  }

  const query: chrome.tabs.QueryInfo =
    windowId !== undefined ? { active: true, windowId } : { active: true, lastFocusedWindow: true };
  const [activeTab] = await chrome.tabs.query(query);
  return activeTab?.id;
}

type FrameInspectPageResult = {
  title: string;
  url: string;
  bodyTextLen: number;
  bodySample: string;
  candidates: FrameCandidateBlock[];
  wpsSignals: FrameWpsSignals;
  selection: FrameSelectionSummary;
};

type RuntimeDocumentTextPayload = {
  text?: string | null;
  source?: string | null;
} | string | null;

type RuntimeDocumentSelectionPayload = {
  text?: string | null;
  source?: string | null;
  isCollapsed?: boolean;
  rangeCount?: number;
  domSelection?: FrameDomSelectionSummary;
} | null;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function toFrameSelectionSummary(
  value: RuntimeDocumentSelectionPayload,
  domSelection: FrameDomSelectionSummary | null
): FrameSelectionSummary {
  if (!isPlainObject(value) && !isPlainObject(domSelection)) {
    return null;
  }

  const payload = isPlainObject(value) ? value : {};
  const dom = isPlainObject(payload.domSelection)
    ? payload.domSelection
    : isPlainObject(domSelection)
      ? domSelection
      : null;
  const payloadText = typeof payload.text === 'string' ? payload.text : null;
  const domText = dom && typeof dom.text === 'string' ? dom.text : null;
  const domHasText = !!domText && domText.trim().length > 0;
  const payloadHasText = !!payloadText && payloadText.trim().length > 0;
  const preferDomSelection = domHasText && !payloadHasText;

  return {
    mode: 'document',
    source: preferDomSelection
      ? 'dom-selection'
      : typeof payload.source === 'string'
        ? payload.source
        : null,
    text: payloadHasText ? payloadText : domText,
    isCollapsed: preferDomSelection
      ? typeof dom?.isCollapsed === 'boolean'
        ? dom.isCollapsed
        : undefined
      : typeof payload.isCollapsed === 'boolean'
        ? payload.isCollapsed
        : undefined,
    rangeCount: preferDomSelection
      ? typeof dom?.rangeCount === 'number'
        ? dom.rangeCount
        : undefined
      : typeof payload.rangeCount === 'number'
        ? payload.rangeCount
        : undefined,
    domSelection: dom
      ? {
          type: typeof dom.type === 'string' ? dom.type : null,
          isCollapsed: typeof dom.isCollapsed === 'boolean' ? dom.isCollapsed : undefined,
          rangeCount: typeof dom.rangeCount === 'number' ? dom.rangeCount : undefined,
          text: typeof dom.text === 'string' ? dom.text : undefined,
        }
      : null,
  };
}

async function inspectFrameInPage(
  limit: number,
  selectors: string[],
  wpsHosts: string[]
): Promise<FrameInspectPageResult> {
  const normalize = (value: unknown) => String(value || '').replace(/\s+/g, ' ').trim();
  const body = document.body || document.documentElement;
  const bodyText = normalize((body as HTMLElement | null)?.innerText || body?.textContent || '');
  const candidates = selectors
    .map((selector) => {
      const element = document.querySelector(selector);
      if (!(element instanceof HTMLElement)) {
        return null;
      }

      const text = normalize(element.innerText || element.textContent || '');
      if (!text) {
        return null;
      }

      return {
        selector,
        tag: element.tagName.toLowerCase(),
        id: element.id || '',
        className: typeof element.className === 'string' ? element.className : '',
        textLen: text.length,
        sample: text.slice(0, limit),
      };
    })
    .filter((value): value is FrameCandidateBlock => Boolean(value));

  const hostMatched = wpsHosts.some((host) => location.hostname === host || location.hostname.endsWith(`.${host}`));
  const adapter = (window as Window & { __webeditRuntimeAdapter?: any }).__webeditRuntimeAdapter;
  const runtimeDetected =
    typeof (window as Window & { WPSOpenApi?: unknown }).WPSOpenApi !== 'undefined' ||
    typeof (window as Window & { __WPSENV__?: unknown }).__WPSENV__ !== 'undefined' ||
    Boolean(adapter);
  const editorContainerDetected = Boolean(
    document.querySelector('#webDoc, #app, .document-cloud, .doc-content, .onlineDoc_header')
  );

  let selection: FrameSelectionSummary = null;
  let runtimeDocumentText = '';
  try {
    if (adapter && typeof adapter.getEditorApplication === 'function') {
      const app = await adapter.getEditorApplication();
      const runtimeMode =
        typeof adapter.detectRuntimeMode === 'function' ? await adapter.detectRuntimeMode() : null;
      const domSelection =
        typeof adapter.summarizeDomSelection === 'function' ? adapter.summarizeDomSelection() : null;

      if (runtimeMode === 'document') {
        if (typeof adapter.readDocumentText === 'function') {
          const documentText = (await adapter.readDocumentText()) as RuntimeDocumentTextPayload;
          const textValue =
            typeof documentText === 'string'
              ? documentText
              : typeof documentText?.text === 'string'
                ? documentText.text
                : '';
          if (textValue.trim()) {
            runtimeDocumentText = normalize(textValue);
          }
        }

        if (typeof adapter.getDocumentSelection === 'function') {
          const documentSelection =
            (await adapter.getDocumentSelection()) as RuntimeDocumentSelectionPayload;
          selection = toFrameSelectionSummary(documentSelection, domSelection);
        } else if (domSelection) {
          selection = toFrameSelectionSummary(null, domSelection);
        }
      } else if (app && typeof adapter.getSelectionRange === 'function') {
        const range = await adapter.getSelectionRange(app);
        if (range && typeof adapter.summarizeRange === 'function') {
          selection = await adapter.summarizeRange(range);
        }
        if (selection) {
          selection = {
            ...selection,
            mode: 'spreadsheet',
            domSelection: domSelection || null,
          };
        }
      }
    }
  } catch {
    selection = null;
  }

  const effectiveBodyText = runtimeDocumentText || bodyText;
  if (runtimeDocumentText) {
    candidates.unshift({
      selector: '__runtime_document_text__',
      tag: 'runtime',
      id: '',
      className: 'runtime-document-text',
      textLen: runtimeDocumentText.length,
      sample: runtimeDocumentText.slice(0, limit),
    });
  }

  return {
    title: document.title,
    url: location.href,
    bodyTextLen: effectiveBodyText.length,
    bodySample: effectiveBodyText.slice(0, limit),
    candidates,
    wpsSignals: {
      hostMatched,
      runtimeDetected,
      editorContainerDetected,
    },
    selection,
  };
}

async function inspectFrames(
  tabId: number,
  frames: Array<{ frameId: number; parentFrameId?: number; url?: string }>,
  maxChars: number
): Promise<FrameContentInspection[]> {
  const candidateFrames = frames.slice(0, DEFAULT_MAX_FRAMES);
  const frameIds = candidateFrames
    .map((frame) => frame.frameId)
    .filter((frameId) => Number.isInteger(frameId));

  const scriptResults = await chrome.scripting.executeScript({
    target: { tabId, frameIds },
    world: 'MAIN',
    func: inspectFrameInPage,
    args: [Math.min(maxChars, DEFAULT_MAX_CHARS), CANDIDATE_SELECTORS, WPS_HOST_PATTERNS],
  });

  const byFrameId = new Map<number, ChromeScriptingResult>();
  for (const result of scriptResults as ChromeScriptingResult[]) {
    if (typeof result.frameId === 'number') {
      byFrameId.set(result.frameId, result);
    }
  }

  return candidateFrames
    .map((frame) => {
      const execution = byFrameId.get(frame.frameId);
      const payload = execution?.result as FrameInspectPageResult | undefined;
      if (!payload) {
        return null;
      }

      return {
        frameId: frame.frameId,
        parentFrameId: frame.parentFrameId ?? -1,
        url: payload.url || frame.url || '',
        title: payload.title,
        bodyTextLen: payload.bodyTextLen,
        bodySample: payload.bodySample,
        candidates: payload.candidates,
        wpsSignals: payload.wpsSignals,
        selection: payload.selection,
      } satisfies FrameContentInspection;
    })
    .filter((value): value is FrameContentInspection => Boolean(value));
}

export async function readCurrentPageContent(
  options: ReadCurrentPageContentOptions
): Promise<ReadCurrentPageContentResult> {
  const targetTabId = await resolveTargetTabId(options.tabId, options.windowId);
  if (targetTabId === undefined) {
    throw new Error('No active browser tab found for read_current_page_content.');
  }

  const tab = await chrome.tabs.get(targetTabId);
  if (!isSupportedTabUrl(tab.url)) {
    throw new Error(`Cannot read page content from this tab URL: ${tab.url || 'unknown'}`);
  }

  const maxChars = options.maxChars ?? DEFAULT_MAX_CHARS;
  const includeFrames = options.includeFrames === true;
  const strategy = options.frameStrategy ?? 'main-only';

  if (!includeFrames) {
    const [result] = await chrome.scripting.executeScript({
      target: { tabId: targetTabId },
      world: 'MAIN',
      func: inspectFrameInPage,
      args: [maxChars, ['main', 'article', '[role="main"]', 'body'], WPS_HOST_PATTERNS],
    });
    const payload = result?.result as FrameInspectPageResult | undefined;
    if (!payload) {
      throw new Error('No result returned');
    }

    return {
      success: true,
      title: payload.title,
      url: payload.url,
      text: normalizeWhitespace(chooseBestCandidate({
        frameId: 0,
        parentFrameId: -1,
        url: payload.url,
        title: payload.title,
        bodyTextLen: payload.bodyTextLen,
        bodySample: payload.bodySample,
        candidates: payload.candidates,
        wpsSignals: payload.wpsSignals,
        selection: payload.selection,
      })?.sample || payload.bodySample).slice(0, maxChars),
      selection: payload.selection,
    };
  }

  const allFrames = await chrome.webNavigation.getAllFrames({ tabId: targetTabId });
  const accessibleFrames = (allFrames || [])
    .filter((frame) => typeof frame.frameId === 'number' && isSupportedTabUrl(frame.url))
    .slice(0, options.maxFrames ?? DEFAULT_MAX_FRAMES)
    .map((frame) => ({
      frameId: frame.frameId,
      parentFrameId: frame.parentFrameId,
      url: frame.url,
    }));

  const inspections = await inspectFrames(targetTabId, accessibleFrames, maxChars);
  const bestFrame = selectBestFrameInspection(inspections, strategy);

  return {
    success: true,
    title: tab.title || bestFrame?.title || '',
    url: tab.url || bestFrame?.url || '',
    text: pickResultText(bestFrame, maxChars),
    selection: bestFrame?.selection,
    frameAnalysis:
      options.includeFrameAnalysis === true
        ? buildFrameAnalysis(inspections, strategy, bestFrame)
        : undefined,
  };
}
