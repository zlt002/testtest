import type {
  AnnotationPageType,
  ElementAnnotation,
  SelectionTarget,
} from '@/entrypoints/background/src/services/page-annotations';

const PAGE_EDIT_CONFIG_ATTRIBUTE = 'data-webmcp-page-edit-config';

type PageWorkbenchStateRestorePayload = {
  nonce: string;
  pageUrl: string;
  sourcePageUrl: string | null;
  sourcePageType: AnnotationPageType | null;
  targets: SelectionTarget[];
  annotations: ElementAnnotation[];
};

type PageWorkbenchStateRestoreMessage = {
  type: 'page_workbench_state_restore';
  payload: PageWorkbenchStateRestorePayload;
};

type PageEditConfig = {
  pageMode?: unknown;
  selectionSessionNonce?: unknown;
};

type BridgeDeps = {
  readManifestText?: (url: string) => Promise<string | null>;
  window?: Window & typeof globalThis;
  document?: Document;
};

function isAnnotationPageType(value: unknown): value is AnnotationPageType {
  return value === 'live-page' || value === 'local-snapshot';
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function isNullableString(value: unknown): value is string | null {
  return value === null || typeof value === 'string';
}

function normalizeSelectionTarget(value: unknown): SelectionTarget | null {
  if (!value || typeof value !== 'object') {
    return null;
  }

  const candidate = value as Partial<SelectionTarget>;
  if (
    typeof candidate.targetId !== 'string' ||
    typeof candidate.pageUrl !== 'string' ||
    !isAnnotationPageType(candidate.pageType) ||
    !isFiniteNumber(candidate.createdAt) ||
    typeof candidate.url !== 'string' ||
    !isNullableString(candidate.selector) ||
    !isNullableString(candidate.xpath) ||
    typeof candidate.tagName !== 'string' ||
    !isNullableString(candidate.id) ||
    !Array.isArray(candidate.classList) ||
    !candidate.classList.every((item) => typeof item === 'string') ||
    !candidate.dataAttributes ||
    typeof candidate.dataAttributes !== 'object' ||
    Array.isArray(candidate.dataAttributes) ||
    !Object.values(candidate.dataAttributes).every((item) => typeof item === 'string') ||
    !isNullableString(candidate.text) ||
    !candidate.rect ||
    !isFiniteNumber(candidate.rect.x) ||
    !isFiniteNumber(candidate.rect.y) ||
    !isFiniteNumber(candidate.rect.width) ||
    !isFiniteNumber(candidate.rect.height) ||
    !isNullableString(candidate.outerHTMLSnippet) ||
    !Array.isArray(candidate.ancestors) ||
    !candidate.ancestors.every(
      (ancestor) =>
        ancestor &&
        typeof ancestor === 'object' &&
        typeof ancestor.tagName === 'string' &&
        isNullableString(ancestor.id) &&
        Array.isArray(ancestor.classList) &&
        ancestor.classList.every((item) => typeof item === 'string')
    ) ||
    !candidate.siblings ||
    typeof candidate.siblings !== 'object' ||
    !isNullableString(candidate.siblings.previous) ||
    !isNullableString(candidate.siblings.next)
  ) {
    return null;
  }

  return {
    targetId: candidate.targetId,
    pageUrl: candidate.pageUrl,
    pageType: candidate.pageType,
    createdAt: candidate.createdAt,
    url: candidate.url,
    selector: candidate.selector,
    xpath: candidate.xpath,
    tagName: candidate.tagName,
    id: candidate.id,
    classList: [...candidate.classList],
    dataAttributes: { ...candidate.dataAttributes },
    text: candidate.text,
    rect: { ...candidate.rect },
    outerHTMLSnippet: candidate.outerHTMLSnippet,
    ancestors: candidate.ancestors.map((ancestor) => ({
      tagName: ancestor.tagName,
      id: ancestor.id,
      classList: [...ancestor.classList],
    })),
    siblings: {
      previous: candidate.siblings.previous,
      next: candidate.siblings.next,
    },
  };
}

function normalizeElementAnnotation(value: unknown): ElementAnnotation | null {
  if (!value || typeof value !== 'object') {
    return null;
  }

  const candidate = value as Partial<ElementAnnotation>;
  if (
    typeof candidate.annotationId !== 'string' ||
    typeof candidate.targetId !== 'string' ||
    typeof candidate.content !== 'string' ||
    !isFiniteNumber(candidate.createdAt) ||
    !isFiniteNumber(candidate.updatedAt) ||
    typeof candidate.sourcePageUrl !== 'string' ||
    !isAnnotationPageType(candidate.sourcePageType) ||
    (candidate.status !== 'draft' && candidate.status !== 'sent' && candidate.status !== 'captured')
  ) {
    return null;
  }

  return {
    annotationId: candidate.annotationId,
    targetId: candidate.targetId,
    content: candidate.content,
    createdAt: candidate.createdAt,
    updatedAt: candidate.updatedAt,
    sourcePageUrl: candidate.sourcePageUrl,
    sourcePageType: candidate.sourcePageType,
    status: candidate.status,
  };
}

function createEmptyState(pageUrl: string, nonce: string): PageWorkbenchStateRestorePayload {
  return {
    nonce,
    pageUrl,
    sourcePageUrl: null,
    sourcePageType: null,
    targets: [],
    annotations: [],
  };
}

async function defaultReadManifestText(url: string): Promise<string | null> {
  const response = await fetch(url);
  if (!response.ok) {
    return null;
  }

  return response.text();
}

function resolveManifestUrl(pageUrl: string): string {
  return new URL('capture.manifest.json', pageUrl).href;
}

function readLocalSnapshotConfig(rawConfig: string | null): { nonce: string } | null {
  if (!rawConfig) {
    return null;
  }

  try {
    const parsed = JSON.parse(rawConfig) as PageEditConfig;
    if (
      parsed.pageMode !== 'local-snapshot' ||
      typeof parsed.selectionSessionNonce !== 'string' ||
      !parsed.selectionSessionNonce
    ) {
      return null;
    }
    return {
      nonce: parsed.selectionSessionNonce,
    };
  } catch {
    return null;
  }
}

async function readRestoredState(
  pageUrl: string,
  nonce: string,
  readManifestText: (url: string) => Promise<string | null>
): Promise<PageWorkbenchStateRestorePayload> {
  try {
    const manifestText = await readManifestText(resolveManifestUrl(pageUrl));
    if (!manifestText) {
      return createEmptyState(pageUrl, nonce);
    }

    const manifest = JSON.parse(manifestText) as {
      sourcePageUrl?: unknown;
      sourcePageType?: unknown;
      targets?: unknown;
      annotations?: unknown;
    };
    if (
      typeof manifest.sourcePageUrl !== 'string' ||
      !(manifest.sourcePageType === null || isAnnotationPageType(manifest.sourcePageType)) ||
      !Array.isArray(manifest.targets) ||
      !Array.isArray(manifest.annotations)
    ) {
      return createEmptyState(pageUrl, nonce);
    }

    const targets = manifest.targets.map(normalizeSelectionTarget);
    const annotations = manifest.annotations.map(normalizeElementAnnotation);
    if (targets.some((item) => item === null) || annotations.some((item) => item === null)) {
      return createEmptyState(pageUrl, nonce);
    }

    return {
      nonce,
      pageUrl,
      sourcePageUrl: manifest.sourcePageUrl,
      sourcePageType: manifest.sourcePageType,
      targets: targets as SelectionTarget[],
      annotations: annotations as ElementAnnotation[],
    };
  } catch {
    return createEmptyState(pageUrl, nonce);
  }
}

export function createPageWorkbenchStateBridge(
  sendRuntimeMessage: (message: unknown) => boolean,
  deps: BridgeDeps = {}
) {
  const currentWindow = deps.window ?? window;
  const currentDocument = deps.document ?? document;
  const readManifestText = deps.readManifestText ?? defaultReadManifestText;

  return {
    async syncFromDocumentConfig() {
      const rawConfig = currentDocument.documentElement?.getAttribute(PAGE_EDIT_CONFIG_ATTRIBUTE) ?? null;
      const config = readLocalSnapshotConfig(rawConfig);
      if (!config) {
        return;
      }

      const payload = await readRestoredState(currentWindow.location.href, config.nonce, readManifestText);
      const message: PageWorkbenchStateRestoreMessage = {
        type: 'page_workbench_state_restore',
        payload,
      };
      sendRuntimeMessage(message);
    },
  };
}
