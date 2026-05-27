import { capturePageDocument } from './capture-core';
import type { CaptureArtifactDraft, PageCaptureMode } from './types';

export async function serializeCaptureArtifact(
  doc: Document,
  options: {
    mode: PageCaptureMode;
    baseUrl: string;
    capturedAt?: string;
    elementSelectionSummary?: string;
    targetElement?: Element | null;
    fetchStylesheet?: (sourceUrl: string) => Promise<string>;
  }
): Promise<CaptureArtifactDraft> {
  return capturePageDocument(doc, options);
}
