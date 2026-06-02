import $ from '../../vendor-deps/blingblingjs.js';
import { LabelStyles, label_css, supportsAdoptedStyleSheets } from '../styles.store.js';
import {
  getCurrentPageMode,
  isLocalSnapshotMode,
} from '../../../../runtime/page-mode.js';

const pageEditDebugEnabled = () => {
  try {
    return (
      globalThis.__WEBMCP_PAGE_EDIT_DEBUG__ === true ||
      window.localStorage?.getItem('webmcp:page-edit-debug') === '1'
    );
  } catch (_) {
    return globalThis.__WEBMCP_PAGE_EDIT_DEBUG__ === true;
  }
};

const debugLog = (label, payload = {}) => {
  if (!pageEditDebugEnabled()) return;
  console.log(`[page-edit][label] ${label}`, payload);
};

const LABEL_VIEWPORT_GAP = 8;
const LABEL_INSIDE_OFFSET = 1;

function clampLabelIntoViewport(labelHost, view) {
  labelHost.style.setProperty('--translate-x', '0px');

  const labelShell = labelHost.$shadow.querySelector('.label-shell');
  if (!labelShell || typeof labelShell.getBoundingClientRect !== 'function') {
    return;
  }

  const shellBounds = labelShell.getBoundingClientRect();
  const top = Number.parseFloat(labelHost.style.getPropertyValue('--top')) || 0;
  const anchorTop = top;
  const anchorHeight = Number.parseFloat(labelHost.style.getPropertyValue('--anchor-height')) || 0;
  const overflowRight = shellBounds.right - (view.innerWidth - LABEL_VIEWPORT_GAP);
  const overflowLeft = LABEL_VIEWPORT_GAP - shellBounds.left;
  const canRenderInsideAnchor = anchorHeight > shellBounds.height + LABEL_INSIDE_OFFSET * 2;

  if (shellBounds.top < LABEL_VIEWPORT_GAP || anchorTop <= shellBounds.height + LABEL_VIEWPORT_GAP) {
    if (canRenderInsideAnchor) {
      labelHost.style.setProperty('--translate-y', `${LABEL_INSIDE_OFFSET}px`);
      labelHost.setAttribute('data-inside-label', 'true');
    } else {
      labelHost.style.setProperty('--translate-y', `${anchorHeight + LABEL_VIEWPORT_GAP}px`);
      labelHost.removeAttribute('data-inside-label');
    }
  } else {
    labelHost.style.setProperty('--translate-y', 'calc(-100% - var(--stack-offset-y))');
    labelHost.removeAttribute('data-inside-label');
  }

  if (overflowRight > 0) {
    labelHost.style.setProperty('--translate-x', `${-overflowRight}px`);
    return;
  }

  if (overflowLeft > 0) {
    labelHost.style.setProperty('--translate-x', `${overflowLeft}px`);
  }
}

function scheduleViewportClamp(labelHost, view) {
  const raf =
    (typeof view?.requestAnimationFrame === 'function' && view.requestAnimationFrame.bind(view)) ||
    (typeof globalThis.window?.requestAnimationFrame === 'function' &&
      globalThis.window.requestAnimationFrame.bind(globalThis.window)) ||
    ((callback) => globalThis.setTimeout(callback, 0));

  raf(() => clampLabelIntoViewport(labelHost, view));
}

export class Label extends HTMLElement {
  constructor() {
    super();
    this.$shadow = this.attachShadow({ mode: 'closed' });
    this.styles = supportsAdoptedStyleSheets ? [LabelStyles] : [label_css];
    this.boundDispatchQuery = this.dispatchQuery.bind(this);
    this.boundDispatchAction = this.dispatchAction.bind(this);
    this.boundOnResize = this.onViewportChange.bind(this);
    this.sourceElement = null;
    this.nodeLabelId = null;
  }

  connectedCallback() {
    if (supportsAdoptedStyleSheets) this.$shadow.adoptedStyleSheets = this.styles;
    this.bindInteractiveAnchors();
    window.addEventListener('resize', this.boundOnResize);
    window.addEventListener('scroll', this.boundOnResize, true);
  }

  disconnectedCallback() {
    this.unbindInteractiveAnchors();
    window.removeEventListener('resize', this.boundOnResize);
    window.removeEventListener('scroll', this.boundOnResize, true);
  }

  bindInteractiveAnchors() {
    $('a', this.$shadow).on('click mouseenter', this.boundDispatchQuery);
    $('button[data-action]', this.$shadow).on('click', this.boundDispatchAction);
  }

  unbindInteractiveAnchors() {
    $('a', this.$shadow).off('click mouseenter', this.boundDispatchQuery);
    $('button[data-action]', this.$shadow).off('click', this.boundDispatchAction);
  }

  onViewportChange() {
    const raf =
      typeof window.requestAnimationFrame === 'function'
        ? window.requestAnimationFrame.bind(window)
        : (callback) => window.setTimeout(callback, 0);

    raf(() => {
      const node_label_id = this.nodeLabelId ?? this.$shadow.host.getAttribute('data-label-id');
      const source_el =
        this.sourceElement ??
        (node_label_id ? $(`[data-label-id="${node_label_id}"]`)[0] : null);

      if (!source_el) return;

      this.position = {
        node_label_id,
        sourceElement: source_el,
        boundingRect: source_el.getBoundingClientRect(),
      };
    });
  }

  dispatchQuery(e) {
    this.$shadow.host.dispatchEvent(
      new CustomEvent('query', {
        bubbles: true,
        detail: {
          text: e.target.textContent,
          activator: e.type,
        },
      })
    );
  }

  dispatchAction(event) {
    event.preventDefault();
    event.stopPropagation();

    const action = event.currentTarget?.getAttribute('data-action');
    const nodeLabelId = this.$shadow.host.getAttribute('data-label-id');
    debugLog('dispatch-action', {
      action,
      nodeLabelId,
    });
    if (!action) return;

    this.$shadow.host.dispatchEvent(
      new CustomEvent('selection-action', {
        bubbles: true,
        detail: {
          action,
          nodeLabelId,
        },
      })
    );
  }

  set text(content) {
    this._text = content;
  }

  set position({ boundingRect, node_label_id, sourceElement = null }) {
    this.nodeLabelId = node_label_id ?? null;
    this.sourceElement = sourceElement;
    this.unbindInteractiveAnchors();
    this.$shadow.innerHTML = this.render(node_label_id);
    this.bindInteractiveAnchors();
    this.update = boundingRect;
  }

  set update({ x, y, width, height = 0 }) {
    const view = this.ownerDocument?.defaultView || globalThis.window;
    if (!view) return;

    this.style.setProperty('--top', `${y}px`);
    this.style.setProperty('--left', `${x - 1}px`);
    this.style.setProperty('--anchor-height', `${height}px`);
    this.style.setProperty(
      '--max-width',
      `${Math.max(width, view.innerWidth - LABEL_VIEWPORT_GAP * 2)}px`
    );
    clampLabelIntoViewport(this, view);
    scheduleViewportClamp(this, view);
  }

  render(node_label_id) {
    this.$shadow.host.setAttribute('data-label-id', node_label_id);
    const readOnly = this.$shadow.host.getAttribute('data-readonly-label') === 'true';
    const pageMode = getCurrentPageMode();
    const actionButtons = this.renderActionButtons(pageMode);

    return `${this.renderStyles()}
      <span class="label-shell">
        <span class="label-text">${this._text}</span>
        ${readOnly ? '' : `
          ${actionButtons}
        `}
      </span>`;
  }

  renderActionButtons(pageMode) {
    const actions = isLocalSnapshotMode(pageMode)
      ? [
          { action: 'send-selection', label: '发送' },
          { action: 'select-parent', label: '父级' },
          { action: 'capture-selection', label: '采集' },
          { action: 'annotate-selection', label: '备注' },
        ]
      : [
          { action: 'send-selection', label: '发送' },
          { action: 'select-parent', label: '父级' },
          { action: 'capture-selection', label: '采集' },
          { action: 'analyze-selection', label: '分析' },
          { action: 'annotate-selection', label: '备注' },
        ];

    return actions
      .map(
        ({ action, label, disabled, title }) =>
          `<button type="button" data-action="${action}"${disabled ? ' disabled' : ''}${
            title ? ` title="${title}"` : ''
          }>${label}</button>`
      )
      .join('');
  }

  renderStyles() {
    return supportsAdoptedStyleSheets ? '' : `<style>${this.styles.join('\n')}</style>`;
  }
}

(() => {
  const registry =
    globalThis.customElements ??
    globalThis.window?.customElements ??
    globalThis.document?.defaultView?.customElements;

  if (!registry) {
    throw new Error('Custom Elements registry is unavailable');
  }

  if (!registry.get('visbug-label')) {
    try {
      registry.define('visbug-label', Label);
    } catch (error) {
      if (
        !(error instanceof DOMException) ||
        error.name !== 'NotSupportedError' ||
        !registry.get('visbug-label')
      ) {
        throw error;
      }
    }
  }
})();
