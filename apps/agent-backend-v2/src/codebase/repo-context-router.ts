import { PAGE_CODEBASE_RULES, type PageCodebaseRule } from './repo-routing-config.ts';

export type PageGraphContextResolution = {
  matched: boolean;
  matchedRuleId: string | null;
  businessId: string | null;
  pageLabel: string | null;
  triggerSkill: string | null;
  ewankbKb: string | null;
  ewankbMode: 'graph' | 'kb' | 'deep' | null;
  url: string | null;
  pathname: string | null;
  hashRoute: string | null;
  pageTextSummary: string[];
  apiCandidates: string[];
  resourceHints: string[];
  frontendGraphProjects: string[];
  backendGraphProjects: string[];
  sharedGraphProjects: string[];
};

export type PageGraphContextResolveInput = {
  url?: string;
  pathname?: string;
  hashRoute?: string;
  pageTextSummary?: string[];
  apiCandidates?: string[];
  resourceHints?: string[];
};

const SCORE_BY_SIGNAL = {
  host: 2,
  pathname: 2,
  hashRoute: 4,
  apiPrefix: 5,
  resourceHint: 1,
};

type RuleSignalScore = {
  score: number;
  qualifiedBusinessSignal: boolean;
};

function normalizeText(value: string): string {
  return value.trim().toLowerCase();
}

function tryParseUrl(value?: string): URL | null {
  if (!value) {
    return null;
  }
  try {
    return new URL(value);
  } catch {
    return null;
  }
}

function collectExactMatches(candidates: string[], patterns: string[]): string[] {
  const normalizedCandidates = new Set(candidates.map(normalizeText));
  return patterns.filter((pattern) => normalizedCandidates.has(normalizeText(pattern)));
}

function collectIncludedMatches(candidates: string[], patterns: string[]): string[] {
  const normalizedCandidates = candidates.map(normalizeText);
  return patterns.filter((pattern) =>
    normalizedCandidates.some((candidate) => candidate.includes(normalizeText(pattern)))
  );
}

function scoreRule(rule: PageCodebaseRule, input: PageGraphContextResolveInput): RuleSignalScore {
  let score = 0;

  const parsedUrl = tryParseUrl(input.url);
  const host = parsedUrl?.hostname ? [parsedUrl.hostname] : [];
  const pathname = input.pathname ?? parsedUrl?.pathname ?? '';
  const hashRoute = input.hashRoute ?? parsedUrl?.hash.replace(/^#/, '') ?? '';
  const pageTextSummary = input.pageTextSummary ?? [];
  const apiCandidates = input.apiCandidates ?? [];
  const resourceHints = input.resourceHints ?? [];
  const pathnameMatched =
    Boolean(
      rule.pathnameIncludes &&
        pathname &&
        collectIncludedMatches([pathname], rule.pathnameIncludes).length > 0
    );
  const hashRouteMatched =
    Boolean(
      rule.hashRouteIncludes &&
        hashRoute &&
        collectIncludedMatches([hashRoute], rule.hashRouteIncludes).length > 0
    );
  const pageTextMatchedCount = rule.pageTextIncludes
    ? collectIncludedMatches(pageTextSummary, rule.pageTextIncludes).length
    : 0;
  const apiPrefixMatched =
    Boolean(
      rule.apiPrefixes &&
        collectIncludedMatches(apiCandidates, rule.apiPrefixes).length > 0
    );
  const resourceHintMatched =
    Boolean(
      rule.resourceHintIncludes &&
        collectIncludedMatches(resourceHints, rule.resourceHintIncludes).length > 0
    );

  if (rule.hostIncludes && collectExactMatches(host, rule.hostIncludes).length > 0) {
    score += SCORE_BY_SIGNAL.host;
  }

  if (pathnameMatched) {
    score += SCORE_BY_SIGNAL.pathname;
  }

  if (hashRouteMatched) {
    score += SCORE_BY_SIGNAL.hashRoute;
  }

  if (pageTextMatchedCount > 0) {
    score += pageTextMatchedCount;
  }

  if (apiPrefixMatched) {
    score += SCORE_BY_SIGNAL.apiPrefix;
  }

  if (resourceHintMatched) {
    score += SCORE_BY_SIGNAL.resourceHint;
  }

  return {
    score,
    qualifiedBusinessSignal:
      pathnameMatched ||
      hashRouteMatched ||
      apiPrefixMatched ||
      resourceHintMatched ||
      pageTextMatchedCount >= 2,
  };
}

function dedupeGraphProjects(graphProjects: string[]): string[] {
  return [...new Set(graphProjects.filter((project): project is string => typeof project === 'string'))];
}

function createEmptyResolution(input: PageGraphContextResolveInput): PageGraphContextResolution {
  return {
    matched: false,
    matchedRuleId: null,
    businessId: null,
    pageLabel: null,
    triggerSkill: null,
    ewankbKb: null,
    ewankbMode: null,
    url: input.url ?? null,
    pathname: input.pathname ?? null,
    hashRoute: input.hashRoute ?? null,
    pageTextSummary: input.pageTextSummary ?? [],
    apiCandidates: input.apiCandidates ?? [],
    resourceHints: input.resourceHints ?? [],
    frontendGraphProjects: [],
    backendGraphProjects: [],
    sharedGraphProjects: [],
  };
}

export function createRepoContextRouter(options?: {
  projectNameByRepo?: Record<string, string>;
}) {
  return {
    resolve(
      input: PageGraphContextResolveInput & {
        pageCodebaseMappingConfig?: {
          rules?: PageCodebaseRule[];
        };
      }
    ): PageGraphContextResolution {
      const rules =
        input.pageCodebaseMappingConfig?.rules?.filter((rule) => rule.enabled !== false) ??
        PAGE_CODEBASE_RULES;

      let bestRule: PageCodebaseRule | null = null;
      let bestScore = 0;

      for (const rule of rules) {
        const signalScore = scoreRule(rule, input);
        const minimumScore = rule.minimumScore ?? 1;
        if (signalScore.score < minimumScore || !signalScore.qualifiedBusinessSignal) {
          continue;
        }
        if (signalScore.score > bestScore) {
          bestRule = rule;
          bestScore = signalScore.score;
        }
      }

      if (!bestRule) {
        return createEmptyResolution(input);
      }

      return {
        matched: true,
        matchedRuleId: bestRule.id,
        businessId: bestRule.businessId ?? null,
        pageLabel: bestRule.pageLabel ?? null,
        triggerSkill: bestRule.triggerSkill ?? null,
        ewankbKb: bestRule.ewankbKb ?? bestRule.businessId ?? null,
        ewankbMode: bestRule.ewankbMode ?? 'graph',
        url: input.url ?? null,
        pathname: input.pathname ?? null,
        hashRoute: input.hashRoute ?? null,
        pageTextSummary: input.pageTextSummary ?? [],
        apiCandidates: input.apiCandidates ?? [],
        resourceHints: input.resourceHints ?? [],
        frontendGraphProjects: dedupeGraphProjects(bestRule.frontendGraphProjects),
        backendGraphProjects: dedupeGraphProjects(bestRule.backendGraphProjects),
        sharedGraphProjects: dedupeGraphProjects(bestRule.sharedGraphProjects ?? []),
      };
    },
  };
}
