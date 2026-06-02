import $ from '../vendor-deps/blingblingjs.js'
import { nodeKey } from './strings.js'

export const deepElementFromPoint = (x, y) => {
  const el = document.elementFromPoint(x, y)

  const crawlShadows = node => {
    if (!node) return null

    if (node.shadowRoot) {
      const potential = node.shadowRoot.elementFromPoint(x, y)

      if (!potential)              return node
      if (potential == node)          return node
      else if (potential.shadowRoot)  return crawlShadows(potential)
      else                            return potential
    }
    else return node
  }

  const nested_shadow = crawlShadows(el)

  return nested_shadow || el
}

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
