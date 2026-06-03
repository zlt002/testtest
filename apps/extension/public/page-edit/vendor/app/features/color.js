import $ from '../vendor-deps/blingblingjs.js'
import { TinyColor } from '../vendor-deps/tinycolor/public_api.js'
import { getStyle } from '../utilities/index.js'

export function ColorPicker(pallete, selectorEngine) {
  const foregroundPicker  = $('#foreground', pallete)
  const backgroundPicker  = $('#background', pallete)
  const borderPicker      = $('#border', pallete)
  const foregroundRoot    = foregroundPicker[0] ?? null
  const backgroundRoot    = backgroundPicker[0] ?? null
  const borderRoot        = borderPicker[0] ?? null
  const hasPaletteUi      = !!(foregroundRoot || backgroundRoot || borderRoot)
  const fgInput           = foregroundRoot ? $('input', foregroundRoot) : []
  const bgInput           = backgroundRoot ? $('input', backgroundRoot) : []
  const boInput           = borderRoot ? $('input', borderRoot) : []

  const shadows = {
    active:   '0 0 0 2px hotpink, rgba(0, 0, 0, 0.25) 0px 0.25em 0.5em',
    inactive: '0 0 0 2px var(--theme-bg), rgba(0, 0, 0, 0.25) 0px 0.25em 0.5em',
  }

  const state = {
    active_color: undefined,
    elements:     [],
  }

  const setPickerValue = (input, color) => {
    input.value = color ? new TinyColor(color).toHexString() : '#000000'
  }

  if (!hasPaletteUi) {
    selectorEngine?.onSelectedUpdate?.(() => {})

    return {
      getActive: () => undefined,
      setActive() {},
      foreground: { color() {} },
      background: { color() {} },
    }
  }

  if (foregroundRoot) {
    fgInput.on('input', ({target:{value}}) => {
      selectorEngine.recordStyleMutation({
        elements: state.elements,
        label: 'color-foreground',
        notifyWatchers: false,
        mutate: () => state.elements.map(el =>
          el.style['color'] = value),
      })

      foregroundPicker[0]?.style.setProperty(`--contextual_color`, value)
    })

    fgInput.on('change', () => {
      selectorEngine.refreshSelectionUi?.()
    })
  }

  if (backgroundRoot) {
    bgInput.on('input', ({target:{value}}) => {
      selectorEngine.recordStyleMutation({
        elements: state.elements,
        label: 'color-background',
        notifyWatchers: false,
        mutate: () => state.elements.map(el =>
          el.style[el instanceof SVGElement
            ? 'fill'
            : 'backgroundColor'
          ] = value),
      })

      backgroundPicker[0]?.style.setProperty(`--contextual_color`, value)
    })

    bgInput.on('change', () => {
      selectorEngine.refreshSelectionUi?.()
    })
  }

  if (borderRoot) {
    boInput.on('input', ({target:{value}}) => {
      selectorEngine.recordStyleMutation({
        elements: state.elements,
        label: 'color-border',
        notifyWatchers: false,
        mutate: () => state.elements.map(el =>
          el.style[el instanceof SVGElement
            ? 'stroke'
            : 'borderColor'
          ] = value),
      })

      borderPicker[0]?.style.setProperty(`--contextual_color`, value)
    })

    boInput.on('change', () => {
      selectorEngine.refreshSelectionUi?.()
    })
  }

  const extractColors = elements => {
    state.elements = elements

    let isMeaningfulForeground  = false
    let isMeaningfulBackground  = false
    let isMeaningfulBorder      = false
    let FG, BG, BO

    if (state.elements.length == 1) {
      const el = state.elements[0]

      if (el instanceof SVGElement) {
        FG = new TinyColor('rgb(0, 0, 0)')
        var bo_temp = getStyle(el, 'stroke')
        BO = new TinyColor(bo_temp === 'none'
          ? 'rgb(0, 0, 0)'
          : bo_temp)
        BG = new TinyColor(getStyle(el, 'fill'))
      }
      else {
        FG = new TinyColor(getStyle(el, 'color'))
        BG = new TinyColor(getStyle(el, 'backgroundColor'))
        BO = getStyle(el, 'borderWidth') === '0px'
          ? new TinyColor('rgb(0, 0, 0)')
          : new TinyColor(getStyle(el, 'borderColor'))
      }

      let fg = FG.toHslString()
      let bg = BG.toHslString()
      let bo = BO.toHslString()

      isMeaningfulForeground = FG.originalInput !== 'rgb(0, 0, 0)' || (el.children.length === 0 && el.textContent !== '')
      isMeaningfulBackground = BG.originalInput !== 'rgba(0, 0, 0, 0)'
      isMeaningfulBorder     = BO.originalInput !== 'rgb(0, 0, 0)'

      if (isMeaningfulForeground && !isMeaningfulBackground)
        setActive('foreground')
      else if (isMeaningfulBackground && !isMeaningfulForeground || isMeaningfulBackground && isMeaningfulForeground)
        setActive('background')

      const new_fg = isMeaningfulForeground   ? fg : ''
      const new_bg = isMeaningfulBackground   ? bg : ''
      const new_bo = isMeaningfulBorder       ? bo : ''

      const fg_icon = isMeaningfulForeground  ? healthyContrastColor(FG) : ''
      const bg_icon = isMeaningfulBackground  ? healthyContrastColor(BG) : ''
      const bo_icon = isMeaningfulBorder      ? healthyContrastColor(BO) : ''

      if (fgInput[0]) setPickerValue(fgInput[0], new_fg)
      if (bgInput[0]) setPickerValue(bgInput[0], new_bg)
      if (boInput[0]) setPickerValue(boInput[0], new_bo)

      if (foregroundRoot) foregroundPicker.attr('style', `
        --contextual_color: ${new_fg};
        --icon_color: ${fg_icon};
      `)

      if (backgroundRoot) backgroundPicker.attr('style', `
        --contextual_color: ${new_bg};
        --icon_color: ${bg_icon};
      `)

      if (borderRoot) borderPicker.attr('style', `
        --contextual_color: ${new_bo};
        --icon_color: ${bo_icon};
      `)
    }
    else {
      // show all 3 if they've selected more than 1 node
      // todo: this is giving up, and can be solved
      if (foregroundRoot) foregroundPicker.attr('style', `
        box-shadow: ${state.active_color == 'foreground' ? shadows.active : shadows.inactive};
        --contextual_color: transparent;
        --icon_color: hsla(0,0%,0%,80%);
      `)

      if (backgroundRoot) backgroundPicker.attr('style', `
        box-shadow: ${state.active_color == 'background' ? shadows.active : shadows.inactive};
        --contextual_color: transparent;
        --icon_color: hsla(0,0%,0%,80%);
      `)

      if (borderRoot) borderPicker.attr('style', `
        box-shadow: ${state.active_color == 'border' ? shadows.active : shadows.inactive};
        --contextual_color: transparent;
        --icon_color: hsla(0,0%,0%,80%);
      `)
    }
  }

  const getActive = () =>
    state.active_color

  const setActive = key => {
    removeActive()
    state.active_color = key

    if (key === 'foreground')
      foregroundPicker[0]?.style && (foregroundPicker[0].style.boxShadow = shadows.active)
    if (key === 'background')
      backgroundPicker[0]?.style && (backgroundPicker[0].style.boxShadow = shadows.active)
    if (key === 'border')
      borderPicker[0]?.style && (borderPicker[0].style.boxShadow = shadows.active)
  }

  const removeActive = () =>
    [foregroundPicker, backgroundPicker, borderPicker].forEach(([picker]) =>
      picker?.style && (picker.style.boxShadow = shadows.inactive))

  if (typeof selectorEngine.onSelectedUpdate === 'function')
    selectorEngine.onSelectedUpdate(extractColors)
  else
    extractColors(selectorEngine.selection?.() ?? [])

  return {
    getActive,
    setActive,
    foreground: { color: color =>
      foregroundPicker[0].style.setProperty('--contextual_color', color)},
    background: { color: color =>
      backgroundPicker[0].style.setProperty('--contextual_color', color)}
  }
}

export const healthyContrastColor = color => {
  let contrast = color.clone()

  contrast = contrast.getLuminance() < .5
    ? contrast.lighten(30)
    : contrast.brighten(30)

  contrast = contrast.isDark()
    ? contrast.tint(50)
    : contrast.shade(50)

  return contrast.toHslString()
}
