import { OverlayStyles, overlay_css, supportsAdoptedStyleSheets } from '../styles.store.js'

export class Overlay extends HTMLElement {

  constructor() {
    super()
    this.$shadow = this.attachShadow({mode: 'closed'})
    this.styles = supportsAdoptedStyleSheets ? [OverlayStyles] : [overlay_css]
  }

  connectedCallback() {
    if (supportsAdoptedStyleSheets) this.$shadow.adoptedStyleSheets = this.styles
  }
  
  disconnectedCallback() {}

  set position(boundingRect) {
    this.$shadow.innerHTML = this.render(boundingRect)
  }

  set update({ top, left, width, height }) {
    const [svg] = this.$shadow.children

    this.$shadow.host.style.display = 'block'
    svg.style.display = 'block'

    this.style.setProperty('--top', `${top}px`)
    this.style.setProperty('--left', `${left - 1}px`)

    svg.setAttribute('width', width + 'px')
    svg.setAttribute('height', height + 'px')
  }

  render({height, width}) {
    return `
      ${this.renderStyles()}
      <svg class="visbug-overlay"
        width="${width}px" height="${height}px"
        viewBox="0 0 ${width} ${height}"
      >
        <rect></rect>
      </svg>
    `
  }

  renderStyles() {
    return supportsAdoptedStyleSheets ? '' : `<style>${this.styles.join('\n')}</style>`;
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

  if (!registry.get('visbug-overlay')) {
    try {
      registry.define('visbug-overlay', Overlay);
    } catch (error) {
      if (!(error instanceof DOMException) || error.name !== 'NotSupportedError' || !registry.get('visbug-overlay')) {
        throw error;
      }
    }
  }
})()
