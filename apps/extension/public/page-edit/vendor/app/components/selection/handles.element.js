import $ from '../../vendor-deps/blingblingjs.js'
import { HandleStyles, handle_css, supportsAdoptedStyleSheets } from '../styles.store.js'

export class Handles extends HTMLElement {

  constructor() {
    super()
    this.$shadow = this.attachShadow({mode: 'closed'})
    this.styles = supportsAdoptedStyleSheets ? [HandleStyles] : [handle_css];
    this.boundViewportChange = this.onViewportChange.bind(this)
    this._positionSourceEl = null
    this._positionNodeLabelId = null
  }

  connectedCallback() {
    if (supportsAdoptedStyleSheets) this.$shadow.adoptedStyleSheets = this.styles
    window.addEventListener('resize', this.boundViewportChange)
    window.addEventListener('scroll', this.boundViewportChange, true)
  }
  
  disconnectedCallback() {
    window.removeEventListener('resize', this.boundViewportChange)
    window.removeEventListener('scroll', this.boundViewportChange, true)
  }

  onViewportChange() {
    const raf =
      typeof window.requestAnimationFrame === 'function'
        ? window.requestAnimationFrame.bind(window)
        : (callback) => window.setTimeout(callback, 0)

    raf(() => {
      const node_label_id = this._positionNodeLabelId ?? this.$shadow.host.getAttribute('data-label-id')
      const source_el =
        this._positionSourceEl ??
        (node_label_id ? $(`[data-label-id="${node_label_id}"]`)[0] : null)

      if (!source_el) return

      this.position = {
        node_label_id,
        el: source_el,
      }
    })
  }

  set position({el, node_label_id}) {
    this._positionSourceEl = el ?? null
    this._positionNodeLabelId = node_label_id ?? null
    this.$shadow.innerHTML = this.render(el.getBoundingClientRect(), node_label_id)

    if (this._backdrop) {
      this.backdrop = {
        element: this._backdrop.update(el),
        update:  this._backdrop.update,
      }
    }
  }

  set backdrop(bd) {
    this._backdrop = bd

    const cur_child = this.$shadow.querySelector('visbug-boxmodel')

    cur_child
      ? this.$shadow.replaceChild(bd.element, cur_child)
      : this.$shadow.appendChild(bd.element)
  }

  render({ x, y, width, height, top, left }, node_label_id) {
    this.$shadow.host.setAttribute('data-label-id', node_label_id)

    this.style.setProperty('--top', `${top}px`)
    this.style.setProperty('--left', `${left}px`)

    return `
      ${this.renderStyles()}
      <svg
        class="visbug-handles"
        width="${width}" height="${height}"
        viewBox="0 0 ${width} ${height}"
        version="1.1" xmlns="http://www.w3.org/2000/svg"
      >
        <rect stroke="hotpink" fill="none" width="100%" height="100%"></rect>
        <circle stroke="hotpink" fill="white" cx="0" cy="0" r="2"></circle>
        <circle stroke="hotpink" fill="white" cx="100%" cy="0" r="2"></circle>
        <circle stroke="hotpink" fill="white" cx="100%" cy="100%" r="2"></circle>
        <circle stroke="hotpink" fill="white" cx="0" cy="100%" r="2"></circle>
        <circle fill="hotpink" cx="${width/2}" cy="0" r="2"></circle>
        <circle fill="hotpink" cx="0" cy="${height/2}" r="2"></circle>
        <circle fill="hotpink" cx="${width/2}" cy="${height}" r="2"></circle>
        <circle fill="hotpink" cx="${width}" cy="${height/2}" r="2"></circle>
        <circle
          data-resize-handle="east"
          class="resize-hitarea resize-hitarea-east"
          cx="${width}"
          cy="${height/2}"
          r="8"
          fill="transparent"
        ></circle>
        <circle
          data-resize-handle="southeast"
          class="resize-hitarea resize-hitarea-southeast"
          cx="${width}"
          cy="${height}"
          r="8"
          fill="transparent"
        ></circle>
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

  if (!registry.get('visbug-handles')) {
    try {
      registry.define('visbug-handles', Handles);
    } catch (error) {
      if (!(error instanceof DOMException) || error.name !== 'NotSupportedError' || !registry.get('visbug-handles')) {
        throw error;
      }
    }
  }
})()
