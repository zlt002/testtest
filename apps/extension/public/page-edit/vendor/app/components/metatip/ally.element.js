import { Metatip } from './metatip.element.js'

export class Ally extends Metatip {
  constructor() {
    super()
  }
  
  render({el, ally_attributes, contrast_results}) {
    return `
      ${this.renderStyles()}
      <figure>
        <h5>${el.nodeName.toLowerCase()}${el.id && '#' + el.id}</h5>
        <div>
          ${ally_attributes.reduce((items, attr) => `
            ${items}
            <span prop>${attr.prop}:</span>
            <span value>${attr.value}</span>
          `, '')}
          ${contrast_results}
        </div>
      </figure>
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

  if (!registry.get('visbug-ally')) {
    try {
      registry.define('visbug-ally', Ally);
    } catch (error) {
      if (!(error instanceof DOMException) || error.name !== 'NotSupportedError' || !registry.get('visbug-ally')) {
        throw error;
      }
    }
  }
})()
