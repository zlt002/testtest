import type { PickedElementContext } from '@/entrypoints/lib/page-picker';
import {
  type CaptureSessionMeta,
  type NetworkEvidenceItem,
  PageEvidenceSchema,
  type PageEvidence,
} from '@mcp-b/dom-analysis-contracts';
import {
  type ReadCurrentPageContentResult,
  readCurrentPageContent,
} from './read-current-page-content';
import { domAnalysisCdpService } from './dom-analysis-cdp';

const MAX_PAGE_SUMMARY_ITEMS = 20;
const MAX_API_CANDIDATES = 12;
const MAX_RESOURCE_HINTS = 12;
const MAX_SCRIPT_URLS = 20;

type BuildPageEvidenceInput = {
  tab: Pick<chrome.tabs.Tab, 'id' | 'windowId' | 'title' | 'url'>;
  targetElement: PickedElementContext;
  captureSessionMeta: CaptureSessionMeta;
  networkWindow?: {
    startTime: number;
    endTime: number;
  };
  includeFrames?: boolean;
  maxChars?: number;
};

type BuildPageEvidenceDependencies = {
  readPageContent?: (input: {
    tabId?: number;
    windowId?: number;
    maxChars?: number;
    includeFrames?: boolean;
    includeFrameAnalysis?: boolean;
  }) => Promise<ReadCurrentPageContentResult>;
  collectScriptUrls?: (tabId: number | undefined) => Promise<string[]>;
  getNetworkEvidence?: (
    tabId: number,
    window: {
      startTime: number;
      endTime: number;
    }
  ) => NetworkEvidenceItem[];
};

function collectScriptUrlsInPage(): string[] {
  const inlineScriptUrls = Array.from(document.scripts)
    .map((script) => script.src)
    .filter((value): value is string => typeof value === 'string' && value.trim().length > 0);
  const performanceScriptUrls = performance
    .getEntriesByType('resource')
    .flatMap((entry) => (typeof entry.name === 'string' ? [entry.name] : []))
    .filter((value) => /\.m?js(?:$|\?)/i.test(value) || /\.map(?:$|\?)/i.test(value));

  return [...inlineScriptUrls, ...performanceScriptUrls];
}

function uniqueStrings(values: string[], limit: number): string[] {
  const result: string[] = [];
  const seen = new Set<string>();

  for (const value of values) {
    const normalizedValue = value.trim();
    if (!normalizedValue || seen.has(normalizedValue)) {
      continue;
    }
    seen.add(normalizedValue);
    result.push(normalizedValue);
    if (result.length >= limit) {
      break;
    }
  }

  return result;
}

function extractPageTextSummary(text: string): string[] {
  const matches = text.match(/[A-Za-z0-9_./:-]+|[\u4e00-\u9fff]{2,}/g) || [];
  return uniqueStrings(matches.map((item) => item.toLowerCase()), MAX_PAGE_SUMMARY_ITEMS);
}

function extractFileName(urlLike: string): string | null {
  try {
    const parsedUrl = new URL(urlLike);
    const segments = parsedUrl.pathname.split('/').filter(Boolean);
    return segments[segments.length - 1] || null;
  } catch {
    const segments = urlLike.split('/').filter(Boolean);
    return segments[segments.length - 1] || null;
  }
}

function extractApiPath(urlLike: string): string {
  try {
    const parsedUrl = new URL(urlLike);
    return `${parsedUrl.pathname}${parsedUrl.search}`;
  } catch {
    return urlLike;
  }
}

async function defaultCollectScriptUrls(tabId: number | undefined): Promise<string[]> {
  if (typeof tabId !== 'number') {
    return [];
  }

  try {
    const results = await chrome.scripting.executeScript({
      target: { tabId },
      func: collectScriptUrlsInPage,
    });
    return uniqueStrings(
      results.flatMap((result) =>
        Array.isArray(result.result)
          ? result.result.filter((value): value is string => typeof value === 'string')
          : []
      ),
      MAX_SCRIPT_URLS
    );
  } catch {
    return [];
  }
}

export async function buildPageEvidence(
  input: BuildPageEvidenceInput,
  dependencies: BuildPageEvidenceDependencies = {}
): Promise<PageEvidence> {
  const readPageContentImpl = dependencies.readPageContent ?? readCurrentPageContent;
  const collectScriptUrlsImpl = dependencies.collectScriptUrls ?? defaultCollectScriptUrls;
  const getNetworkEvidenceImpl =
    dependencies.getNetworkEvidence ??
    ((tabId: number, window: { startTime: number; endTime: number }) =>
      domAnalysisCdpService.getNetworkEvidenceForTab(tabId, window));

  const pageContent = await readPageContentImpl({
    tabId: input.tab.id,
    windowId: input.tab.windowId,
    maxChars: input.maxChars,
    includeFrames: input.includeFrames,
    includeFrameAnalysis: false,
  });
  const scriptUrls = await collectScriptUrlsImpl(input.tab.id);
  const networkEvidence =
    typeof input.tab.id === 'number' && input.networkWindow
      ? getNetworkEvidenceImpl(input.tab.id, input.networkWindow)
      : [];
  const resolvedUrl = pageContent.url || input.tab.url || input.targetElement.url;

  let pathname: string | undefined;
  let hashRoute: string | undefined;
  if (resolvedUrl) {
    try {
      const parsedUrl = new URL(resolvedUrl);
      pathname = parsedUrl.pathname || undefined;
      hashRoute = parsedUrl.hash ? parsedUrl.hash.slice(1) || undefined : undefined;
    } catch {
      pathname = undefined;
      hashRoute = undefined;
    }
  }

  const resourceHints = uniqueStrings(
    scriptUrls
      .map((scriptUrl) => extractFileName(scriptUrl))
      .filter((value): value is string => Boolean(value)),
    MAX_RESOURCE_HINTS
  );
  const chunkHints = resourceHints.filter((value) => /\.chunk\.(?:m?js|cjs)$/i.test(value));
  const sourceMapHints = resourceHints.filter((value) => /\.map$/i.test(value));
  const apiCandidates = uniqueStrings(
    networkEvidence.map((item) => extractApiPath(item.url)),
    MAX_API_CANDIDATES
  );

  return PageEvidenceSchema.parse({
    targetElement: {
      selector: input.targetElement.selector,
      xpath: input.targetElement.xpath,
      tagName: input.targetElement.tagName,
      text: input.targetElement.text,
      outerHTMLSnippet: input.targetElement.outerHTMLSnippet,
      classList: input.targetElement.classList,
      dataAttributes: input.targetElement.dataAttributes,
    },
    pageContext: {
      url: resolvedUrl,
      pathname,
      hashRoute,
      title: pageContent.title || input.tab.title,
      pageTextSummary: extractPageTextSummary(pageContent.text || ''),
      apiCandidates,
      resourceHints,
    },
    networkEvidence,
    interactionEvidence: [],
    runtimeEvidence: {
      scriptUrls,
      chunkHints,
      sourceMapHints,
    },
    captureSessionMeta: input.captureSessionMeta,
  });
}
