import { Handles } from './handles.element.js'
import { HandleStyles, CornersStyles, handle_css, corners_css, supportsAdoptedStyleSheets } from '../styles.store.js'

export class Corners extends Handles {

  constructor() {
    super()
    this.styles = supportsAdoptedStyleSheets ? [HandleStyles, CornersStyles] : [handle_css, corners_css];
  }

  render({ width, height, top, left }) {
    this.style.setProperty('--top', `${top + window.scrollY}px`)
    this.style.setProperty('--left', `${left}px`)

    return `
      ${this.renderStyles()}
      <svg width="${width}" height="${height}">
        <rect></rect>
        <rect></rect>
        <rect></rect>
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

  if (!registry.get('visbug-corners')) {
    try {
      registry.define('visbug-corners', Corners);
    } catch (error) {
      if (!(error instanceof DOMException) || error.name !== 'NotSupportedError' || !registry.get('visbug-corners')) {
        throw error;
      }
    }
  }
})()
