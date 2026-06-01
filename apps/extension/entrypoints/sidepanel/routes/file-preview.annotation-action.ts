import { computeAnnotationComposerPosition } from './file-preview.annotation-position';

export type TextRangeAnchor = {
  start: number;
  end: number;
  prefix: string;
  suffix: string;
  occurrenceIndex: number;
  startPath?: number[];
  startTextOffset?: number;
  endPath?: number[];
  endTextOffset?: number;
};

export type SelectionHighlightRect = {
  left: number;
  top: number;
  width: number;
  height: number;
};

export type PendingAnnotationSelection = {
  selectedText: string;
  range: Range;
  anchor: TextRangeAnchor | null;
  highlightRects: SelectionHighlightRect[];
  x: number;
  y: number;
};

export type AnnotationDraftSeed = {
  selectedText: string;
  range: Range;
  anchor: TextRangeAnchor | null;
  highlightRects: SelectionHighlightRect[];
  note: string;
  x: number;
  y: number;
};

export function buildPendingAnnotationSelection(input: {
  selectedText: string;
  range: Range;
  anchor?: TextRangeAnchor | null;
  rect: {
    left: number;
    width: number;
    bottom: number;
  };
  viewport: {
    width: number;
    height: number;
  };
  highlightRects?: SelectionHighlightRect[];
}): PendingAnnotationSelection {
  const position = computeAnnotationComposerPosition({
    rect: input.rect,
    viewport: input.viewport,
  });
  return {
    selectedText: input.selectedText,
    range: input.range,
    anchor: input.anchor ?? null,
    highlightRects: input.highlightRects ?? [],
    x: position.x,
    y: position.y,
  };
}

export function buildAnnotationDraftFromPendingSelection(
  selection: PendingAnnotationSelection
): AnnotationDraftSeed {
  return {
    selectedText: selection.selectedText,
    range: selection.range,
    anchor: selection.anchor,
    highlightRects: selection.highlightRects,
    note: '',
    x: selection.x,
    y: selection.y,
  };
}
