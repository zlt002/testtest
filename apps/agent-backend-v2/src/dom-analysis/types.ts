export type AttributionConfidence = 'high' | 'medium' | 'low';

export type RecommendedAttributionAction =
  | 'inspect-best-api'
  | 'validate-top-candidates'
  | 'collect-more-evidence';

export type AttributionEvidenceLabel =
  | 'api-candidate'
  | 'network-request'
  | 'element-text'
  | 'page-summary'
  | 'response-preview';

export type AttributionCandidate = {
  api: string;
  score: number;
  evidence: AttributionEvidenceLabel[];
};

export type AttributionResult = {
  bestApi: string | null;
  candidateApis: AttributionCandidate[];
  confidence: AttributionConfidence;
  needsMoreEvidence: boolean;
  recommendedAction: RecommendedAttributionAction;
};

export type CodeLocationBucket = {
  graphProjects: string[];
  searchTerms: string[];
};

export type CodeLocationResult = {
  routeContext: import('../codebase/repo-context-router.ts').PageGraphContextResolution;
  frontend: CodeLocationBucket;
  backend: CodeLocationBucket;
  shared: CodeLocationBucket;
  attribution: AttributionResult;
};

export type DomDocumentType =
  | 'analysis-report'
  | 'prd-draft'
  | 'technical-design'
  | 'task-breakdown';

export type DomDocumentPage = {
  title: string;
  url: string;
  hashRoute: string | null;
  targetElement: string;
};

export type DomDocumentLocation = {
  matchedRuleId: string | null;
  frontend: CodeLocationBucket;
  backend: CodeLocationBucket;
  shared: CodeLocationBucket;
};

export type DomDocumentInput = {
  documentType: DomDocumentType;
  page: DomDocumentPage;
  attribution: AttributionResult;
  location: DomDocumentLocation;
};
