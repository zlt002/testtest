import type { PickedElementContext } from '@/entrypoints/lib/page-picker';

export type PageCaptureMode = 'page' | 'element';

export type PageCaptureAsset = {
  id: string;
  kind: string;
  sourceUrl: string;
  mimeType: string | null;
  relativePath: string;
  contentBase64: string;
  inlineCandidate: boolean;
  warning?: string;
};

export type PageCaptureWarning = {
  code: string;
  message: string;
  sourceUrl?: string;
};

export type PageCaptureStyle = {
  path: string;
  content: string;
};

export type PageCaptureArtifact = {
  url: string;
  title: string;
  capturedAt: string;
  mode: PageCaptureMode;
  html: string;
  styles?: PageCaptureStyle[];
  assets: PageCaptureAsset[];
  warnings: PageCaptureWarning[];
  metadata: {
    originalUrl: string;
    userAgent: string;
    documentTitle: string;
    elementSelectionSummary?: string;
    capturePresetVersion?: string;
  };
};

export type PageCaptureRequest = {
  type: 'page-capture';
  mode: PageCaptureMode;
  requestId: string;
  target?: PickedElementContext;
};

export type PageCaptureResult =
  | {
      type: 'page-capture-result';
      requestId: string;
      success: true;
      artifact: PageCaptureArtifact;
    }
  | {
      type: 'page-capture-result';
      requestId: string;
      success: false;
      artifact?: undefined;
      error?: string;
    };

export function isPageCaptureResult(value: unknown): value is PageCaptureResult {
  if (typeof value !== 'object' || value === null) {
    return false;
  }

  const candidate = value as Partial<PageCaptureResult>;
  return (
    candidate.type === 'page-capture-result' &&
    typeof candidate.requestId === 'string' &&
    typeof candidate.success === 'boolean'
  );
}
