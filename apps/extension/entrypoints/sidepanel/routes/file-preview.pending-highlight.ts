const PENDING_ANNOTATION_HIGHLIGHT_KEY = 'webmcp-file-annotation-pending';

function readCssHighlights() {
  return (
    CSS as unknown as {
      highlights?: {
        set: (name: string, highlight: unknown) => void;
        delete: (name: string) => void;
      };
    }
  ).highlights;
}

function readHighlightConstructor() {
  return (globalThis as unknown as {
    Highlight?: new (...ranges: Range[]) => unknown;
  }).Highlight;
}

export function clearPendingAnnotationHighlight() {
  readCssHighlights()?.delete(PENDING_ANNOTATION_HIGHLIGHT_KEY);
}

export function syncPendingAnnotationHighlight(range: Range | null) {
  const cssHighlights = readCssHighlights();
  const HighlightCtor = readHighlightConstructor();
  if (!cssHighlights || !HighlightCtor) {
    return;
  }

  if (!range || range.collapsed) {
    cssHighlights.delete(PENDING_ANNOTATION_HIGHLIGHT_KEY);
    return;
  }

  cssHighlights.set(PENDING_ANNOTATION_HIGHLIGHT_KEY, new HighlightCtor(range));
}
