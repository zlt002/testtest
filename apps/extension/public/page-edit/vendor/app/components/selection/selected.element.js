import { Handles } from './handles.element.js';
import {
  HandleStyles,
  handle_css,
  supportsAdoptedStyleSheets,
  constructStylesheet,
} from '../styles.store.js';
import selected_css from './selected.element.css.js';

const SelectedStyles = constructStylesheet(selected_css);

export class Selected extends Handles {
  constructor() {
    super();
    this.styles = supportsAdoptedStyleSheets
      ? [HandleStyles, SelectedStyles]
      : [handle_css, selected_css];
  }

  render({ width, height, top, left }) {
    this.style.setProperty('--top', `${top}px`);
    this.style.setProperty('--left', `${left}px`);

    return `
      ${this.renderStyles()}
      <svg width="${width}" height="${height}">
        <rect></rect>
      </svg>
    `;
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

  if (!registry.get('visbug-selected')) {
    try {
      registry.define('visbug-selected', Selected);
    } catch (error) {
      if (
        !(error instanceof DOMException) ||
        error.name !== 'NotSupportedError' ||
        !registry.get('visbug-selected')
      ) {
        throw error;
      }
    }
  }
})();
