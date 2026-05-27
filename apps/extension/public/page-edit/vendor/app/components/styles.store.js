import { default as visbug_css }     from './vis-bug/vis-bug.element.css.js'
import { default as handle_css }     from './selection/handles.element.css.js'
import { default as hover_css }      from './selection/hover.element.css.js'
import { default as corners_css }    from './selection/corners.element.css.js'
import { default as distance_css }   from './selection/distance.element.css.js'
import { default as gridline_css }   from './selection/gridlines.element.css.js'
import { default as label_css }      from './selection/label.element.css.js'
import { default as overlay_css }    from './selection/overlay.element.css.js'
import { default as boxmodel_css }   from './selection/box-model.element.css.js'
import { default as marquee_css }    from './selection/marquee.element.css.js'
import { default as metatip_css }    from './metatip/metatip.element.css.js'
import { default as grip_css }       from './selection/grip.element.css.js'

export const supportsAdoptedStyleSheets = 'adoptedStyleSheets' in Document.prototype && 'replace' in CSSStyleSheet.prototype

export const constructStylesheet = (styles) => {
  if (supportsAdoptedStyleSheets) {
    const stylesheet = new CSSStyleSheet()
    stylesheet.replaceSync(styles)
    return stylesheet
  }
}

export {
  visbug_css,
  handle_css,
  hover_css,
  corners_css,
  distance_css,
  gridline_css,
  label_css,
  overlay_css,
  boxmodel_css,
  marquee_css,
  metatip_css,
  grip_css,
};

export const VisBugStyles    = constructStylesheet(visbug_css)
export const HandleStyles    = constructStylesheet(handle_css)
export const HoverStyles     = constructStylesheet(hover_css)
export const CornersStyles   = constructStylesheet(corners_css)
export const MetatipStyles   = constructStylesheet(metatip_css)
export const DistanceStyles  = constructStylesheet(distance_css)
export const GridlineStyles  = constructStylesheet(gridline_css)
export const LabelStyles     = constructStylesheet(label_css)
export const OverlayStyles   = constructStylesheet(overlay_css)
export const BoxModelStyles  = constructStylesheet(boxmodel_css)
export const MarqueeStyles   = constructStylesheet(marquee_css)
export const GripStyles      = constructStylesheet(grip_css)
