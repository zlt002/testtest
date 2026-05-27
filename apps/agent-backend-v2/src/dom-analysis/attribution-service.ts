import type {
  NetworkEvidenceItem,
  PageEvidence,
  PageContext,
} from '@mcp-b/dom-analysis-contracts';
import type {
  AttributionCandidate,
  AttributionEvidenceLabel,
  AttributionResult,
} from './types.ts';

type CandidateState = {
  api: string;
  score: number;
  evidence: Set<AttributionEvidenceLabel>;
  responsePreviews: string[];
};

const API_CANDIDATE_SCORE = 6;
const NETWORK_REQUEST_SCORE = 8;
const ELEMENT_TEXT_SCORE = 2;
const PAGE_SUMMARY_SCORE = 2;
const RESPONSE_PREVIEW_SCORE = 2;
const HIGH_CONFIDENCE_SCORE = 20;
const MEDIUM_CONFIDENCE_SCORE = 10;
const HIGH_CONFIDENCE_MARGIN = 4;

function normalizeApiPath(urlLike: string): string | null {
  try {
    const parsedUrl = new URL(urlLike);
    return normalizeApiPath(parsedUrl.pathname);
  } catch {
    const trimmed = urlLike.trim();
    if (!trimmed) {
      return null;
    }
    const withoutQuery = trimmed.split('?')[0]?.trim() ?? '';
    if (!withoutQuery.startsWith('/')) {
      return null;
    }
    return withoutQuery || null;
  }
}

function extractSemanticTokens(value: string): string[] {
  const matches = value.toLowerCase().match(/[a-z0-9_/-]+|[\u4e00-\u9fff]{2,}/g);
  return matches?.filter((token) => token.trim().length >= 2) ?? [];
}

function collectPageSignalTokens(pageContext: PageContext, targetElementText: string | null): string[] {
  return [
    ...(targetElementText ? extractSemanticTokens(targetElementText) : []),
    ...extractSemanticTokens(pageContext.title ?? ''),
    ...pageContext.pageTextSummary.flatMap((item) => extractSemanticTokens(item)),
  ];
}

function hasRelatedTextEvidence(candidate: CandidateState, pageSignalTokens: string[]): boolean {
  if (pageSignalTokens.length === 0) {
    return false;
  }

  return candidate.responsePreviews.some((preview) => {
    const previewText = preview.toLowerCase();
    return pageSignalTokens.some((token) => previewText.includes(token));
  });
}

function getOrCreateCandidate(
  candidates: Map<string, CandidateState>,
  api: string
): CandidateState {
  let candidate = candidates.get(api);
  if (!candidate) {
    candidate = {
      api,
      score: 0,
      evidence: new Set<AttributionEvidenceLabel>(),
      responsePreviews: [],
    };
    candidates.set(api, candidate);
  }
  return candidate;
}

function addEvidence(
  candidate: CandidateState,
  label: AttributionEvidenceLabel,
  score: number
) {
  if (candidate.evidence.has(label)) {
    return;
  }
  candidate.evidence.add(label);
  candidate.score += score;
}

function attachNetworkSignals(candidate: CandidateState, item: NetworkEvidenceItem) {
  addEvidence(candidate, 'network-request', NETWORK_REQUEST_SCORE);
  if (item.responsePreview?.trim()) {
    addEvidence(candidate, 'response-preview', RESPONSE_PREVIEW_SCORE);
    candidate.responsePreviews.push(item.responsePreview.trim());
  }
}

function toAttributionCandidate(candidate: CandidateState): AttributionCandidate {
  return {
    api: candidate.api,
    score: candidate.score,
    evidence: Array.from(candidate.evidence),
  };
}

export function createAttributionService() {
  return {
    attribute(pageEvidence: PageEvidence): AttributionResult {
      const candidates = new Map<string, CandidateState>();
      const pageSignalTokens = collectPageSignalTokens(
        pageEvidence.pageContext,
        pageEvidence.targetElement.text
      );

      for (const apiCandidate of pageEvidence.pageContext.apiCandidates) {
        const normalizedApi = normalizeApiPath(apiCandidate);
        if (!normalizedApi) {
          continue;
        }
        addEvidence(
          getOrCreateCandidate(candidates, normalizedApi),
          'api-candidate',
          API_CANDIDATE_SCORE
        );
      }

      for (const item of pageEvidence.networkEvidence) {
        const normalizedApi = normalizeApiPath(item.url);
        if (!normalizedApi) {
          continue;
        }
        attachNetworkSignals(getOrCreateCandidate(candidates, normalizedApi), item);
      }

      if (candidates.size === 1) {
        const [candidate] = candidates.values();
        const hasTextBridge = hasRelatedTextEvidence(candidate, pageSignalTokens);
        if (hasTextBridge && pageEvidence.targetElement.text?.trim()) {
          addEvidence(candidate, 'element-text', ELEMENT_TEXT_SCORE);
        }
        if (hasTextBridge && pageSignalTokens.length > 0) {
          addEvidence(candidate, 'page-summary', PAGE_SUMMARY_SCORE);
        }
      }

      const candidateApis = Array.from(candidates.values())
        .map(toAttributionCandidate)
        .sort((left, right) => right.score - left.score || left.api.localeCompare(right.api));

      const bestCandidate = candidateApis[0] ?? null;
      const secondCandidate = candidateApis[1] ?? null;
      const scoreGap = bestCandidate ? bestCandidate.score - (secondCandidate?.score ?? 0) : 0;

      let confidence: AttributionResult['confidence'] = 'low';
      if (
        bestCandidate &&
        bestCandidate.score >= HIGH_CONFIDENCE_SCORE &&
        scoreGap >= HIGH_CONFIDENCE_MARGIN
      ) {
        confidence = 'high';
      } else if (bestCandidate && bestCandidate.score >= MEDIUM_CONFIDENCE_SCORE) {
        confidence = 'medium';
      }

      return {
        bestApi: confidence === 'low' ? null : (bestCandidate?.api ?? null),
        candidateApis,
        confidence,
        needsMoreEvidence: confidence !== 'high',
        recommendedAction:
          confidence === 'high'
            ? 'inspect-best-api'
            : confidence === 'medium'
              ? 'validate-top-candidates'
              : 'collect-more-evidence',
      };
    },
  };
}
