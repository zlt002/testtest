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

export type PendingAnnotationSelection = {
  selectedText: string;
  range: Range;
  anchor: TextRangeAnchor | null;
  x: number;
  y: number;
};

export type AnnotationDraftSeed = {
  selectedText: string;
  range: Range;
  anchor: TextRangeAnchor | null;
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
}): PendingAnnotationSelection {
  const position = computeAnnotationComposerPosition({
    rect: input.rect,
    viewport: input.viewport,
  });
  return {
    selectedText: input.selectedText,
    range: input.range,
    anchor: input.anchor ?? null,
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
    note: '',
    x: selection.x,
    y: selection.y,
  };
}
