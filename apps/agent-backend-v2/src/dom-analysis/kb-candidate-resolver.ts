type KbRouteContext = {
  matched: boolean;
  triggerSkill: string | null;
  ewankbKb: string | null;
  ewankbMode: 'graph' | 'kb' | 'deep' | null;
};

type ResolveKbCandidateInput = {
  routeContext: KbRouteContext;
};

function normalizeKbCandidate(value: string | null): string | null {
  const normalized = value?.trim();
  return normalized ? normalized : null;
}

function supportsEwankbQuery(routeContext: KbRouteContext): boolean {
  return (
    routeContext.matched &&
    routeContext.triggerSkill === '/ewankb-server-query' &&
    (routeContext.ewankbMode === 'graph' ||
      routeContext.ewankbMode === 'kb' ||
      routeContext.ewankbMode === 'deep')
  );
}

export function resolveKbCandidate(input: ResolveKbCandidateInput): string | null {
  if (!supportsEwankbQuery(input.routeContext)) {
    return null;
  }

  return normalizeKbCandidate(input.routeContext.ewankbKb);
}
