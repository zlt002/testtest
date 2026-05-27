import { shouldDelayWebEditIframeHandshake } from './iframe-origin';
import { rankWebEditIframeCandidate } from './webedit-iframe-candidates';

export type WebEditIframeReadyEvent = {
  source: unknown;
  origin: string;
  data?: {
    channel?: string;
    type?: string;
    direction?: string;
    payload?: string;
  };
};

export type WebEditIframeReadyCandidate = {
  sourceWindow?: Window | null;
  origin?: string | null;
  id?: string | null;
  srcOrigin?: string | null;
};

export type WebEditIframeReadyMatch =
  | {
      matched: true;
      matchedBy: 'source+origin';
    }
  | {
      matched: false;
      matchedBy: 'source-only' | 'origin-only' | 'none';
    };

function isReadyMessage(event: WebEditIframeReadyEvent): boolean {
  return (
    event.data?.channel === 'mcp-iframe' &&
    event.data?.type === 'mcp' &&
    event.data?.direction === 'server-to-client' &&
    event.data?.payload === 'mcp-server-ready'
  );
}

export function matchWebEditIframeReadyEvent(
  event: WebEditIframeReadyEvent,
  candidate: WebEditIframeReadyCandidate
): WebEditIframeReadyMatch {
  if (!isReadyMessage(event)) {
    return { matched: false, matchedBy: 'none' };
  }

  const matchesSource = Boolean(candidate.sourceWindow && event.source === candidate.sourceWindow);
  const matchesOrigin = Boolean(candidate.origin && event.origin === candidate.origin);

  if (matchesSource && matchesOrigin) {
    return { matched: true, matchedBy: 'source+origin' };
  }

  if (matchesSource) {
    return { matched: false, matchedBy: 'source-only' };
  }

  if (matchesOrigin) {
    return { matched: false, matchedBy: 'origin-only' };
  }

  return { matched: false, matchedBy: 'none' };
}

export function selectBestWebEditIframeReadyCandidate(
  event: WebEditIframeReadyEvent,
  candidates: WebEditIframeReadyCandidate[]
): WebEditIframeReadyCandidate | null {
  if (!isReadyMessage(event)) {
    return null;
  }

  const matched = candidates.filter((candidate) => {
    const match = matchWebEditIframeReadyEvent(event, candidate);
    return match.matched;
  });

  if (matched.length === 0) {
    return null;
  }

  return matched
    .map((candidate) => ({
      candidate,
      priority: rankWebEditIframeCandidate({
        id: candidate.id,
        srcOrigin: candidate.srcOrigin ?? candidate.origin ?? null,
        hasReadyMatch: true,
      }),
    }))
    .sort((left, right) => right.priority - left.priority)[0].candidate;
}

export { shouldDelayWebEditIframeHandshake };
