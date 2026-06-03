import type { IncomingMessage, ServerResponse } from 'node:http';
import { PageEvidenceSchema } from '@mcp-b/dom-analysis-contracts';
import { createRepoContextRouter } from '../codebase/repo-context-router.ts';
import type { PageGraphContextResolution } from '../codebase/repo-context-router.ts';
import type { PageCodebaseRule } from '../codebase/repo-routing-config.ts';
import { createAttributionService } from '../dom-analysis/attribution-service.ts';
import {
  buildAnalysisCard,
  resolveAnalysisCardSignals,
} from '../dom-analysis/analysis-card-builder.ts';
import { createChatSummaryBuilder } from '../dom-analysis/chat-summary-builder.ts';
import { createCodeLocationService } from '../dom-analysis/code-location-service.ts';
import { createDocumentBuilder } from '../dom-analysis/document-builder.ts';
import { resolveKbCandidate } from '../dom-analysis/kb-candidate-resolver.ts';
import { resolvePageFeature } from '../dom-analysis/page-feature-resolver.ts';
import {
  buildSuggestedCommand,
  extractApiTerms,
  extractFieldTerms,
} from '../dom-analysis/suggested-command-builder.ts';
import type {
  AttributionResult,
  DomDocumentLocation,
  DomDocumentPage,
  DomDocumentType,
} from '../dom-analysis/types.ts';
import { HttpError } from '../shared/errors.ts';
import { readJsonBody, sendJson, setCorsHeaders } from '../http/json.ts';

type ResolvePageCodeAnalysisBody = {
  url?: unknown;
  pathname?: unknown;
  hashRoute?: unknown;
  pageTextSummary?: unknown;
  apiCandidates?: unknown;
  resourceHints?: unknown;
  pageCodebaseMappingConfig?: unknown;
};

type DomAttributionBody = {
  pageEvidence?: unknown;
};

type DomLocateBody = {
  pageEvidence?: unknown;
  attribution?: unknown;
  pageCodebaseMappingConfig?: unknown;
};

type DomAnalyzeBody = {
  pageEvidence?: unknown;
  pageCodebaseMappingConfig?: unknown;
};

type DomDocumentBody = {
  documentType?: unknown;
  page?: unknown;
  attribution?: unknown;
  location?: unknown;
};

function normalizeStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter((item): item is string => typeof item === 'string');
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string');
}

function validateRuleStringArrayField(
  rule: Record<string, unknown>,
  field: keyof Pick<
    PageCodebaseRule,
    | 'hostIncludes'
    | 'pathnameIncludes'
    | 'hashRouteIncludes'
    | 'pageTextIncludes'
    | 'apiPrefixes'
    | 'resourceHintIncludes'
    | 'frontendGraphProjects'
    | 'backendGraphProjects'
    | 'sharedGraphProjects'
  >
) {
  const value = rule[field];
  if (value === undefined) {
    return;
  }
  if (!isStringArray(value)) {
    throw new HttpError(
      400,
      'Invalid page code analysis mapping config',
      'invalid_page_code_analysis_mapping_config'
    );
  }
}

function normalizePageCodebaseMappingConfig(value: unknown):
  | {
      rules: PageCodebaseRule[];
    }
  | undefined {
  if (!value || typeof value !== 'object' || !Array.isArray((value as { rules?: unknown[] }).rules)) {
    return undefined;
  }

  return {
    rules: (value as { rules: unknown[] }).rules.map((rule) => {
      if (!rule || typeof rule !== 'object') {
        throw new HttpError(
          400,
          'Invalid page code analysis mapping config',
          'invalid_page_code_analysis_mapping_config'
        );
      }

      const normalizedRule = rule as Record<string, unknown>;
      if (
        typeof normalizedRule.id !== 'string' ||
        !isStringArray(normalizedRule.frontendGraphProjects) ||
        !isStringArray(normalizedRule.backendGraphProjects)
      ) {
        throw new HttpError(
          400,
          'Invalid page code analysis mapping config',
          'invalid_page_code_analysis_mapping_config'
        );
      }

      if (
        (normalizedRule.businessId !== undefined &&
          typeof normalizedRule.businessId !== 'string') ||
        (normalizedRule.pageLabel !== undefined &&
          typeof normalizedRule.pageLabel !== 'string') ||
        (normalizedRule.triggerSkill !== undefined &&
          typeof normalizedRule.triggerSkill !== 'string') ||
        (normalizedRule.ewankbKb !== undefined &&
          typeof normalizedRule.ewankbKb !== 'string') ||
        (normalizedRule.ewankbMode !== undefined &&
          normalizedRule.ewankbMode !== 'graph' &&
          normalizedRule.ewankbMode !== 'kb' &&
          normalizedRule.ewankbMode !== 'deep') ||
        (normalizedRule.minimumScore !== undefined &&
          typeof normalizedRule.minimumScore !== 'number') ||
        (normalizedRule.enabled !== undefined && typeof normalizedRule.enabled !== 'boolean')
      ) {
        throw new HttpError(
          400,
          'Invalid page code analysis mapping config',
          'invalid_page_code_analysis_mapping_config'
        );
      }

      validateRuleStringArrayField(normalizedRule, 'hostIncludes');
      validateRuleStringArrayField(normalizedRule, 'pathnameIncludes');
      validateRuleStringArrayField(normalizedRule, 'hashRouteIncludes');
      validateRuleStringArrayField(normalizedRule, 'pageTextIncludes');
      validateRuleStringArrayField(normalizedRule, 'apiPrefixes');
      validateRuleStringArrayField(normalizedRule, 'resourceHintIncludes');
      validateRuleStringArrayField(normalizedRule, 'frontendGraphProjects');
      validateRuleStringArrayField(normalizedRule, 'backendGraphProjects');
      validateRuleStringArrayField(normalizedRule, 'sharedGraphProjects');

      return normalizedRule as PageCodebaseRule;
    }),
  };
}

function isAttributionResult(value: unknown): value is AttributionResult {
  if (!value || typeof value !== 'object') {
    return false;
  }

  const candidateApis = (value as { candidateApis?: unknown }).candidateApis;
  const confidence = (value as { confidence?: unknown }).confidence;
  const recommendedAction = (value as { recommendedAction?: unknown }).recommendedAction;

  return (
    (typeof (value as { bestApi?: unknown }).bestApi === 'string' ||
      (value as { bestApi?: unknown }).bestApi === null) &&
    Array.isArray(candidateApis) &&
    candidateApis.every(
      (candidate) =>
        Boolean(candidate) &&
        typeof candidate === 'object' &&
        typeof (candidate as { api?: unknown }).api === 'string' &&
        typeof (candidate as { score?: unknown }).score === 'number' &&
        Array.isArray((candidate as { evidence?: unknown }).evidence)
    ) &&
    (confidence === 'high' || confidence === 'medium' || confidence === 'low') &&
    typeof (value as { needsMoreEvidence?: unknown }).needsMoreEvidence === 'boolean' &&
    (recommendedAction === 'inspect-best-api' ||
      recommendedAction === 'validate-top-candidates' ||
      recommendedAction === 'collect-more-evidence')
  );
}

function isDomDocumentType(value: unknown): value is DomDocumentType {
  return (
    value === 'analysis-report' ||
    value === 'prd-draft' ||
    value === 'technical-design' ||
    value === 'task-breakdown'
  );
}

function isCodeLocationBucket(value: unknown): boolean {
  return (
    Boolean(value) &&
    typeof value === 'object' &&
    isStringArray((value as { graphProjects?: unknown }).graphProjects) &&
    isStringArray((value as { searchTerms?: unknown }).searchTerms)
  );
}

function isDomDocumentPage(value: unknown): value is DomDocumentPage {
  return (
    Boolean(value) &&
    typeof value === 'object' &&
    typeof (value as { title?: unknown }).title === 'string' &&
    typeof (value as { url?: unknown }).url === 'string' &&
    (typeof (value as { hashRoute?: unknown }).hashRoute === 'string' ||
      (value as { hashRoute?: unknown }).hashRoute === null) &&
    typeof (value as { targetElement?: unknown }).targetElement === 'string'
  );
}

function isDomDocumentLocation(value: unknown): value is DomDocumentLocation {
  if (!value || typeof value !== 'object') {
    return false;
  }

  return (
    (typeof (value as { matchedRuleId?: unknown }).matchedRuleId === 'string' ||
      (value as { matchedRuleId?: unknown }).matchedRuleId === null) &&
    isCodeLocationBucket((value as { frontend?: unknown }).frontend) &&
    isCodeLocationBucket((value as { backend?: unknown }).backend) &&
    isCodeLocationBucket((value as { shared?: unknown }).shared)
  );
}

function sendMarkdown(res: ServerResponse, status: number, markdown: string): void {
  setCorsHeaders(res);
  res.writeHead(status, { 'Content-Type': 'text/markdown; charset=utf-8' });
  res.end(markdown);
}

function dedupeTerms(items: string[]): string[] {
  return items.filter((item, index) => item.length > 0 && items.indexOf(item) === index);
}

function collectObservedApis(pageEvidence: {
  pageContext: { apiCandidates: string[] };
  networkEvidence: Array<{ url: string }>;
}): string[] {
  return dedupeTerms([
    ...pageEvidence.pageContext.apiCandidates,
    ...pageEvidence.networkEvidence
      .map((item) => {
        const matchedPath = item.url.match(/(\/api[^?]+)/);
        return matchedPath?.[1] ?? '';
      })
      .filter(Boolean),
  ]);
}

function resolveRouteContext(input: {
  router: ReturnType<typeof createRepoContextRouter>;
  pageEvidence: {
    pageContext: {
      url: string;
      pathname?: string;
      hashRoute?: string;
      pageTextSummary: string[];
      apiCandidates: string[];
      resourceHints: string[];
    };
    runtimeEvidence: {
      chunkHints: string[];
    };
  };
  pageCodebaseMappingConfig?: {
    rules: PageCodebaseRule[];
  };
}): PageGraphContextResolution {
  return input.router.resolve({
    url: input.pageEvidence.pageContext.url,
    pathname: input.pageEvidence.pageContext.pathname,
    hashRoute: input.pageEvidence.pageContext.hashRoute,
    pageTextSummary: input.pageEvidence.pageContext.pageTextSummary,
    apiCandidates: input.pageEvidence.pageContext.apiCandidates,
    resourceHints: [
      ...input.pageEvidence.pageContext.resourceHints,
      ...input.pageEvidence.runtimeEvidence.chunkHints,
    ],
    pageCodebaseMappingConfig: input.pageCodebaseMappingConfig,
  });
}

export function createPageCodeAnalysisRoute(options?: {
  projectNameByRepo?: Record<string, string>;
  attributionService?: ReturnType<typeof createAttributionService>;
}) {
  const router = createRepoContextRouter({
    projectNameByRepo: options?.projectNameByRepo,
  });
  const attributionService = options?.attributionService ?? createAttributionService();
  const codeLocationService = createCodeLocationService({
    repoContextRouter: router,
  });
  const chatSummaryBuilder = createChatSummaryBuilder();
  const documentBuilder = createDocumentBuilder();

  return async function handlePageCodeAnalysis(
    req: IncomingMessage,
    res: ServerResponse,
    pathname: string
  ) {
    if (req.method !== 'POST') {
      return false;
    }

    if (pathname === '/api/agent-v2/page-code-analysis/resolve') {
      const body = await readJsonBody<ResolvePageCodeAnalysisBody>(req);
      const pageCodebaseMappingConfig = normalizePageCodebaseMappingConfig(
        body.pageCodebaseMappingConfig
      );
      const resolution = router.resolve({
        url: typeof body.url === 'string' ? body.url : undefined,
        pathname: typeof body.pathname === 'string' ? body.pathname : undefined,
        hashRoute: typeof body.hashRoute === 'string' ? body.hashRoute : undefined,
        pageTextSummary: normalizeStringArray(body.pageTextSummary),
        apiCandidates: normalizeStringArray(body.apiCandidates),
        resourceHints: normalizeStringArray(body.resourceHints),
        pageCodebaseMappingConfig,
      });
      sendJson(res, 200, resolution);
      return true;
    }

    if (pathname === '/api/agent-v2/page-code-analysis/dom-attribution') {
      const body = await readJsonBody<DomAttributionBody>(req);
      let pageEvidence;
      try {
        pageEvidence = PageEvidenceSchema.parse(body.pageEvidence);
      } catch {
        throw new HttpError(
          400,
          'Invalid DOM attribution request body',
          'invalid_dom_attribution_request'
        );
      }
      sendJson(res, 200, attributionService.attribute(pageEvidence));
      return true;
    }

    if (pathname === '/api/agent-v2/page-code-analysis/dom-locate') {
      const body = await readJsonBody<DomLocateBody>(req);
      let pageEvidence;
      try {
        pageEvidence = PageEvidenceSchema.parse(body.pageEvidence);
      } catch {
        throw new HttpError(400, 'Invalid DOM locate request body', 'invalid_dom_locate_request');
      }

      if (!isAttributionResult(body.attribution)) {
        throw new HttpError(400, 'Invalid DOM locate request body', 'invalid_dom_locate_request');
      }

      sendJson(
        res,
        200,
        codeLocationService.locate({
          pageEvidence,
          attribution: body.attribution,
          pageCodebaseMappingConfig: normalizePageCodebaseMappingConfig(
            body.pageCodebaseMappingConfig
          ),
        })
      );
      return true;
    }

    if (pathname === '/api/agent-v2/page-code-analysis/dom-analyze') {
      const body = await readJsonBody<DomAnalyzeBody>(req);
      const pageCodebaseMappingConfig = normalizePageCodebaseMappingConfig(
        body.pageCodebaseMappingConfig
      );
      let pageEvidence;
      try {
        pageEvidence = PageEvidenceSchema.parse(body.pageEvidence);
      } catch {
        throw new HttpError(400, 'Invalid DOM analyze request body', 'invalid_dom_analyze_request');
      }

      const attribution = attributionService.attribute(pageEvidence);
      const rawEvidence = {
        pageTextSummary: pageEvidence.pageContext.pageTextSummary,
        apiCandidates: pageEvidence.pageContext.apiCandidates,
        resourceHints: [
          ...pageEvidence.pageContext.resourceHints,
          ...pageEvidence.runtimeEvidence.chunkHints,
        ],
      };
      const routeContext = resolveRouteContext({
        router,
        pageEvidence,
        pageCodebaseMappingConfig,
      });
      const pageFeature = resolvePageFeature({
        pageTitle: pageEvidence.pageContext.title,
        pageLabel: routeContext.pageLabel,
        hashRoute: pageEvidence.pageContext.hashRoute,
        pageTextSummary: pageEvidence.pageContext.pageTextSummary,
      });
      const cardSignals = resolveAnalysisCardSignals({
        elementText: pageEvidence.targetElement.text,
        pageTextSummary: pageEvidence.pageContext.pageTextSummary,
        recommendedApi: attribution.bestApi,
        attributionConfidence: attribution.confidence,
        interactionEvidenceCount: pageEvidence.interactionEvidence.length,
      });
      const actionTerms = dedupeTerms(
        [pageEvidence.targetElement.text?.trim() ?? '', cardSignals.actionType ?? ''].filter(Boolean)
      );
      const observedApis = collectObservedApis(pageEvidence);
      const kbCandidate = resolveKbCandidate({
        routeContext: {
          matched: routeContext.matched,
          triggerSkill: routeContext.triggerSkill,
          ewankbKb: routeContext.ewankbKb,
          ewankbMode: routeContext.ewankbMode,
        },
        pageUrl: pageEvidence.pageContext.url,
      });
      const apiTerms = extractApiTerms(attribution.bestApi ?? observedApis[0] ?? null);
      const fieldTerms = extractFieldTerms(cardSignals.tableHeaders);
      const analysisCard = buildAnalysisCard({
        pageName: pageFeature.primaryFeatureName,
        route: pageEvidence.pageContext.hashRoute ?? null,
        elementText: pageEvidence.targetElement.text,
        actionType: cardSignals.actionType,
        tableHeaders: cardSignals.tableHeaders,
        recommendedApi: attribution.bestApi,
        confidence: cardSignals.confidence,
      });
      const suggestedCommand = buildSuggestedCommand({
        triggerSkill: routeContext.triggerSkill,
        ewankbMode: routeContext.ewankbMode,
        kbCandidate,
        featureName: pageFeature.primaryFeatureName,
        actionTerms,
        apiTerms,
        fieldTerms,
      });

      const response = {
        page: {
          title: pageEvidence.pageContext.title,
          url: pageEvidence.pageContext.url,
          pathname: pageEvidence.pageContext.pathname,
          hashRoute: pageEvidence.pageContext.hashRoute,
        },
        targetElement: {
          tagName: pageEvidence.targetElement.tagName,
          text: pageEvidence.targetElement.text,
          selector: pageEvidence.targetElement.selector,
          xpath: pageEvidence.targetElement.xpath,
        },
        attribution,
        evidence: {
          kbCandidate,
          featureNameCandidates: pageFeature.featureNameCandidates,
          actionTerms,
          apiTerms,
          fieldTerms,
        },
        analysisCard,
        suggestedCommand,
      };

      sendJson(res, 200, {
        ...response,
        chatSummary: {
          markdown: chatSummaryBuilder.build({
            ...response,
            evidence: rawEvidence,
          }),
        },
      });
      return true;
    }

    if (pathname === '/api/agent-v2/page-code-analysis/dom-document') {
      let body: DomDocumentBody;
      try {
        body = await readJsonBody<DomDocumentBody>(req);
      } catch {
        throw new HttpError(400, 'Invalid DOM document request body', 'invalid_dom_document_request');
      }

      if (!isDomDocumentType(body.documentType)) {
        throw new HttpError(400, 'Invalid DOM document request body', 'invalid_dom_document_request');
      }

      if (
        !isDomDocumentPage(body.page) ||
        !isAttributionResult(body.attribution) ||
        !isDomDocumentLocation(body.location)
      ) {
        throw new HttpError(400, 'Invalid DOM document request body', 'invalid_dom_document_request');
      }

      sendMarkdown(
        res,
        200,
        documentBuilder.build({
          documentType: body.documentType,
          page: body.page,
          attribution: body.attribution,
          location: body.location,
        })
      );
      return true;
    }

    return false;
  };
}
