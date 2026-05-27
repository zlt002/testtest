import type { PickedElementContext } from '@/entrypoints/lib/page-picker';

export type AnnotationPageType = 'live-page' | 'local-snapshot';

export type SelectionTarget = PickedElementContext & {
  targetId: string;
  pageUrl: string;
  pageType: AnnotationPageType;
  createdAt: number;
};

export type ElementAnnotation = {
  annotationId: string;
  targetId: string;
  content: string;
  createdAt: number;
  updatedAt: number;
  sourcePageUrl: string;
  sourcePageType: AnnotationPageType;
  status: 'draft' | 'sent' | 'captured';
};

function isNullableString(value: unknown): value is string | null {
  return value === null || typeof value === 'string';
}

function cloneSelectionTarget(target: SelectionTarget): SelectionTarget {
  return {
    ...target,
    classList: [...target.classList],
    dataAttributes: { ...target.dataAttributes },
    rect: { ...target.rect },
    ancestors: target.ancestors.map((ancestor) => ({
      ...ancestor,
      classList: [...ancestor.classList],
    })),
    siblings: { ...target.siblings },
  };
}

function cloneElementAnnotation(annotation: ElementAnnotation): ElementAnnotation {
  return { ...annotation };
}

export function normalizeSelectionTarget(input: {
  target: unknown;
  targetId: string;
  pageUrl: string;
  pageType: AnnotationPageType;
  createdAt: number;
}): SelectionTarget | null {
  if (!input.target || typeof input.target !== 'object') {
    return null;
  }

  const target = input.target as Partial<PickedElementContext>;
  if (
    typeof target.url !== 'string' ||
    isNullableString(target.selector) === false ||
    isNullableString(target.xpath) === false ||
    typeof target.tagName !== 'string' ||
    isNullableString(target.id) === false ||
    !Array.isArray(target.classList) ||
    !target.classList.every((item) => typeof item === 'string') ||
    !target.dataAttributes ||
    typeof target.dataAttributes !== 'object' ||
    Array.isArray(target.dataAttributes) ||
    !Object.values(target.dataAttributes).every((value) => typeof value === 'string') ||
    isNullableString(target.text) === false ||
    !target.rect ||
    typeof target.rect.x !== 'number' ||
    typeof target.rect.y !== 'number' ||
    typeof target.rect.width !== 'number' ||
    typeof target.rect.height !== 'number' ||
    isNullableString(target.outerHTMLSnippet) === false ||
    !Array.isArray(target.ancestors) ||
    !target.ancestors.every(
      (ancestor) =>
        ancestor &&
        typeof ancestor === 'object' &&
        typeof ancestor.tagName === 'string' &&
        isNullableString(ancestor.id) &&
        Array.isArray(ancestor.classList) &&
        ancestor.classList.every((item) => typeof item === 'string')
    ) ||
    !target.siblings ||
    typeof target.siblings !== 'object' ||
    isNullableString(target.siblings.previous) === false ||
    isNullableString(target.siblings.next) === false
  ) {
    return null;
  }

  return {
    targetId: input.targetId,
    pageUrl: input.pageUrl,
    pageType: input.pageType,
    createdAt: input.createdAt,
    url: target.url,
    selector: target.selector,
    xpath: target.xpath,
    tagName: target.tagName,
    id: target.id,
    classList: [...target.classList],
    dataAttributes: { ...target.dataAttributes },
    text: target.text,
    rect: { ...target.rect },
    outerHTMLSnippet: target.outerHTMLSnippet,
    ancestors: target.ancestors.map((ancestor) => ({
      tagName: ancestor.tagName,
      id: ancestor.id,
      classList: [...ancestor.classList],
    })),
    siblings: {
      previous: target.siblings.previous,
      next: target.siblings.next,
    },
  };
}

export function createPageAnnotationStore() {
  const targetsByTab = new Map<number, Map<string, SelectionTarget>>();
  const annotationsByTab = new Map<number, Map<string, ElementAnnotation>>();

  const ensureTargets = (tabId: number) => {
    if (!targetsByTab.has(tabId)) {
      targetsByTab.set(tabId, new Map());
    }

    return targetsByTab.get(tabId) as Map<string, SelectionTarget>;
  };

  const ensureAnnotations = (tabId: number) => {
    if (!annotationsByTab.has(tabId)) {
      annotationsByTab.set(tabId, new Map());
    }

    return annotationsByTab.get(tabId) as Map<string, ElementAnnotation>;
  };

  return {
    upsertTarget(tabId: number, target: SelectionTarget) {
      ensureTargets(tabId).set(target.targetId, cloneSelectionTarget(target));
    },

    upsertAnnotation(tabId: number, annotation: ElementAnnotation) {
      ensureAnnotations(tabId).set(annotation.annotationId, cloneElementAnnotation(annotation));
    },

    listTargets(tabId: number) {
      return Array.from((targetsByTab.get(tabId) ?? new Map()).values(), cloneSelectionTarget);
    },

    listAnnotations(tabId: number) {
      return Array.from(
        (annotationsByTab.get(tabId) ?? new Map()).values(),
        cloneElementAnnotation
      );
    },

    clearTab(tabId: number) {
      targetsByTab.delete(tabId);
      annotationsByTab.delete(tabId);
    },
  };
}
