import { MarqueeStyles, marquee_css, supportsAdoptedStyleSheets } from '../styles.store.js'

export class Marquee extends HTMLElement {

  constructor() {
    super()
    this.$shadow = this.attachShadow({mode: 'closed'})
    this.styles = supportsAdoptedStyleSheets ? [MarqueeStyles] : [marquee_css]
    this._position = undefined
    this._svg = null
    this._rect = null
  }

  connectedCallback() {
    if (supportsAdoptedStyleSheets) this.$shadow.adoptedStyleSheets = this.styles
    this.ensureInitialized()
  }

  disconnectedCallback() {}

  get position() {
    return this._position ? { ...this._position } : undefined
  }

  get ready() {
    return Boolean(this._svg && this._rect)
  }

  set position({ top, left, width, height }) {
    this.ensureInitialized()

    this._position = { top, left, width, height }

    this.style.setProperty('--top', `${top}px`)
    this.style.setProperty('--left', `${left}px`)
    this.style.setProperty('--width', `${width}px`)
    this.style.setProperty('--height', `${height}px`)

    this.setAttribute('width', `${width}`)
    this.setAttribute('height', `${height}`)

    this._svg.setAttribute('width', `${width}`)
    this._svg.setAttribute('height', `${height}`)
    this._svg.setAttribute('viewBox', `0 0 ${width} ${height}`)
  }

  ensureInitialized() {
    if (this._svg && this._rect) return

    this.$shadow.innerHTML = this.render()
    this._svg = this.$shadow.querySelector('svg')
    this._rect = this.$shadow.querySelector('rect')
  }

  render() {
    return `
      ${this.renderStyles()}
      <svg
        class="visbug-marquee"
        width="0"
        height="0"
        viewBox="0 0 0 0"
        version="1.1"
        xmlns="http://www.w3.org/2000/svg"
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

  if (!registry.get('visbug-marquee')) {
    try {
      registry.define('visbug-marquee', Marquee);
    } catch (error) {
      if (!(error instanceof DOMException) || error.name !== 'NotSupportedError' || !registry.get('visbug-marquee')) {
        throw error;
      }
    }
  }
})()
