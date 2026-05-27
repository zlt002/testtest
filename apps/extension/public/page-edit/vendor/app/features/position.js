import $ from '../vendor-deps/blingblingjs.js'
import hotkeys from '../vendor-deps/hotkeys-js.js'
import { metaKey, getStyle, getSide, showHideSelected } from '../utilities/index.js'

const key_events = 'up,down,left,right'
  .split(',')
  .reduce((events, event) =>
    `${events},${event},alt+${event},shift+${event},shift+alt+${event}`
  , '')
  .substring(1)

const command_events = `${metaKey}+up,${metaKey}+shift+up,${metaKey}+down,${metaKey}+shift+down`

const pageEditDebugEnabled = () => {
  try {
    return (
      globalThis.__WEBMCP_PAGE_EDIT_DEBUG__ === true ||
      window.localStorage?.getItem('webmcp:page-edit-debug') === '1'
    )
  } catch (_) {
    return globalThis.__WEBMCP_PAGE_EDIT_DEBUG__ === true
  }
}

const formatDebugNode = node => {
  if (!(node instanceof Element)) return String(node)

  const id = node.id ? `#${node.id}` : ''
  const classes =
    typeof node.className === 'string' && node.className.trim()
      ? `.${node.className.trim().split(/\s+/).join('.')}`
      : ''

  return `${node.nodeName.toLowerCase()}${id}${classes}`
}

const debugLog = (label, payload = {}) => {
  if (!pageEditDebugEnabled()) return
  console.log(`[page-edit][position] ${label}`, payload)
}

export function Position() {
  const state = {
    elements: [],
    history: null,
  }

  hotkeys(key_events, (e, handler) => {
    if (e.cancelBubble) return

    e.preventDefault()
    positionElement(state.elements, handler.key)
  })

  const onNodesSelected = (els, {history} = {}) => {
    debugLog('selection:update', {
      count: els.length,
      elements: els.map(el => formatDebugNode(el)),
    })
    state.history = history || state.history

    state.elements.forEach(el =>
      el.teardown())

    state.elements = els.map(el => {
      const draggableTarget = draggable({el, history: state.history})
      const teardownResize = resizable({el, history: state.history})
      const teardownDrag = draggableTarget.teardown

      draggableTarget.teardown = () => {
        teardownResize?.()
        teardownDrag?.()
      }

      return draggableTarget
    })

    debugLog('selection:bound', {
      count: state.elements.length,
      elements: state.elements.map(el => formatDebugNode(el)),
    })
  }

  const disconnect = () => {
    state.elements.forEach(el => el.teardown())
    hotkeys.unbind(key_events)
    hotkeys.unbind('up,down,left,right')
  }

  return {
    onNodesSelected,
    disconnect,
  }
}

export function draggable({el, surface = el, cursor = 'move', history = null}) {
   const state = {
    target: el,
    surface,
    history,
    mouse: {
      down: false,
      x: 0,
      y: 0,
    },
    element: {
      x: 0,
      y: 0,
    },
    dragStartPosition: null,
  }

  const setup = () => {
    debugLog('drag:setup', {
      target: formatDebugNode(el),
      surface: formatDebugNode(surface),
    })
    el.style.transition   = 'none'
    surface.style.cursor  = cursor

    surface.addEventListener('mousedown', onMouseDown, true)
    surface.addEventListener('mouseup', onMouseUp, true)
    document.addEventListener('mousemove', onMouseMove, true)
  }

  const teardown = () => {
    debugLog('drag:teardown', {
      target: formatDebugNode(el),
      surface: formatDebugNode(surface),
    })
    el.style.transition   = null
    surface.style.cursor  = null

    surface.removeEventListener('mousedown', onMouseDown, true)
    surface.removeEventListener('mouseup', onMouseUp, true)
    document.removeEventListener('mousemove', onMouseMove, true)
  }

  const onMouseDown = e => {
    debugLog('drag:mousedown', {
      target: formatDebugNode(e.target),
      surface: formatDebugNode(state.surface),
      currentTarget: formatDebugNode(e.currentTarget),
      matchesSurface: e.target === state.surface,
      clientX: e.clientX,
      clientY: e.clientY,
    })

    if(e.target !== state.surface) {
      debugLog('drag:mousedown:ignored-target-mismatch', {
        target: formatDebugNode(e.target),
        surface: formatDebugNode(state.surface),
      })
      return
    }
    e.preventDefault()

    if(getComputedStyle(el).position == 'static')
      el.style.position = 'relative'
    el.style.willChange = 'top,left'
    state.dragStartPosition = getElementPosition(el)

    if (el instanceof SVGElement) {
      const translate = el.getAttribute('transform')

      const [ x, y ] = translate
        ? extractSVGTranslate(translate)
        : [0,0]

      state.element.x  = x
      state.element.y  = y
    }
    else {
      state.element.x  = parseInt(getStyle(el, 'left'))
      state.element.y  = parseInt(getStyle(el, 'top'))
    }

    state.mouse.x      = e.clientX
    state.mouse.y      = e.clientY
    state.mouse.down   = true

    debugLog('drag:start', {
      target: formatDebugNode(el),
      startPosition: state.dragStartPosition,
      mouse: { x: state.mouse.x, y: state.mouse.y },
    })
  }

  const onMouseUp = e => {
    debugLog('drag:mouseup', {
      target: formatDebugNode(e.target),
      surface: formatDebugNode(state.surface),
      matchesSurface: e.target === state.surface,
      clientX: e.clientX,
      clientY: e.clientY,
      mouseDown: state.mouse.down,
    })

    if(e.target !== state.surface) {
      debugLog('drag:mouseup:ignored-target-mismatch', {
        target: formatDebugNode(e.target),
        surface: formatDebugNode(state.surface),
      })
      return
    }

    e.preventDefault()
    e.stopPropagation()

    state.mouse.down = false
    el.style.willChange = null

    if (el instanceof SVGElement) {
      const translate = el.getAttribute('transform')

      const [ x, y ] = translate
        ? extractSVGTranslate(translate)
        : [0,0]

      state.element.x    = x
      state.element.y    = y
    }
    else {
      state.element.x    = parseInt(el.style.left) || 0
      state.element.y    = parseInt(el.style.top) || 0
    }

    const dragEndPosition = getElementPosition(el)

    debugLog('drag:end', {
      target: formatDebugNode(el),
      startPosition: state.dragStartPosition,
      endPosition: dragEndPosition,
    })

    if (
      state.history
      && state.dragStartPosition
      && !isSamePosition(state.dragStartPosition, dragEndPosition)
    ) {
      state.history.record(createPositionCommand({
        el,
        start: state.dragStartPosition,
        end: dragEndPosition,
      }))
    }

    state.dragStartPosition = null
  }

  const onMouseMove = e => {
    if (!state.mouse.down) return

    e.preventDefault()
    e.stopPropagation()


    if (el instanceof SVGElement) {
      el.setAttribute('transform', `translate(
        ${state.element.x + e.clientX - state.mouse.x},
        ${state.element.y + e.clientY - state.mouse.y}
      )`)
    }
    else {
      el.style.left = state.element.x + e.clientX - state.mouse.x + 'px'
      el.style.top  = state.element.y + e.clientY - state.mouse.y + 'px'
    }

    debugLog('drag:move', {
      target: formatDebugNode(el),
      clientX: e.clientX,
      clientY: e.clientY,
      left: el.style.left || null,
      top: el.style.top || null,
    })
  }

  setup()
  el.teardown = teardown

  return el
}

function resizable({el, history = null}) {
  if (!(el instanceof HTMLElement) || el instanceof SVGElement) {
    return () => {}
  }

  const labelId = el.getAttribute('data-label-id')
  if (!labelId) return () => {}

  const handlesHost = document.querySelector(`visbug-handles[data-label-id="${labelId}"]`)
  const shadowRoot = handlesHost?.$shadow
  if (!shadowRoot) return () => {}

  const getResizeHandles = () =>
    Array.from(shadowRoot.querySelectorAll('[data-resize-handle]'))

  if (!getResizeHandles().length) return () => {}

  const state = {
    activeHandle: null,
    mouse: {
      down: false,
      x: 0,
      y: 0,
    },
    size: {
      width: 0,
      height: 0,
    },
    resizeStartSize: null,
    previousUserSelect: null,
    previousDocumentUserSelect: null,
    previousWebkitUserSelect: null,
    previousDocumentWebkitUserSelect: null,
  }

  const clearActiveSelection = () => {
    try {
      window.getSelection?.()?.removeAllRanges?.()
    } catch (_) {}
  }

  const disableNativeSelection = () => {
    state.previousUserSelect = document.body.style.userSelect
    state.previousDocumentUserSelect = document.documentElement.style.userSelect
    state.previousWebkitUserSelect = document.body.style.webkitUserSelect
    state.previousDocumentWebkitUserSelect = document.documentElement.style.webkitUserSelect

    document.body.style.userSelect = 'none'
    document.documentElement.style.userSelect = 'none'
    document.body.style.webkitUserSelect = 'none'
    document.documentElement.style.webkitUserSelect = 'none'
    clearActiveSelection()
  }

  const restoreNativeSelection = () => {
    document.body.style.userSelect = state.previousUserSelect || null
    document.documentElement.style.userSelect = state.previousDocumentUserSelect || null
    document.body.style.webkitUserSelect = state.previousWebkitUserSelect || null
    document.documentElement.style.webkitUserSelect =
      state.previousDocumentWebkitUserSelect || null
    state.previousUserSelect = null
    state.previousDocumentUserSelect = null
    state.previousWebkitUserSelect = null
    state.previousDocumentWebkitUserSelect = null
  }

  const onSelectStart = e => {
    if (!state.mouse.down || !state.activeHandle) return

    e.preventDefault()
    e.stopPropagation()
  }

  const onMouseDown = e => {
    const handleTarget = e
      .composedPath?.()
      ?.find(node =>
        node instanceof Element && node.getAttribute?.('data-resize-handle'))
    const handleType = handleTarget?.getAttribute?.('data-resize-handle')
    if (!handleType) return

    e.preventDefault()
    e.stopPropagation()

    state.activeHandle = handleType
    state.mouse.down = true
    state.mouse.x = e.clientX
    state.mouse.y = e.clientY
    state.resizeStartSize = getElementSize(el)
    state.size.width = state.resizeStartSize.width
    state.size.height = state.resizeStartSize.height
    disableNativeSelection()

    debugLog('resize:start', {
      target: formatDebugNode(el),
      handle: handleType,
      startSize: state.resizeStartSize,
      mouse: { x: state.mouse.x, y: state.mouse.y },
    })
  }

  const onMouseMove = e => {
    if (!state.mouse.down || !state.activeHandle) return

    e.preventDefault()
    e.stopPropagation()
    clearActiveSelection()

    const nextWidth = Math.max(1, state.size.width + e.clientX - state.mouse.x)
    const nextHeight = Math.max(1, state.size.height + e.clientY - state.mouse.y)

    if (state.activeHandle === 'east' || state.activeHandle === 'southeast') {
      el.style.width = `${nextWidth}px`
    }

    if (state.activeHandle === 'southeast') {
      el.style.height = `${nextHeight}px`
    }

    debugLog('resize:move', {
      target: formatDebugNode(el),
      handle: state.activeHandle,
      clientX: e.clientX,
      clientY: e.clientY,
      width: el.style.width || null,
      height: el.style.height || null,
    })
  }

  const onMouseUp = e => {
    if (!state.mouse.down || !state.activeHandle) return

    e.preventDefault()
    e.stopPropagation()

    state.mouse.down = false
    const resizeEndSize = getElementSize(el)

    debugLog('resize:end', {
      target: formatDebugNode(el),
      handle: state.activeHandle,
      startSize: state.resizeStartSize,
      endSize: resizeEndSize,
    })

    if (
      history &&
      state.resizeStartSize &&
      !isSameSize(state.resizeStartSize, resizeEndSize)
    ) {
      history.record(createSizeCommand({
        el,
        start: state.resizeStartSize,
        end: resizeEndSize,
      }))
    }

    restoreNativeSelection()
    state.activeHandle = null
    state.resizeStartSize = null
  }

  shadowRoot.addEventListener('mousedown', onMouseDown, true)
  document.addEventListener('mousemove', onMouseMove, true)
  document.addEventListener('mouseup', onMouseUp, true)
  document.addEventListener('selectstart', onSelectStart, true)

  return () => {
    shadowRoot.removeEventListener('mousedown', onMouseDown, true)
    document.removeEventListener('mousemove', onMouseMove, true)
    document.removeEventListener('mouseup', onMouseUp, true)
    document.removeEventListener('selectstart', onSelectStart, true)
    restoreNativeSelection()
  }
}

const createPositionCommand = ({el, start, end}) => ({
  undo() {
    applyElementPosition(el, start)
  },
  redo() {
    applyElementPosition(el, end)
  },
})

const createSizeCommand = ({el, start, end}) => ({
  undo() {
    applyElementSize(el, start)
  },
  redo() {
    applyElementSize(el, end)
  },
})

const getElementPosition = el => {
  if (el instanceof SVGElement) {
    const translate = el.getAttribute('transform')

    const [x, y] = translate
      ? extractSVGTranslate(translate)
      : [0, 0]

    return {x, y}
  }

  const left = getStyle(el, 'left')
  const top = getStyle(el, 'top')

  return {
    x: left === 'auto' ? 0 : parseInt(left, 10),
    y: top === 'auto' ? 0 : parseInt(top, 10),
  }
}

const applyElementPosition = (el, {x, y}) => {
  if (el instanceof SVGElement) {
    el.setAttribute('transform', `translate(${x},${y})`)
    return
  }

  if (getComputedStyle(el).position == 'static')
    el.style.position = 'relative'

  el.style.left = x + 'px'
  el.style.top = y + 'px'
}

const getElementSize = el => {
  const width = getStyle(el, 'width')
  const height = getStyle(el, 'height')

  return {
    width: width === 'auto' ? Math.round(el.getBoundingClientRect().width) : parseInt(width, 10),
    height: height === 'auto' ? Math.round(el.getBoundingClientRect().height) : parseInt(height, 10),
  }
}

const applyElementSize = (el, {width, height}) => {
  el.style.width = width + 'px'
  el.style.height = height + 'px'
}

const isSamePosition = (left, right) =>
  left.x === right.x && left.y === right.y

const isSameSize = (left, right) =>
  left.width === right.width && left.height === right.height

export function positionElement(els, direction) {
  els
    .map(el => ensurePositionable(el))
    .map(el => showHideSelected(el))
    .map(el => ({
        el,
        ...extractCurrentValueAndSide(el, direction),
        amount:   direction.split('+').includes('shift') ? 10 : 1,
        negative: determineNegativity(el, direction),
    }))
    .map(payload =>
      Object.assign(payload, {
        position: payload.negative
          ? payload.current + payload.amount
          : payload.current - payload.amount
      }))
    .forEach(({el, style, position}) =>
      el instanceof SVGElement
        ? setTranslateOnSVG(el, direction, position)
        : el.style[style] = position + 'px')
}

const extractCurrentValueAndSide = (el, direction) => {
  let style, current

  if (el instanceof SVGElement) {
    const translate = el.attr('transform')

    const [ x, y ] = translate
      ? extractSVGTranslate(translate)
      : [0,0]

    style   = 'transform'
    current = direction.includes('down') || direction.includes('up')
      ? y
      : x
  }
  else {
    const side = getSide(direction).toLowerCase()
    style = (side === 'top' || side === 'bottom') ? 'top' : 'left'
    current = getStyle(el, style)

    current === 'auto'
      ? current = 0
      : current = parseInt(current, 10)
  }

  return { style, current }
}

const extractSVGTranslate = translate =>
  translate.substring(
    translate.indexOf('(') + 1,
    translate.indexOf(')')
  ).split(',')
  .map(val => parseFloat(val))

const setTranslateOnSVG = (el, direction, position) => {
  const transform = el.attr('transform')
  const [ x, y ] = transform
    ? extractSVGTranslate(transform)
    : [0,0]

  const pos = direction.includes('down') || direction.includes('up')
    ? `${x},${position}`
    : `${position},${y}`

  el.attr('transform', `translate(${pos})`)
}

const determineNegativity = (el, direction) =>
  direction.includes('right') || direction.includes('down')

const ensurePositionable = el => {
  if (el instanceof HTMLElement)
    el.style.position = 'relative'
  return el
}
