type ResolvePageFeatureInput = {
  pageTitle?: string | null;
  pageLabel?: string | null;
  hashRoute?: string | null;
  navLabels?: string[];
  pageTextSummary: string[];
};

export type PageFeatureResolution = {
  primaryFeatureName: string | null;
  featureNameCandidates: string[];
};

const HASH_ROUTE_FEATURE_MAP: Record<string, string> = {
  expressInquiry: '快递询价',
};

function normalizeCandidate(value: string | null | undefined): string | null {
  const normalized = value?.trim();
  return normalized ? normalized : null;
}

function dedupeCandidates(items: Array<string | null | undefined>): string[] {
  const result: string[] = [];

  for (const item of items) {
    const normalized = normalizeCandidate(item);
    if (normalized && !result.includes(normalized)) {
      result.push(normalized);
    }
  }

  return result;
}

function resolveRouteFeatureName(hashRoute?: string | null): string | null {
  const routeLeaf = hashRoute?.split('/').filter(Boolean).at(-1) ?? null;
  return routeLeaf ? HASH_ROUTE_FEATURE_MAP[routeLeaf] ?? null : null;
}

export function resolvePageFeature(input: ResolvePageFeatureInput): PageFeatureResolution {
  const summaryCandidates = input.pageTextSummary.filter((term) => term.trim().length >= 2);
  const featureNameCandidates = dedupeCandidates([
    input.pageTitle,
    input.pageLabel,
    ...(input.navLabels ?? []),
    resolveRouteFeatureName(input.hashRoute),
    ...summaryCandidates,
  ]);

  return {
    primaryFeatureName: featureNameCandidates[0] ?? null,
    featureNameCandidates,
  };
}
