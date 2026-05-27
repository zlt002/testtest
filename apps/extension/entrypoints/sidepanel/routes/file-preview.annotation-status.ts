export type FileAnnotationStatus = 'active' | 'invalid';

export type AnnotationStatusSource = {
  id: string;
  selectedText: string;
};

export function resolveAnnotationStatuses<T extends AnnotationStatusSource>(
  annotations: T[],
  matchedAnnotationIds: ReadonlySet<string>
) {
  return annotations.map((annotation) => ({
    ...annotation,
    status: matchedAnnotationIds.has(annotation.id) ? 'active' : 'invalid',
  })) as Array<T & { status: FileAnnotationStatus }>;
}

export function countActiveAnnotations<T extends { status: FileAnnotationStatus }>(
  annotations: T[]
) {
  return annotations.filter((annotation) => annotation.status === 'active').length;
}

export function formatAnnotationCountLabel(activeCount: number, totalCount: number) {
  if (totalCount <= 0) {
    return '0';
  }
  return `${activeCount}/${totalCount}`;
}
