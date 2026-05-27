import { z } from 'zod';

export const DomAnalysisDocumentKindSchema = z.enum([
  'analysis-report',
  'prd-draft',
  'technical-design',
  'task-breakdown',
]);

export const TargetElementSchema = z.object({
  selector: z.string().nullable(),
  xpath: z.string().nullable(),
  tagName: z.string(),
  text: z.string().nullable(),
  outerHTMLSnippet: z.string().nullable(),
  classList: z.array(z.string()),
  dataAttributes: z.record(z.string()),
});

export const PageContextSchema = z.object({
  url: z.string().url(),
  pathname: z.string().optional(),
  hashRoute: z.string().optional(),
  title: z.string().optional(),
  pageTextSummary: z.array(z.string()),
  apiCandidates: z.array(z.string()),
  resourceHints: z.array(z.string()),
});

export const NetworkEvidenceItemSchema = z.object({
  requestId: z.string(),
  url: z.string(),
  method: z.string(),
  status: z.number().nullable(),
  resourceType: z.string().nullable(),
  startedAt: z.number(),
  finishedAt: z.number().nullable(),
  initiatorHint: z.string().nullable(),
  responsePreview: z.string().nullable(),
});

export const InteractionEvidenceItemSchema = z.object({
  action: z.string(),
  startedAt: z.number(),
  finishedAt: z.number().nullable(),
  domChangeSummary: z.array(z.string()),
});

export const RuntimeEvidenceSchema = z.object({
  scriptUrls: z.array(z.string()),
  chunkHints: z.array(z.string()),
  sourceMapHints: z.array(z.string()),
});

export const CaptureSessionModeSchema = z.enum(['auto', 'interactive']);

export const CaptureSessionMetaSchema = z.object({
  sessionId: z.string(),
  tabId: z.number(),
  capturedAt: z.number(),
  mode: CaptureSessionModeSchema,
});

export const PageEvidenceSchema = z.object({
  targetElement: TargetElementSchema,
  pageContext: PageContextSchema,
  networkEvidence: z.array(NetworkEvidenceItemSchema),
  interactionEvidence: z.array(InteractionEvidenceItemSchema),
  runtimeEvidence: RuntimeEvidenceSchema,
  captureSessionMeta: CaptureSessionMetaSchema,
});

export type DomAnalysisDocumentKind = z.infer<typeof DomAnalysisDocumentKindSchema>;
export type TargetElement = z.infer<typeof TargetElementSchema>;
export type PageContext = z.infer<typeof PageContextSchema>;
export type NetworkEvidenceItem = z.infer<typeof NetworkEvidenceItemSchema>;
export type InteractionEvidenceItem = z.infer<typeof InteractionEvidenceItemSchema>;
export type RuntimeEvidence = z.infer<typeof RuntimeEvidenceSchema>;
export type CaptureSessionMode = z.infer<typeof CaptureSessionModeSchema>;
export type CaptureSessionMeta = z.infer<typeof CaptureSessionMetaSchema>;
export type PageEvidence = z.infer<typeof PageEvidenceSchema>;
