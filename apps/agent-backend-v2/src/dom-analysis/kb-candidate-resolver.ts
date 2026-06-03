type KbRouteContext = {
  matched: boolean;
  triggerSkill: string | null;
  ewankbKb: string | null;
  ewankbMode: 'graph' | 'kb' | 'deep' | null;
};

type ResolveKbCandidateInput = {
  routeContext: KbRouteContext;
  pageUrl?: string | null;
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

function inferKbCandidateFromUrl(pageUrl?: string | null): string | null {
  if (!pageUrl) {
    return null;
  }

  try {
    const host = new URL(pageUrl).hostname.toLowerCase();
    const match = host.match(/^([a-z0-9]+)(?:-[a-z0-9-]+)?\.annto\.com$/i);
    if (!match) {
      return null;
    }

    const candidate = match[1]?.trim();
    return candidate ? candidate : null;
  } catch {
    return null;
  }
}

export function resolveKbCandidate(input: ResolveKbCandidateInput): string | null {
  if (supportsEwankbQuery(input.routeContext)) {
    return normalizeKbCandidate(input.routeContext.ewankbKb);
  }

  return inferKbCandidateFromUrl(input.pageUrl);
}
