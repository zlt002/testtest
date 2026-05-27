export function buildMarqueeRect(start, end) {
  const left = Math.min(start.x, end.x)
  const top = Math.min(start.y, end.y)
  const right = Math.max(start.x, end.x)
  const bottom = Math.max(start.y, end.y)

  return {
    left,
    top,
    right,
    bottom,
    width: right - left,
    height: bottom - top,
  }
}

export function didMovePastThreshold(start, end, threshold = 6) {
  const deltaX = end.x - start.x
  const deltaY = end.y - start.y

  return Math.hypot(deltaX, deltaY) >= threshold
}

export function rectsIntersect(rectA, rectB) {
  return !(
    rectA.right < rectB.left ||
    rectA.left > rectB.right ||
    rectA.bottom < rectB.top ||
    rectA.top > rectB.bottom
  )
}

export function filterIntersectingElements(elements, marqueeRect) {
  return elements.filter(element =>
    typeof element?.getBoundingClientRect === 'function' &&
    rectsIntersect(element.getBoundingClientRect(), marqueeRect)
  )
}

export function shouldStartIntersectionMarquee({
  button,
  primaryModifierKey,
  shiftKey,
  selectedCount,
  isOffBoundsTarget,
}) {
  return button === 0 &&
    primaryModifierKey &&
    shiftKey &&
    selectedCount > 0 &&
    !isOffBoundsTarget
}
