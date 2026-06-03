import $ from '../vendor-deps/blingblingjs.js'
import { nodeKey } from './strings.js'

const MICRO_APP_SHELL_TAGS = new Set(['micro-app', 'micro-app-body', 'micro-app-head'])
const INTERACTIVE_TAGS = new Set(['button', 'input', 'select', 'textarea', 'label', 'a'])
const GENERIC_CONTAINER_TAGS = new Set(['main', 'section', 'article', 'div', 'span', 'form'])
const isElementNode = node => !!node && node.nodeType === 1 && typeof node.tagName === 'string'
const isIframeElement = node => isElementNode(node) && node.tagName?.toLowerCase?.() === 'iframe'

const getSafeElementsFromPoint = (doc, x, y) => {
  if (typeof doc?.elementsFromPoint !== 'function') return []

  try {
    return Array.from(doc.elementsFromPoint(x, y) || [])
  } catch (_) {
    return []
  }
}

const getSafeElementFromPoint = (doc, x, y) => {
  if (typeof doc?.elementFromPoint !== 'function') return null

  try {
    return doc.elementFromPoint(x, y)
  } catch (_) {
    return null
  }
}

const getIframeContentDocument = iframe => {
  if (!isIframeElement(iframe)) return null

  try {
    return iframe.contentDocument || iframe.contentWindow?.document || null
  } catch (_) {
    return null
  }
}

const isPageEditOverlayElement = node =>
  !!node &&
  node.nodeType === 1 && (
       node.closest?.('vis-bug')
    || node.closest?.('visbug-label')
    || node.closest?.('visbug-handles')
    || node.closest?.('visbug-selected')
    || node.closest?.('visbug-hover')
    || node.closest?.('visbug-corners')
    || node.closest?.('[data-webmcp-annotation-ui="true"]')
  )

const isMicroAppShellElement = node =>
  !!node &&
  node.nodeType === 1 && (
       MICRO_APP_SHELL_TAGS.has(node.tagName?.toLowerCase?.())
    || /\bmicro-app-/.test(node.className || '')
  )

const isInteractiveBusinessElement = node =>
  !!node &&
  node.nodeType === 1 && (
       INTERACTIVE_TAGS.has(node.tagName?.toLowerCase?.())
    || typeof node.getAttribute === 'function' && (
         node.getAttribute('role') === 'button'
      || node.getAttribute('role') === 'link'
      || node.getAttribute('role') === 'tab'
      || node.getAttribute('role') === 'checkbox'
      || node.getAttribute('role') === 'radio'
      || node.getAttribute('role') === 'option'
      || node.getAttribute('role') === 'menuitem'
      || node.getAttribute('contenteditable') === 'true'
    )
  )

const resolveInteractiveAncestor = node => {
  if (!isElementNode(node)) return node
  return node.closest?.(
    'button, a, label, input, select, textarea, [role="button"], [role="link"], [role="tab"], [role="menuitem"], [role="option"], [role="checkbox"], [role="radio"], [contenteditable="true"]'
  ) || node
}

const scoreHitCandidate = candidate => {
  if (!isElementNode(candidate)) return Number.NEGATIVE_INFINITY

  const rect = candidate.getBoundingClientRect?.()
  const area = rect?.width && rect?.height ? rect.width * rect.height : 0
  const textLength = (candidate.textContent || '').trim().length
  const tagName = candidate.tagName.toLowerCase()
  let score = 0

  if (isInteractiveBusinessElement(candidate)) score += 100
  if (textLength > 0 && textLength <= 40) score += 12
  if (candidate.id) score += 4
  if (candidate.classList?.length) score += 2
  if (GENERIC_CONTAINER_TAGS.has(tagName)) score -= 18
  if (tagName === 'main') score -= 36
  if (area > 0) score -= Math.min(24, Math.log10(area + 1) * 4)

  let depth = 0
  let current = candidate.parentElement
  while (current) {
    depth += 1
    current = current.parentElement
  }
  score += Math.min(18, depth)

  return score
}

const isOversizedContainerHit = candidate =>
  isElementNode(candidate) &&
  !isInteractiveBusinessElement(candidate) &&
  (
       candidate.tagName?.toLowerCase?.() === 'main'
    || GENERIC_CONTAINER_TAGS.has(candidate.tagName?.toLowerCase?.())
  )

const pickBestHitCandidate = candidates =>
  candidates.reduce((best, candidate) => {
    if (!isElementNode(candidate)) return best
    if (!best) return candidate

    const bestScore = scoreHitCandidate(best)
    const candidateScore = scoreHitCandidate(candidate)

    if (candidateScore > bestScore) return candidate
    if (candidateScore < bestScore) return best
    if (best.contains(candidate)) return candidate
    return best
  }, null)

const containsPoint = (candidate, x, y) => {
  const rect = candidate?.getBoundingClientRect?.()
  if (!rect) return false
  if (rect.width <= 0 || rect.height <= 0) return false

  return (
    x >= rect.left &&
    x <= rect.right &&
    y >= rect.top &&
    y <= rect.bottom
  )
}

const resolveContainedDescendantHit = (node, x, y) => {
  if (!isElementNode(node) || !node.children?.length) return node

  const childCandidates = Array.from(node.children).filter(child =>
       isElementNode(child)
    && !isPageEditOverlayElement(child)
    && !isMicroAppShellElement(child)
    && containsPoint(child, x, y)
  )

  const preferredChild = pickBestHitCandidate(childCandidates)
  if (!preferredChild) return node

  const nested = resolveContainedDescendantHit(preferredChild, x, y)
  if (
    isElementNode(nested) &&
    nested !== preferredChild &&
    scoreHitCandidate(nested) >= scoreHitCandidate(preferredChild)
  ) {
    return resolveInteractiveAncestor(nested)
  }

  return resolveInteractiveAncestor(preferredChild)
}

const resolveMicroAppBusinessElement = (node, x, y, doc = document) => {
  if (!isMicroAppShellElement(node)) return null

  const root =
    node.matches?.('micro-app-body')
      ? node
      : node.querySelector?.('micro-app-body') || node

  const stack = getSafeElementsFromPoint(doc, x, y)

  const stackMatch = pickBestHitCandidate(stack
    .filter(candidate =>
         isElementNode(candidate)
      && !isPageEditOverlayElement(candidate)
      && !isMicroAppShellElement(candidate)
      && root.contains(candidate)
      && containsPoint(candidate, x, y)
    )
  )

  if (stackMatch) {
    const resolved = isOversizedContainerHit(stackMatch)
      ? resolveContainedDescendantHit(stackMatch, x, y)
      : stackMatch
    return resolveInteractiveAncestor(resolved)
  }

  const descendToDeepestHit = current => {
    if (!current?.children?.length) return current

    for (const child of Array.from(current.children)) {
      if (MICRO_APP_SHELL_TAGS.has(child.tagName.toLowerCase())) {
        if (containsPoint(child, x, y)) {
          return descendToDeepestHit(child)
        }
        continue
      }

      if (!containsPoint(child, x, y)) {
        continue
      }

      return descendToDeepestHit(child)
    }

    return current
  }

  const deepest = descendToDeepestHit(root)
  return deepest === root ? null : resolveInteractiveAncestor(deepest)
}

const deepElementFromPointWithinDocument = (doc, x, y) => {
  const el = getSafeElementFromPoint(doc, x, y)
  const stack = getSafeElementsFromPoint(doc, x, y)

  const crawlShadows = node => {
    if (!node) return null

    if (node.shadowRoot && typeof node.shadowRoot.elementFromPoint === 'function') {
      const potential = node.shadowRoot.elementFromPoint(x, y)

      if (!potential)              return node
      if (potential == node)          return node
      else if (potential.shadowRoot)  return crawlShadows(potential)
      else                            return potential
    }
    else return node
  }

  const nested_shadow = crawlShadows(el)
  const hit = nested_shadow || el
  const iframeCandidates = [
    ...(isIframeElement(hit) ? [hit] : []),
    ...stack.filter(candidate => isIframeElement(candidate) && candidate !== hit),
  ]

  for (const iframe of iframeCandidates) {
    const nestedDocument = getIframeContentDocument(iframe)
    const rect = iframe.getBoundingClientRect?.()
    if (!nestedDocument || !rect) continue

    const nestedHit = deepElementFromPointWithinDocument(
      nestedDocument,
      x - rect.left,
      y - rect.top
    )

    if (nestedHit) return nestedHit
  }

  const genericStackMatch = pickBestHitCandidate(
    stack.filter(candidate =>
         isElementNode(candidate)
      && !isPageEditOverlayElement(candidate)
      && !isMicroAppShellElement(candidate)
    )
  )
  const normalizedHit =
    genericStackMatch &&
    isElementNode(hit) &&
    isOversizedContainerHit(hit) &&
    hit.contains(genericStackMatch)
      ? genericStackMatch
      : hit
  const descendedHit =
    isOversizedContainerHit(normalizedHit)
      ? resolveContainedDescendantHit(normalizedHit, x, y)
      : normalizedHit
  const microAppScope =
    descendedHit?.closest?.('micro-app-body, micro-app, [class*="micro-app-"]') || descendedHit
  const nestedMicroAppElement = resolveMicroAppBusinessElement(microAppScope, x, y, doc)

  return resolveInteractiveAncestor(nestedMicroAppElement || descendedHit)
}

export const deepElementFromPoint = (x, y) => deepElementFromPointWithinDocument(document, x, y)

export const getSide = direction => {
  let start = direction.split('+').pop().replace(/^\w/, c => c.toUpperCase())
  if (start == 'Up') start = 'Top'
  if (start == 'Down') start = 'Bottom'
  return start
}

export const getNodeIndex = el => {
  return [...el.parentElement.parentElement.children]
    .indexOf(el.parentElement)
}

export function showEdge(el) {
  return el.animate([
    { outline: '1px solid transparent' },
    { outline: '1px solid hsla(330, 100%, 71%, 80%)' },
    { outline: '1px solid transparent' },
  ], 600)
}

let timeoutMap = {}
export const showHideSelected = (el, duration = 750) => {
  el.setAttribute('data-selected-hide', true)
  showHideNodeLabel(el, true)

  if (timeoutMap[nodeKey(el)])
    clearTimeout(timeoutMap[nodeKey(el)])

  timeoutMap[nodeKey(el)] = setTimeout(_ => {
    el.removeAttribute('data-selected-hide')
    showHideNodeLabel(el, false)
  }, duration)

  return el
}

export const showHideNodeLabel = (el, show = false) => {
  if (!el.hasAttribute('data-label-id'))
    return

  const label_id = el.getAttribute('data-label-id')

  const nodes = $(`
    visbug-label[data-label-id="${label_id}"],
    visbug-handles[data-label-id="${label_id}"],
    visbug-selected[data-label-id="${label_id}"]
  `)

  nodes.length && show
    ? nodes.forEach(el =>
      el.style.display = 'none')
    : nodes.forEach(el =>
      el.style.display = null)
}

export const htmlStringToNodes = (htmlString = "", contextElement = null) => {
  const normalizedHtml = String(htmlString ?? '').trim()

  if (!normalizedHtml) return []

  if (contextElement?.nodeType && typeof document?.createRange === 'function') {
    const range = document.createRange()

    try {
      range.selectNode(contextElement)
      const fragment = range.createContextualFragment(normalizedHtml)
      return Array.from(fragment.childNodes)
    }
    catch (_) {}
  }

  const parsedDocument = new DOMParser().parseFromString(normalizedHtml, 'text/html')
  return Array.from(parsedDocument.body.childNodes)
}

export const htmlStringToDom = (htmlString = "", contextElement = null) => {
  const nodes = htmlStringToNodes(htmlString, contextElement)
  return nodes[0] || null
}

export const isOffBounds = node =>
  node.closest && (
       node.closest('vis-bug')
    || node.closest('[data-webmcp-annotation-ui="true"]')
    || node.closest('visbug-metatip')
    || node.closest('visbug-ally')
    || node.closest('visbug-label')
    || node.closest('visbug-handles')
    || node.closest('visbug-selected')
    || node.closest('visbug-corners')
    || node.closest('visbug-grip')
    || node.closest('visbug-gridlines')
  )

export const isSelectorValid = (qs => (
  selector => {
    try { qs(selector) } catch (e) { return false }
    return true
  }
))(s => document.createDocumentFragment().querySelector(s))

export const swapElements = (src, target) => {
  var temp = document.createElement("div")

  src.parentNode.insertBefore(temp, src)
  target.parentNode.insertBefore(src, target)
  temp.parentNode.insertBefore(target, temp)

  temp.parentNode.removeChild(temp)
}
