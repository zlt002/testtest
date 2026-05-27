import type { PageEvidence } from '@mcp-b/dom-analysis-contracts';
import {
  createRepoContextRouter,
  type PageGraphContextResolution,
} from '../codebase/repo-context-router.ts';
import type { PageCodebaseRule } from '../codebase/repo-routing-config.ts';
import type { AttributionResult, CodeLocationBucket, CodeLocationResult } from './types.ts';

type LocateInput = {
  pageEvidence: PageEvidence;
  attribution: AttributionResult;
  pageCodebaseMappingConfig?: {
    rules?: PageCodebaseRule[];
  };
};

function normalizeString(value: string | null | undefined): string | null {
  const normalized = value?.trim();
  return normalized ? normalized : null;
}

function dedupeTerms(values: Array<string | null | undefined>): string[] {
  const deduped: string[] = [];
  const seen = new Set<string>();

  for (const value of values) {
    const normalized = normalizeString(value);
    if (!normalized || seen.has(normalized)) {
      continue;
    }
    seen.add(normalized);
    deduped.push(normalized);
  }

  return deduped;
}

function buildBucket(graphProjects: string[], searchTerms: string[]): CodeLocationBucket {
  return {
    graphProjects,
    searchTerms: dedupeTerms(searchTerms),
  };
}

function collectCandidateApis(attribution: AttributionResult): string[] {
  return dedupeTerms([
    attribution.bestApi,
    ...attribution.candidateApis.map((candidate) => candidate.api),
  ]);
}

function createSearchBuckets(
  routeContext: PageGraphContextResolution,
  attribution: AttributionResult
): Pick<CodeLocationResult, 'frontend' | 'backend' | 'shared'> {
  const candidateApis = dedupeTerms([
    ...routeContext.apiCandidates,
    ...collectCandidateApis(attribution),
  ]);
  const pageTerms = routeContext.pageTextSummary;
  const resourceTerms = routeContext.resourceHints;

  return {
    frontend: buildBucket(routeContext.frontendGraphProjects, [
      routeContext.hashRoute,
      routeContext.pathname,
      ...pageTerms,
      ...resourceTerms,
      ...candidateApis,
    ]),
    backend: buildBucket(routeContext.backendGraphProjects, [
      ...candidateApis,
      routeContext.hashRoute,
      routeContext.pathname,
      ...pageTerms,
    ]),
    shared: buildBucket(routeContext.sharedGraphProjects, [
      ...resourceTerms,
      ...candidateApis,
      ...pageTerms,
    ]),
  };
}

export function createCodeLocationService(options?: {
  repoContextRouter?: ReturnType<typeof createRepoContextRouter>;
}) {
  const repoContextRouter = options?.repoContextRouter ?? createRepoContextRouter();

  return {
    locate(input: LocateInput): CodeLocationResult {
      const routeContext = repoContextRouter.resolve({
        url: input.pageEvidence.pageContext.url,
        pathname: input.pageEvidence.pageContext.pathname,
        hashRoute: input.pageEvidence.pageContext.hashRoute,
        pageTextSummary: input.pageEvidence.pageContext.pageTextSummary,
        apiCandidates: dedupeTerms([
          input.attribution.bestApi,
          ...input.attribution.candidateApis.map((candidate) => candidate.api),
          ...input.pageEvidence.pageContext.apiCandidates,
        ]),
        resourceHints: dedupeTerms([
          ...input.pageEvidence.pageContext.resourceHints,
          ...input.pageEvidence.runtimeEvidence.chunkHints,
        ]),
        pageCodebaseMappingConfig: input.pageCodebaseMappingConfig,
      });

      return {
        routeContext,
        ...createSearchBuckets(routeContext, input.attribution),
        attribution: input.attribution,
      };
    },
  };
}
