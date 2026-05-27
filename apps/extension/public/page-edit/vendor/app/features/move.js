import $ from '../vendor-deps/blingblingjs.js'
import hotkeys from '../vendor-deps/hotkeys-js.js'
import { getNodeIndex, showEdge, swapElements, notList } from '../utilities/index.js'
import { toggleWatching } from './imageswap.js'

const key_events = 'up,down,left,right'
const state = {
  drag: {
    src:        null,
    parent:     null,
    parent_ui:  [],
    siblings:   new Map(),
    swapping:   new Map(),
  },
  hover: {
    dropzones: [],
    observers: [],
  },
}
// todo: indicator for when node can descend
// todo: have it work with shadowDOM
export function Moveable(visbug) {
  hotkeys(key_events, (e, {key}) => {
    if (e.cancelBubble) return

    e.preventDefault()
    e.stopPropagation()

    const selected = sortNodesInDocumentOrder(visbug.selection())
    const movedEntries = selected.map(node => ({
      node,
      before: createStructureAnchor(node),
    }))

    selected.forEach(el => {
      moveElement(el, key)
      updateFeedback(el)
    })

    const recordedEntries = movedEntries
      .map(({node, before}) => ({
        node,
        before,
        after: createStructureAnchor(node),
      }))
      .filter(({before, after}) =>
        !isSameStructureAnchor(before, after))

    if (recordedEntries.length) {
      visbug.history?.record({
        undo() {
          recordedEntries.forEach(({node, before}) =>
            restoreNodeAtAnchor({node, anchor: before}))
        },
        redo() {
          recordedEntries.forEach(({node, after}) =>
            restoreNodeAtAnchor({node, anchor: after}))
        },
      })
    }
  })

  visbug.onSelectedUpdate(dragNDrop)
  toggleWatching({watch: false})

  return () => {
    toggleWatching({watch: true})
    visbug.removeSelectedCallback(dragNDrop)
    clearListeners()
    hotkeys.unbind(key_events)
  }
}

export function moveElement(el, direction) {
  if (!el) return

  switch(direction) {
    case 'left':
    case 'up':
      if (canMoveLeft(el))
        el.parentNode.insertBefore(el, el.previousElementSibling)
      else
        showEdge(el.parentNode)
      break

    case 'right':
    case 'down':
      if (canMoveRight(el) && el.nextElementSibling.nextSibling)
        el.parentNode.insertBefore(el, el.nextElementSibling.nextSibling)
      else if (canMoveRight(el))
        el.parentNode.appendChild(el)
      else
        showEdge(el.parentNode)
      break
  }
}

export const canMoveLeft    = el => el.previousElementSibling
export const canMoveRight   = el => el.nextElementSibling
export const canMoveDown    = el => el.nextElementSibling
export const canMoveUnder   = _el => false
export const canMoveUp      = el => el.previousElementSibling

export const popOut = ({el, under = false}) =>
  el.parentNode.parentNode.insertBefore(el,
    el.parentNode.parentNode.children[
      under
        ? getNodeIndex(el) + 1
        : getNodeIndex(el)])

const createStructureAnchor = node => ({
  parent: node?.parentNode || null,
  previous: node?.previousSibling || null,
  next: node?.nextSibling || null,
})

const isSameStructureAnchor = (left, right) =>
  left.parent === right.parent
  && left.previous === right.previous
  && left.next === right.next

const restoreNodeAtAnchor = ({node, anchor}) => {
  if (!anchor.parent) return

  if (anchor.next?.parentNode === anchor.parent) {
    anchor.parent.insertBefore(node, anchor.next)
    return
  }

  if (anchor.previous?.parentNode === anchor.parent) {
    anchor.parent.insertBefore(node, anchor.previous.nextSibling)
    return
  }

  anchor.parent.appendChild(node)
}

const sortNodesInDocumentOrder = nodes =>
  nodes
    .filter(node => node?.parentNode)
    .slice()
    .sort((left, right) =>
      left === right
        ? 0
        : left.compareDocumentPosition(right) & 0x02
          ? 1
          : -1)

export function dragNDrop(selection) {
  if (!selection.length)
    return

  clearListeners()

  const [src]         = selection
  const {parentNode}  = src

  const validMoveableChildren = [...parentNode.querySelectorAll(':scope > *' + notList)]

  const tooManySelected       = selection.length !== 1
  const hasNoSiblingsToDrag   = validMoveableChildren.length <= 1
  const isAnSVG               = src instanceof SVGElement

  if (tooManySelected || hasNoSiblingsToDrag || isAnSVG) 
    return 

  validMoveableChildren.forEach(sibling =>
    state.drag.siblings.set(sibling, createGripUI(sibling)))

  state.drag.parent     = parentNode
  state.drag.parent_ui  = createParentUI(parentNode)

  moveWatch(state.drag.parent)
}

const moveWatch = node => {
  const $node = $(node)

  $node.on('mouseleave', dragDrop)
  $node.on('dragstart', dragStart)
  $node.on('drop', dragDrop)

  state.drag.siblings.forEach((grip, sibling) => {
    sibling.setAttribute('draggable', true)
    $(sibling).on('dragover', dragOver)
    $(sibling).on('mouseenter', siblingHoverIn)
    $(sibling).on('mouseleave', siblingHoverOut)
  })
}

const moveUnwatch = node => {
  const $node = $(node)

  $node.off('mouseleave', dragDrop)
  $node.off('dragstart', dragStart)
  $node.off('drop', dragDrop)

  state.drag.siblings.forEach((grip, sibling) => {
    sibling.removeAttribute('draggable')
    $(sibling).off('dragover', dragOver)
    $(sibling).off('mouseenter', siblingHoverIn)
    $(sibling).off('mouseleave', siblingHoverOut)
  })
}

const dragStart = ({target}) => {
  if (!state.drag.siblings.has(target))
    return

  state.drag.src = target
  state.hover.dropzones.push(createDropzoneUI(target))
  state.drag.siblings.get(target).style.opacity = 0.01

  target.setAttribute('visbug-drag-src', true)
  ghostNode(target)

  $('visbug-hover').forEach(el =>
    !el.hasAttribute('visbug-drag-container') && el.remove())
}

const dragOver = e => {
  if (
    !state.drag.src || 
    state.drag.swapping.get(e.target) || 
    e.target.hasAttribute('visbug-drag-src') || 
    !state.drag.siblings.has(e.currentTarget) ||
    e.currentTarget !== e.target
  ) return

  state.drag.swapping.set(e.target, true)
  swapElements(state.drag.src, e.target)

  setTimeout(() => 
    state.drag.swapping.delete(e.target)
  , 250)
}

const dragDrop = e => {
  if (!state.drag.src) return

  state.drag.src.removeAttribute('visbug-drag-src')
  ghostBuster(state.drag.src)

  if (state.drag.siblings.has(state.drag.src))
    state.drag.siblings.get(state.drag.src).style.opacity = null

  state.hover.dropzones.forEach(zone =>
    zone.remove())

  state.drag.src = null
}

const siblingHoverIn = ({target}) => {
  if (!state.drag.siblings.has(target))
    return

  state.drag.siblings.get(target)
    .toggleHovering({hovering:true})
}

const siblingHoverOut = ({target}) => {
  if (!state.drag.siblings.has(target))
    return

  state.drag.siblings.get(target)
    .toggleHovering({hovering:false})
}

const ghostNode = ({style}) => {
  style.transition  = 'opacity .25s ease-out'
  style.opacity     = 0.01
}

const ghostBuster = ({style}) => {
  style.transition  = null
  style.opacity     = null
}

const createDropzoneUI = el => {
  const zone = document.createElement('visbug-corners')

  zone.position = {el}
  document.body.appendChild(zone)

  const observer = new MutationObserver(list =>
    zone.position = {el})

  observer.observe(el.parentNode, { 
    childList: true, 
    subtree: true, 
  })

  state.hover.observers.push(observer)

  return zone
}

const createGripUI = el => {
  const grip = document.createElement('visbug-grip')

  grip.position = {el}
  document.body.appendChild(grip)

  const observer = new MutationObserver(list =>
    grip.position = {el})

  observer.observe(el.parentNode, { 
    childList: true, 
    subtree: true, 
  })

  state.hover.observers.push(observer)

  return grip
}

const createParentUI = parent => {
  const hover = document.createElement('visbug-hover')
  const label = document.createElement('visbug-label')

  hover.position = {el:parent}
  hover.setAttribute('visbug-drag-container', true)

  label.text = 'Drag Bounds'
  label.setAttribute('data-readonly-label', 'true')
  label.position = {boundingRect: parent.getBoundingClientRect()}
  label.style.setProperty('--label-bg', 'var(--theme-purple)')
  label.style.setProperty('--stack-offset-y', '28px')

  document.body.appendChild(hover)
  document.body.appendChild(label)

  const observer = new MutationObserver(list => {
    hover.position = {el:parent}
    label.position = {boundingRect: parent.getBoundingClientRect()}
  })

  observer.observe(parent, { 
    childList: true, 
    subtree: true, 
  })

  state.hover.observers.push(observer)

  return [hover,label]
}

export function clearListeners() {
  moveUnwatch(state.drag.parent)

  state.hover.observers.forEach(observer => 
    observer.disconnect())

  state.hover.dropzones.forEach(zone => 
    zone.remove())

  state.drag.siblings.forEach((grip, sibling) => 
    grip.remove())

  state.drag.parent_ui.forEach(ui => 
    ui.remove())

  state.hover.observers = []
  state.hover.dropzones = []
  state.drag.parent_ui  = []
  state.drag.siblings.clear()
}

const updateFeedback = el => {
  let options = ''
  // get current elements offset/size
  if (canMoveLeft(el))  options += '⇠'
  if (canMoveRight(el)) options += '⇢'
  if (canMoveDown(el))  options += '⇣'
  if (canMoveUp(el))    options += '⇡'
  // create/move arrows in absolute/fixed to overlay element
  options && console.info('%c'+options, "font-size: 2rem;")
}
