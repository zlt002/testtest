import type { CaptureArtifactDraft } from '../types';

export type PageCaptureArtifactInput = {
  mode: CaptureArtifactDraft['mode'];
  url: string;
  title: string;
  capturedAt: string;
  html: string;
  styleContent: string;
  warnings: CaptureArtifactDraft['warnings'];
  userAgent: string;
  documentTitle: string;
  elementSelectionSummary?: string;
};

export function createPageCaptureArtifact(input: PageCaptureArtifactInput): CaptureArtifactDraft {
  return {
    url: input.url,
    title: input.title,
    capturedAt: input.capturedAt,
    mode: input.mode,
    html: input.html,
    styles: [{ path: 'style.css', content: input.styleContent }],
    assets: [],
    warnings: input.warnings,
    metadata: {
      originalUrl: input.url,
      userAgent: input.userAgent,
      documentTitle: input.documentTitle,
      elementSelectionSummary: input.elementSelectionSummary,
      capturePresetVersion: 'webscrapbook-folder-v1',
    },
  };
}
