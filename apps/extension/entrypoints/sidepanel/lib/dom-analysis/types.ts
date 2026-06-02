import type { PageEvidence } from '@mcp-b/dom-analysis-contracts';
import type {
  AttributionResult,
  DomDocumentType,
} from '../agent-v2/types';

export type DomAnalyzeRequest = {
  pageEvidence: PageEvidence;
};

export type DomAnalysisCard = {
  pageName: string | null;
  route: string | null;
  targetAction: string | null;
  actionType: string | null;
  tableHeaders: string[];
  recommendedApi: string | null;
  confidence: 'low' | 'medium' | 'high';
};

export type DomAnalyzeResult = {
  page: {
    title?: string;
    url: string;
    pathname?: string;
    hashRoute?: string;
  };
  targetElement: {
    tagName: string;
    text: string | null;
    selector: string | null;
    xpath: string | null;
  };
  attribution: AttributionResult;
  evidence: {
    pageTextSummary: string[];
    apiCandidates: string[];
    resourceHints: string[];
    kbCandidate?: string | null;
    featureNameCandidates?: string[];
    actionTerms?: string[];
    apiTerms?: string[];
    fieldTerms?: string[];
  };
  analysisCard?: DomAnalysisCard | null;
  suggestedCommand?: string | null;
  chatSummary: {
    markdown: string;
  };
  documents?: Partial<Record<DomDocumentType, string>>;
};

export type DomAnalysisUiState =
  | { status: 'idle' }
  | { status: 'capturing'; sessionId: string; tabId: number; startedAt: number }
  | { status: 'analyzing'; sessionId: string }
  | { status: 'ready'; lastResult: DomAnalyzeResult };
