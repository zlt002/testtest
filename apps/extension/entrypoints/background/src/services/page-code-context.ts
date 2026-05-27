import { readCurrentPageContent } from './read-current-page-content';
import type { CurrentPageGraphContext } from '@/entrypoints/sidepanel/lib/agent-v2/types';

type EnsureCompanionReadyResult = {
  agentApiBaseUrl: string;
};

type ResolveCurrentPageCodebaseContextInput = {
  tabId?: number;
  windowId?: number;
  maxChars?: number;
  includeFrames?: boolean;
  ensureCompanionReady: () => Promise<EnsureCompanionReadyResult>;
};

type CurrentPageBaseContext = {
  tabId?: number;
  windowId?: number;
  title?: string;
  url?: string;
  pathname?: string;
  hashRoute?: string;
  pageTextSummary: string[];
  apiCandidates: string[];
  resourceHints: string[];
  frameHints: {
    includeFrames: boolean;
    frameCount?: number;
  };
};

type RuntimeSignalCollection = {
  apiCandidates: string[];
  resourceHints: string[];
};

const MAX_RUNTIME_ENTRIES = 200;
const MAX_API_CANDIDATES = 12;
const MAX_RESOURCE_HINTS = 12;
const API_PATH_PATTERN = /\/api(?:[-/][^?#]*)?/i;
const API_KEYWORD_PATTERN = /(receipt|transport|dispatch|schedule|ntp|otp)/i;
const RESOURCE_HINT_PATTERN = /\.(?:js|mjs|cjs|css)$/i;

function extractPageTextSummary(text: string, maxKeywords = 20): string[] {
  const matches = text.match(/[A-Za-z0-9_./:-]+|[\u4e00-\u9fff]{2,}/g) || [];
  const summary: string[] = [];
  const seen = new Set<string>();

  for (const match of matches) {
    const keyword = match.trim().toLowerCase();
    if (!keyword || keyword.length <= 1 || seen.has(keyword)) {
      continue;
    }
    seen.add(keyword);
    summary.push(keyword);
    if (summary.length >= maxKeywords) {
      break;
    }
  }

  return summary;
}

async function resolveTargetTab(input: ResolveCurrentPageCodebaseContextInput) {
  if (typeof input.tabId === 'number') {
    return chrome.tabs.get(input.tabId);
  }

  const query: chrome.tabs.QueryInfo =
    typeof input.windowId === 'number'
      ? { active: true, windowId: input.windowId }
      : { active: true, lastFocusedWindow: true };
  const [activeTab] = await chrome.tabs.query(query);
  if (!activeTab) {
    throw new Error(
      'No active browser tab found for resolve_current_page_codebase_context.'
    );
  }

  return activeTab;
}

function buildCurrentPageCodebaseContext(
  tab: chrome.tabs.Tab,
  pageContent: Awaited<ReturnType<typeof readCurrentPageContent>>,
  includeFrames: boolean,
  runtimeSignals: RuntimeSignalCollection
): CurrentPageBaseContext {
  const resolvedUrl = pageContent.url || tab.url;
  let pathname: string | undefined;
  let hashRoute: string | undefined;

  if (resolvedUrl) {
    const parsedUrl = new URL(resolvedUrl);
    pathname = parsedUrl.pathname || undefined;
    hashRoute = parsedUrl.hash ? parsedUrl.hash.slice(1) || undefined : undefined;
  }

  return {
    tabId: tab.id,
    windowId: tab.windowId,
    title: pageContent.title || tab.title,
    url: resolvedUrl,
    pathname,
    hashRoute,
    pageTextSummary: extractPageTextSummary(pageContent.text || ''),
    apiCandidates: runtimeSignals.apiCandidates,
    resourceHints: runtimeSignals.resourceHints,
    frameHints: {
      includeFrames,
      frameCount: pageContent.frameAnalysis?.frameCount,
    },
  };
}

function collectPerformanceResourceNamesInPage(): string[] {
  try {
    return performance
      .getEntriesByType('resource')
      .flatMap((entry) => (typeof entry.name === 'string' ? [entry.name] : []))
      .slice(0, MAX_RUNTIME_ENTRIES);
  } catch {
    return [];
  }
}

function pushUnique(target: string[], seen: Set<string>, value: string, limit: number) {
  const normalizedValue = value.trim();
  if (!normalizedValue || seen.has(normalizedValue) || target.length >= limit) {
    return;
  }
  seen.add(normalizedValue);
  target.push(normalizedValue);
}

function extractRuntimeSignals(resourceNames: string[], pageUrl?: string): RuntimeSignalCollection {
  const apiCandidates: string[] = [];
  const resourceHints: string[] = [];
  const apiSeen = new Set<string>();
  const hintSeen = new Set<string>();

  for (const resourceName of resourceNames) {
    if (
      apiCandidates.length >= MAX_API_CANDIDATES &&
      resourceHints.length >= MAX_RESOURCE_HINTS
    ) {
      break;
    }

    let pathnameWithSearch = resourceName;
    let fileName = '';

    try {
      const parsedUrl = pageUrl ? new URL(resourceName, pageUrl) : new URL(resourceName);
      pathnameWithSearch = `${parsedUrl.pathname}${parsedUrl.search}`;
      const pathSegments = parsedUrl.pathname.split('/').filter(Boolean);
      fileName = pathSegments[pathSegments.length - 1] || '';
    } catch {
      const normalizedResource = resourceName.trim();
      pathnameWithSearch = normalizedResource;
      const pathSegments = normalizedResource.split('/').filter(Boolean);
      fileName = pathSegments[pathSegments.length - 1] || '';
    }

    const isStaticAsset = fileName ? RESOURCE_HINT_PATTERN.test(fileName) : false;

    if (
      !isStaticAsset &&
      (API_PATH_PATTERN.test(pathnameWithSearch) ||
        API_KEYWORD_PATTERN.test(pathnameWithSearch))
    ) {
      pushUnique(apiCandidates, apiSeen, pathnameWithSearch, MAX_API_CANDIDATES);
    }

    if (isStaticAsset && !API_PATH_PATTERN.test(pathnameWithSearch)) {
      pushUnique(resourceHints, hintSeen, fileName, MAX_RESOURCE_HINTS);
    }
  }

  return { apiCandidates, resourceHints };
}

async function collectRuntimeSignals(tabId: number | undefined, pageUrl?: string) {
  if (typeof tabId !== 'number') {
    return { apiCandidates: [], resourceHints: [] } satisfies RuntimeSignalCollection;
  }

  try {
    const injectionResults = await chrome.scripting.executeScript({
      target: { tabId },
      func: collectPerformanceResourceNamesInPage,
    });
    const resourceNames = injectionResults.flatMap((result) =>
      Array.isArray(result.result) ? result.result.filter((value): value is string => typeof value === 'string') : []
    );

    return extractRuntimeSignals(resourceNames, pageUrl);
  } catch {
    return { apiCandidates: [], resourceHints: [] } satisfies RuntimeSignalCollection;
  }
}

export async function resolveCurrentPageCodebaseContext(
  input: ResolveCurrentPageCodebaseContextInput
): Promise<{ context: CurrentPageGraphContext; resolution: unknown }> {
  const tab = await resolveTargetTab(input);
  const pageContent = await readCurrentPageContent({
    tabId: tab.id,
    windowId: tab.windowId,
    maxChars: input.maxChars,
    includeFrames: input.includeFrames,
    includeFrameAnalysis: input.includeFrames === true,
  });
  const runtimeSignals = await collectRuntimeSignals(tab.id, pageContent.url || tab.url);
  const baseContext = buildCurrentPageCodebaseContext(
    tab,
    pageContent,
    input.includeFrames === true,
    runtimeSignals
  );
  const context: CurrentPageGraphContext = baseContext;
  return { context, resolution: null };
}
