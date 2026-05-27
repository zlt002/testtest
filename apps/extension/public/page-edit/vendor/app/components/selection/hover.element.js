import { Handles } from './handles.element.js'
import { HandleStyles, HoverStyles, handle_css, hover_css, supportsAdoptedStyleSheets } from '../styles.store.js'

export class Hover extends Handles {

  constructor() {
    super()
    this.styles = supportsAdoptedStyleSheets ? [HandleStyles, HoverStyles] : [handle_css, hover_css];
  }

  render({ width, height, top, left }) {
    this.style.setProperty('--top', `${top}px`)
    this.style.setProperty('--left', `${left}px`)

    return `
      ${this.renderStyles()}
      <svg width="${width}" height="${height}">
        <rect></rect>
      </svg>
    `
  }
}

;(() => {
  const registry =
    globalThis.customElements ??
    globalThis.window?.customElements ??
    globalThis.document?.defaultView?.customElements;

  if (!registry) {
    throw new Error('Custom Elements registry is unavailable');
  }

  if (!registry.get('visbug-hover')) {
    try {
      registry.define('visbug-hover', Hover);
    } catch (error) {
      if (!(error instanceof DOMException) || error.name !== 'NotSupportedError' || !registry.get('visbug-hover')) {
        throw error;
      }
    }
  }
})()
