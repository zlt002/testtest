export type AnnotationHitRect = {
  left: number;
  right: number;
  top: number;
  bottom: number;
};

export type AnnotationHitTarget = {
  annotationId: string;
  ranges: Range[];
};

export function findAnnotationIdAtPoint(
  targets: AnnotationHitTarget[],
  point: { x: number; y: number }
) {
  for (const target of targets) {
    for (const range of target.ranges) {
      const rects = Array.from(range.getClientRects()).map((rect) => ({
        left: rect.left,
        right: rect.right,
        top: rect.top,
        bottom: rect.bottom,
      }));
      for (const rect of rects) {
        if (
          point.x >= rect.left &&
          point.x <= rect.right &&
          point.y >= rect.top &&
          point.y <= rect.bottom
        ) {
          return target.annotationId;
        }
      }
    }
  }

  return null;
}
