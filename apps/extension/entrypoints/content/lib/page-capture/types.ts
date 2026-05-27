import type { PickedElementContext } from '@/entrypoints/lib/page-picker';

export type PageCaptureMode = 'page' | 'element';

export type CaptureWarning = {
  code: string;
  message: string;
  sourceUrl?: string;
};

export type CaptureAssetKind = 'image' | 'stylesheet' | 'font' | 'svg' | 'media' | 'other';

export type CaptureAssetDraft = {
  id: string;
  kind: CaptureAssetKind;
  sourceUrl: string;
  mimeType: string | null;
  relativePath: string;
  contentBase64: string;
  inlineCandidate: boolean;
  warning?: string;
};

export type CaptureStyleDraft = {
  path: string;
  content: string;
};

export type CaptureArtifactDraft = {
  url: string;
  title: string;
  capturedAt: string;
  mode: PageCaptureMode;
  html: string;
  styles: CaptureStyleDraft[];
  assets: CaptureAssetDraft[];
  warnings: CaptureWarning[];
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
      artifact: CaptureArtifactDraft;
    }
  | {
      type: 'page-capture-result';
      requestId: string;
      success: false;
      error: string;
    };

export function isPageCaptureRequest(value: unknown): value is PageCaptureRequest {
  if (!value || typeof value !== 'object') {
    return false;
  }

  const candidate = value as Record<string, unknown>;
  const target = candidate.target;

  return (
    candidate.type === 'page-capture' &&
    (candidate.mode === 'page' || candidate.mode === 'element') &&
    typeof candidate.requestId === 'string' &&
    (target === undefined || isPickedElementContext(target))
  );
}

export function isPageCaptureResult(value: unknown): value is PageCaptureResult {
  if (!value || typeof value !== 'object') {
    return false;
  }

  const candidate = value as Record<string, unknown>;
  return (
    candidate.type === 'page-capture-result' &&
    typeof candidate.requestId === 'string' &&
    typeof candidate.success === 'boolean'
  );
}

function isPickedElementContext(value: unknown): value is PickedElementContext {
  if (!value || typeof value !== 'object') {
    return false;
  }

  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.url === 'string' &&
    isNullableString(candidate.selector) &&
    isNullableString(candidate.xpath) &&
    typeof candidate.tagName === 'string'
  );
}

function isNullableString(value: unknown): value is string | null {
  return value === null || typeof value === 'string';
}
