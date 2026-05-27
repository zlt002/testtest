const ANNOTATION_COMPOSER_WIDTH = 360;
const ANNOTATION_COMPOSER_HEIGHT = 324;
const ANNOTATION_HORIZONTAL_MIN = 280;
const ANNOTATION_VIEWPORT_PADDING = 16;
const ANNOTATION_SELECTION_OFFSET = 12;

type ComposerRect = {
  left: number;
  width: number;
  bottom: number;
};

type ComposerViewport = {
  width: number;
  height: number;
};

function clamp(value: number, min: number, max: number) {
  if (min > max) {
    return min;
  }
  return Math.min(Math.max(value, min), max);
}

export function computeAnnotationComposerPosition(input: {
  rect: ComposerRect;
  viewport: ComposerViewport;
}) {
  const desiredX = input.rect.left + input.rect.width / 2;
  const maxX = Math.max(
    ANNOTATION_HORIZONTAL_MIN,
    input.viewport.width - ANNOTATION_COMPOSER_WIDTH
  );
  const desiredY = input.rect.bottom + ANNOTATION_SELECTION_OFFSET;
  const maxY = Math.max(
    ANNOTATION_VIEWPORT_PADDING,
    input.viewport.height - ANNOTATION_COMPOSER_HEIGHT - ANNOTATION_VIEWPORT_PADDING
  );

  return {
    x: clamp(desiredX, ANNOTATION_HORIZONTAL_MIN, maxX),
    y: clamp(desiredY, ANNOTATION_VIEWPORT_PADDING, maxY),
  };
}
