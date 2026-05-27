import {
  buildElementSummary,
  buildPickedElementCaptureContext,
} from '../vendor/app/features/selection-actions.js';
import { isLocalSnapshotMode, isLivePageMode } from './page-mode.js';

const ANNOTATION_DIALOG_TAG = 'webmcp-page-annotation-dialog';
const ANNOTATION_LAYER_SELECTOR = '[data-webmcp-annotation-layer="true"]';
const ANNOTATION_UI_SELECTOR = '[data-webmcp-annotation-ui="true"]';
const DIALOG_STYLES = `
  :host {
    position: fixed;
    inset: 0;
    z-index: 2147483647;
    display: flex;
    align-items: center;
    justify-content: center;
    background: rgba(15, 23, 42, 0.32);
    backdrop-filter: blur(8px);
    font-family:
      ui-sans-serif, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  }

  * {
    box-sizing: border-box;
  }

  .panel {
    width: min(520px, calc(100vw - 32px));
    border-radius: 20px;
    border: 1px solid rgba(148, 163, 184, 0.22);
    background: rgba(255, 255, 255, 0.97);
    color: #0f172a;
    box-shadow: 0 28px 80px rgba(15, 23, 42, 0.24);
    overflow: hidden;
  }

  .header {
    padding: 18px 20px 12px;
    border-bottom: 1px solid rgba(226, 232, 240, 0.9);
  }

  .title {
    margin: 0;
    font-size: 16px;
    line-height: 1.4;
    font-weight: 600;
  }

  .subtitle {
    margin: 6px 0 0;
    font-size: 12px;
    line-height: 1.5;
    color: #475569;
  }

  .body {
    padding: 16px 20px 20px;
    display: grid;
    gap: 14px;
  }

  .field {
    display: grid;
    gap: 8px;
  }

  .label {
    font-size: 12px;
    line-height: 1.4;
    font-weight: 600;
    color: #334155;
  }

  textarea {
    width: 100%;
    resize: vertical;
    border: 1px solid rgba(148, 163, 184, 0.4);
    border-radius: 12px;
    padding: 10px 12px;
    background: #fff;
    color: #0f172a;
    font: inherit;
    line-height: 1.5;
    outline: none;
  }

  textarea:focus {
    border-color: rgba(59, 130, 246, 0.85);
    box-shadow: 0 0 0 3px rgba(59, 130, 246, 0.18);
  }

  textarea[readonly] {
    background: #f8fafc;
    color: #475569;
  }

  .actions {
    display: flex;
    justify-content: flex-end;
    gap: 10px;
    padding-top: 2px;
  }

  button {
    border: 0;
    border-radius: 999px;
    padding: 10px 16px;
    font: inherit;
    font-size: 13px;
    line-height: 1;
    cursor: pointer;
  }

  button[data-action="cancel"] {
    background: #e2e8f0;
    color: #334155;
  }

  button[data-action="submit"] {
    background: #2563eb;
    color: #fff;
  }

  button[data-action="submit"]:disabled {
    background: #94a3b8;
    cursor: not-allowed;
  }

  @media (prefers-color-scheme: dark) {
    .panel {
      background: rgba(15, 23, 42, 0.96);
      color: #e2e8f0;
      border-color: rgba(51, 65, 85, 0.95);
      box-shadow: 0 28px 80px rgba(2, 6, 23, 0.45);
    }

    .header {
      border-bottom-color: rgba(51, 65, 85, 0.95);
    }

    .subtitle,
    .label,
    textarea[readonly] {
      color: #cbd5e1;
    }

    textarea {
      background: rgba(15, 23, 42, 0.92);
      color: #f8fafc;
      border-color: rgba(71, 85, 105, 0.95);
    }

    button[data-action="cancel"] {
      background: rgba(51, 65, 85, 0.95);
      color: #e2e8f0;
    }
  }
`;

const annotationState = {
  records: new Map(),
  visibleKeys: new Set(),
  historyVisible: false,
  subscribers: new Set(),
  hostPositionMemory: new WeakMap(),
  overlayLayer: null,
  renderFrame: null,
  cleanupBound: false,
  dialogOpenHandlerForTest: null,
};

async function editAnnotationRecord(record, { pageMode } = {}) {
  if (!record) {
    return null;
  }

  const element = resolveRecordElement(record);
  const selectorLabel =
    record.selectorLabel ||
    record.target?.selector ||
    record.target?.xpath ||
    (element ? buildElementSummary(element) : null) ||
    '当前备注元素';
  const nextContent = await openAnnotationDialog({
    title: `查看或编辑${getAnnotationPromptLabel(pageMode)}元素备注`,
    subtitle: '选择器只读，备注内容支持多行编辑。',
    selector: selectorLabel,
    content: record.content ?? '',
  });

  if (typeof nextContent !== 'string') {
    return null;
  }

  const trimmed = nextContent.trim();
  if (!trimmed) {
    return null;
  }

  const nextRecord =
    element instanceof HTMLElement ? buildRecordForElement(element, trimmed) : { ...record, content: trimmed };
  nextRecord.createdAt = record.createdAt ?? nextRecord.createdAt ?? Date.now();
  nextRecord.updatedAt = Date.now();
  annotationState.records.delete(record.key);
  annotationState.records.set(nextRecord.key, nextRecord);
  annotationState.visibleKeys.add(nextRecord.key);
  scheduleMarkerRender();
  emitState();
  return nextRecord;
}

class PageAnnotationDialog extends HTMLElement {
  #resolver = null;
  #selector = '';
  #content = '';

  constructor() {
    super();
    this.$shadow = this.attachShadow({ mode: 'closed' });
    this.handleSubmit = this.handleSubmit.bind(this);
    this.handleCancel = this.handleCancel.bind(this);
    this.handleKeydown = this.handleKeydown.bind(this);
    this.handleEditorKeydown = this.handleEditorKeydown.bind(this);
    this.handleInput = this.handleInput.bind(this);
  }

  connectedCallback() {
    window.addEventListener('keydown', this.handleKeydown, true);
    this.render();
  }

  disconnectedCallback() {
    window.removeEventListener('keydown', this.handleKeydown, true);
  }

  open({ title, subtitle, selector, content }) {
    this.#selector = selector;
    this.#content = content;
    this.dataset.title = title;
    this.dataset.subtitle = subtitle;
    this.render();

    return new Promise((resolve) => {
      this.#resolver = resolve;
      queueMicrotask(() => {
        this.$shadow.querySelector('textarea[data-field="content"]')?.focus();
      });
    });
  }

  close(result) {
    const resolver = this.#resolver;
    this.#resolver = null;
    this.remove();
    resolver?.(result);
  }

  handleSubmit(event) {
    event.preventDefault();
    const contentField = this.$shadow.querySelector('textarea[data-field="content"]');
    const trimmed = contentField?.value?.trim?.() ?? '';
    if (!trimmed) {
      this.render();
      this.$shadow.querySelector('textarea[data-field="content"]')?.focus();
      return;
    }

    this.close(trimmed);
  }

  handleCancel(event) {
    event?.preventDefault?.();
    this.close(null);
  }

  handleKeydown(event) {
    if (event.key === 'Escape') {
      event.preventDefault();
      this.close(null);
    }
  }

  handleEditorKeydown(event) {
    if (event.key !== 'Escape') {
      event.stopPropagation();
    }
  }

  handleInput() {
    const contentField = this.$shadow.querySelector('textarea[data-field="content"]');
    this.#content = contentField?.value ?? '';
    const submitButton = this.$shadow.querySelector('button[data-action="submit"]');
    if (submitButton) {
      submitButton.disabled = !this.#content.trim();
    }
  }

  render() {
    const title = this.dataset.title ?? '添加备注';
    const subtitle = this.dataset.subtitle ?? '';
    const submitDisabled = !this.#content.trim();

    this.$shadow.innerHTML = `
      <style>${DIALOG_STYLES}</style>
      <div class="panel" data-webmcp-annotation-ui="true">
        <div class="header">
          <h2 class="title">${escapeHtml(title)}</h2>
          <p class="subtitle">${escapeHtml(subtitle)}</p>
        </div>
        <form class="body">
          <label class="field">
            <span class="label">选择器</span>
            <textarea data-field="selector" rows="2" readonly>${escapeHtml(this.#selector)}</textarea>
          </label>
          <label class="field">
            <span class="label">备注内容</span>
            <textarea data-field="content" rows="5" placeholder="补充你希望 AI 理解的上下文、问题或判断依据...">${escapeHtml(this.#content)}</textarea>
          </label>
          <div class="actions">
            <button type="button" data-action="cancel">取消</button>
            <button type="submit" data-action="submit"${submitDisabled ? ' disabled' : ''}>保存备注</button>
          </div>
        </form>
      </div>
    `;

    this.$shadow.querySelector('form')?.addEventListener('submit', this.handleSubmit);
    this.$shadow
      .querySelector('button[data-action="cancel"]')
      ?.addEventListener('click', this.handleCancel);
    this.$shadow
      .querySelector('textarea[data-field="content"]')
      ?.addEventListener('keydown', this.handleEditorKeydown);
    this.$shadow
      .querySelector('textarea[data-field="content"]')
      ?.addEventListener('input', this.handleInput);
  }
}

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;');
}

function getAnnotationPromptLabel(pageMode) {
  if (isLocalSnapshotMode(pageMode)) {
    return '本地快照';
  }

  if (isLivePageMode(pageMode)) {
    return '真实网页';
  }

  return '当前页面';
}

function ensureDialogRegistry() {
  const registry = globalThis.customElements ?? globalThis.window?.customElements;
  if (registry && !registry.get(ANNOTATION_DIALOG_TAG)) {
    registry.define(ANNOTATION_DIALOG_TAG, PageAnnotationDialog);
  }
}

function buildTargetKey(target) {
  if (target.selector) return `selector:${target.selector}`;
  if (target.xpath) return `xpath:${target.xpath}`;
  if (target.id) return `id:${target.tagName}:${target.id}`;
  return `node:${target.tagName}:${target.text ?? ''}`;
}

function buildRecordForElement(element, content) {
  const target = buildPickedElementCaptureContext(element);
  const key = buildTargetKey(target);
  const previous = annotationState.records.get(key);

  return {
    key,
    target,
    content,
    selectorLabel: target.selector || target.xpath || buildElementSummary(element),
    element,
    createdAt: previous?.createdAt ?? Date.now(),
    updatedAt: Date.now(),
  };
}

function getRecordForElement(element) {
  const target = buildPickedElementCaptureContext(element);
  return annotationState.records.get(buildTargetKey(target)) ?? null;
}

function normalizeAnnotationText(value) {
  return String(value || '')
    .replace(/\s+/g, ' ')
    .trim();
}

function resolveElementByXPath(xpath) {
  if (!xpath) {
    return null;
  }

  try {
    const result = document.evaluate(
      xpath,
      document,
      null,
      window.XPathResult.FIRST_ORDERED_NODE_TYPE,
      null,
    );
    return result.singleNodeValue instanceof HTMLElement ? result.singleNodeValue : null;
  } catch (_) {
    return null;
  }
}

function getRectDistanceScore(targetRect, candidateRect) {
  if (!targetRect || !candidateRect) {
    return 0;
  }

  const targetCenterX = targetRect.x + targetRect.width / 2;
  const targetCenterY = targetRect.y + targetRect.height / 2;
  const candidateCenterX = candidateRect.x + candidateRect.width / 2;
  const candidateCenterY = candidateRect.y + candidateRect.height / 2;
  const distance = Math.hypot(targetCenterX - candidateCenterX, targetCenterY - candidateCenterY);

  return Math.max(0, 30 - distance / 20);
}

function scoreElementCandidate(element, target) {
  if (!(element instanceof HTMLElement) || !target) {
    return Number.NEGATIVE_INFINITY;
  }

  let score = 0;
  const targetTag = String(target.tagName || '').toLowerCase();
  const candidateTag = element.tagName.toLowerCase();
  if (targetTag && candidateTag !== targetTag) {
    return Number.NEGATIVE_INFINITY;
  }
  score += 40;

  if (target.id) {
    score += element.id === target.id ? 80 : -60;
  }

  const targetText = normalizeAnnotationText(target.text);
  const candidateText = normalizeAnnotationText(element.innerText || element.textContent);
  if (targetText) {
    if (candidateText === targetText) {
      score += 60;
    } else if (candidateText.includes(targetText) || targetText.includes(candidateText)) {
      score += 25;
    } else {
      score -= 20;
    }
  }

  if (Array.isArray(target.classList) && target.classList.length) {
    const candidateClasses = new Set(Array.from(element.classList));
    const matchedClassCount = target.classList.filter((className) => candidateClasses.has(className)).length;
    score += matchedClassCount * 8;
    if (!matchedClassCount) {
      score -= 12;
    }
  }

  const targetDataAttributes = target.dataAttributes ?? {};
  const dataAttributeEntries = Object.entries(targetDataAttributes);
  if (dataAttributeEntries.length) {
    let matchedDataCount = 0;
    dataAttributeEntries.forEach(([key, value]) => {
      if (element.getAttribute(`data-${key}`) === value) {
        matchedDataCount += 1;
      }
    });
    score += matchedDataCount * 10;
  }

  const rect = element.getBoundingClientRect();
  score += getRectDistanceScore(target.rect, rect);

  if (rect.width <= 0 || rect.height <= 0) {
    score -= 25;
  }

  return score;
}

function resolveBestElementCandidate(candidates, target) {
  let bestElement = null;
  let bestScore = Number.NEGATIVE_INFINITY;

  candidates.forEach((candidate) => {
    const score = scoreElementCandidate(candidate, target);
    if (score > bestScore) {
      bestScore = score;
      bestElement = candidate;
    }
  });

  return bestScore >= 40 ? bestElement : null;
}

function resolveElementBySelector(selector, target) {
  if (!selector) {
    return null;
  }

  try {
    const matches = Array.from(document.querySelectorAll(selector)).filter(
      (node) => node instanceof HTMLElement,
    );

    if (!matches.length) {
      return null;
    }

    if (matches.length === 1) {
      return matches[0];
    }

    return resolveBestElementCandidate(matches, target);
  } catch (_) {
    return null;
  }
}

function resolveRecordElement(record) {
  if (record.element?.isConnected) {
    return record.element;
  }

  const selector = record.target?.selector;
  const xpath = record.target?.xpath;
  const resolved =
    resolveElementBySelector(selector, record.target) ??
    resolveElementByXPath(xpath) ??
    null;

  if (resolved instanceof HTMLElement) {
    record.element = resolved;
    return resolved;
  }

  return null;
}

function getSelectedRecordKeys() {
  const keys = new Set();

  document.querySelectorAll('[data-selected="true"]').forEach((node) => {
    if (!(node instanceof HTMLElement)) return;
    keys.add(buildTargetKey(buildPickedElementCaptureContext(node)));
  });

  return keys;
}

function ensureMarkerHost(element) {
  if (!(element instanceof HTMLElement)) {
    return;
  }

  const computedPosition = window.getComputedStyle(element).position;
  if (computedPosition !== 'static') {
    return;
  }

  if (!annotationState.hostPositionMemory.has(element)) {
    annotationState.hostPositionMemory.set(element, element.style.position || null);
  }

  element.style.position = 'relative';
}

function ensureOverlayLayer() {
  if (annotationState.overlayLayer?.isConnected) {
    return annotationState.overlayLayer;
  }

  const layer = document.createElement('div');
  layer.setAttribute('data-webmcp-annotation-overlay-layer', 'true');
  layer.setAttribute('data-webmcp-annotation-ui', 'true');
  layer.style.position = 'fixed';
  layer.style.inset = '0';
  layer.style.pointerEvents = 'none';
  layer.style.zIndex = '2147483646';
  document.body.appendChild(layer);
  annotationState.overlayLayer = layer;
  return layer;
}

function clearRenderedMarkers() {
  document.querySelectorAll('[data-webmcp-annotation-marker="true"]').forEach((node) => {
    node.remove();
  });
}

function parsePixelValue(value) {
  const numeric = Number.parseFloat(String(value || '').replace('px', '').trim());
  return Number.isFinite(numeric) ? numeric : null;
}

function resolveSelectedOverlayRect(element) {
  if (!(element instanceof HTMLElement)) {
    return null;
  }

  const labelId = element.getAttribute('data-label-id');
  if (!labelId) {
    return null;
  }

  const overlay = document.querySelector(`visbug-selected[data-label-id="${labelId}"]`);
  if (!(overlay instanceof HTMLElement) || !overlay.$shadow) {
    return null;
  }

  const top = parsePixelValue(overlay.style.getPropertyValue('--top'));
  const left = parsePixelValue(overlay.style.getPropertyValue('--left'));
  const svg = overlay.$shadow.querySelector('svg');
  const width = parsePixelValue(svg?.getAttribute?.('width'));
  const height = parsePixelValue(svg?.getAttribute?.('height'));

  if (top == null || left == null || width == null || height == null) {
    return null;
  }

  const scrollX = window.scrollX ?? 0;
  const scrollY = window.scrollY ?? 0;

  return {
    top: top - scrollY,
    left: left - scrollX,
    right: left - scrollX + width,
    bottom: top - scrollY + height,
    width,
    height,
  };
}

function shouldUseOverlayMarker(element) {
  if (!(element instanceof HTMLElement)) {
    return true;
  }

  if (/^(TD|TH|TR|TBODY|THEAD|TFOOT|TABLE)$/i.test(element.tagName)) {
    return true;
  }

  let current = element;
  for (let depth = 0; current && depth < 3; depth += 1) {
    const style = window.getComputedStyle(current);
    if (
      style.overflow === 'hidden' ||
      style.overflowX === 'hidden' ||
      style.overflowY === 'hidden' ||
      style.textOverflow === 'ellipsis'
    ) {
      return true;
    }
    current = current.parentElement;
  }

  return false;
}

function createMarker(record, selectedKeys, { overlay = false, rect = null } = {}) {
  const marker = document.createElement('div');
  const alwaysVisible = selectedKeys.has(record.key) || annotationState.visibleKeys.has(record.key);
  marker.setAttribute('data-webmcp-annotation-marker', 'true');
  marker.setAttribute('data-webmcp-annotation-ui', 'true');
  marker.setAttribute('data-webmcp-annotation-key', record.key);
  marker.title = record.content;
  marker.style.position = 'absolute';
  if (overlay && rect) {
    marker.style.left = `${Math.max(6, Math.min(window.innerWidth - 44, rect.right - 14))}px`;
    marker.style.top = `${Math.max(6, Math.min(window.innerHeight - 26, rect.top - 8))}px`;
  } else {
    marker.style.right = '4px';
    marker.style.top = '4px';
  }
  marker.style.minWidth = '26px';
  marker.style.height = '20px';
  marker.style.padding = '0 7px 0 6px';
  marker.style.borderRadius = '999px';
  marker.style.border = '2px solid rgba(255, 255, 255, 0.96)';
  marker.style.display = alwaysVisible || annotationState.historyVisible ? 'grid' : 'none';
  marker.style.placeItems = 'center';
  marker.style.gridAutoFlow = 'column';
  marker.style.columnGap = '4px';
  marker.style.background = alwaysVisible
    ? 'linear-gradient(135deg, #2563eb 0%, #1d4ed8 100%)'
    : 'linear-gradient(135deg, #334155 0%, #0f172a 100%)';
  marker.style.boxShadow = alwaysVisible
    ? '0 10px 24px rgba(37, 99, 235, 0.28)'
    : '0 8px 18px rgba(15, 23, 42, 0.22)';
  marker.style.color = '#ffffff';
  marker.style.fontSize = '10px';
  marker.style.fontWeight = '700';
  marker.style.lineHeight = '1';
  marker.style.letterSpacing = '0.02em';
  marker.style.pointerEvents = 'auto';
  marker.style.cursor = 'pointer';
  marker.style.zIndex = '2147483646';
  marker.addEventListener('click', (event) => {
    event.preventDefault();
    event.stopPropagation();
    void editAnnotationRecord(record);
  });

  const dot = document.createElement('span');
  dot.textContent = '●';
  dot.style.fontSize = '8px';
  dot.style.opacity = alwaysVisible ? '0.95' : '0.75';

  const text = document.createElement('span');
  text.textContent = '注';

  marker.append(dot, text);
  return marker;
}

function renderMarkersNow() {
  annotationState.renderFrame = null;
  clearRenderedMarkers();

  const selectedKeys = getSelectedRecordKeys();

  annotationState.records.forEach((record) => {
    const element = resolveRecordElement(record);
    if (!(element instanceof HTMLElement)) {
      return;
    }

    const shouldShow =
      selectedKeys.has(record.key) ||
      annotationState.visibleKeys.has(record.key) ||
      annotationState.historyVisible;
    if (!shouldShow) {
      return;
    }

    if (shouldUseOverlayMarker(element)) {
      const rect = resolveSelectedOverlayRect(element) ?? element.getBoundingClientRect();
      ensureOverlayLayer().appendChild(
        createMarker(record, selectedKeys, {
          overlay: true,
          rect,
        }),
      );
      return;
    }

    ensureMarkerHost(element);
    element.appendChild(createMarker(record, selectedKeys));
  });
}

function scheduleMarkerRender() {
  if (annotationState.renderFrame != null) {
    return;
  }

  const schedule =
    typeof window.requestAnimationFrame === 'function'
      ? window.requestAnimationFrame.bind(window)
      : (callback) => {
          queueMicrotask(callback);
          return 0;
        };

  annotationState.renderFrame = schedule(() => {
    renderMarkersNow();
  });
}

function emitState() {
  const snapshot = {
    count: annotationState.records.size,
    historyVisible: annotationState.historyVisible,
  };

  annotationState.subscribers.forEach((listener) => listener(snapshot));
}

function ensureWindowBindings() {
  if (annotationState.cleanupBound) {
    return;
  }

  const rerender = () => scheduleMarkerRender();
  window.addEventListener('scroll', rerender, true);
  window.addEventListener('resize', rerender, true);
  annotationState.cleanupBound = true;
}

function ensureDialogElement() {
  ensureDialogRegistry();
  const existing = document.querySelector(ANNOTATION_DIALOG_TAG);
  if (existing instanceof PageAnnotationDialog) {
    return existing;
  }

  const dialog = document.createElement(ANNOTATION_DIALOG_TAG);
  dialog.setAttribute('data-webmcp-annotation-ui', 'true');
  document.body.appendChild(dialog);
  return dialog;
}

async function openAnnotationDialog(payload) {
  if (typeof annotationState.dialogOpenHandlerForTest === 'function') {
    return annotationState.dialogOpenHandlerForTest(payload);
  }

  const dialog = ensureDialogElement();
  return dialog.open(payload);
}

export async function requestSelectionAnnotationContent(element, { pageMode } = {}) {
  const currentRecord = getRecordForElement(element);
  const target = buildPickedElementCaptureContext(element);
  const selectorLabel = target.selector || target.xpath || buildElementSummary(element);

  return openAnnotationDialog({
    title: `为所选${getAnnotationPromptLabel(pageMode)}元素添加备注`,
    subtitle: '选择器只读，备注内容支持多行编辑。',
    selector: selectorLabel,
    content: currentRecord?.content ?? '',
  });
}

export function upsertSelectionAnnotation(element, content) {
  ensureWindowBindings();
  const record = buildRecordForElement(element, content);
  annotationState.records.set(record.key, record);
  annotationState.visibleKeys.add(record.key);
  scheduleMarkerRender();
  emitState();
  return record;
}

export function syncSelectionAnnotationUi() {
  if (!annotationState.records.size) {
    return;
  }

  scheduleMarkerRender();
}

export function subscribeSelectionAnnotationState(listener) {
  annotationState.subscribers.add(listener);
  listener({
    count: annotationState.records.size,
    historyVisible: annotationState.historyVisible,
  });

  return () => {
    annotationState.subscribers.delete(listener);
  };
}

export function toggleSelectionAnnotationMarkers(forceVisible) {
  annotationState.historyVisible =
    typeof forceVisible === 'boolean' ? forceVisible : !annotationState.historyVisible;
  scheduleMarkerRender();
  emitState();
  return annotationState.historyVisible;
}

export function buildSelectionAnnotateMessage({ nonce, element, content }) {
  return {
    type: 'page_edit_selection_annotate',
    payload: {
      nonce,
      target: buildPickedElementCaptureContext(element),
      content,
    },
  };
}

export function clearSelectionAnnotationUi() {
  annotationState.records.clear();
  annotationState.visibleKeys.clear();
  annotationState.historyVisible = false;
  if (annotationState.renderFrame != null) {
    if (typeof window.cancelAnimationFrame === 'function') {
      window.cancelAnimationFrame(annotationState.renderFrame);
    } else if (annotationState.renderFrame !== 0) {
      window.clearTimeout(annotationState.renderFrame);
    }
    annotationState.renderFrame = null;
  }
  document.querySelectorAll(ANNOTATION_UI_SELECTOR).forEach((node) => node.remove());
  annotationState.overlayLayer = null;
  emitState();
}

export function resolveAnnotationElementForTest(target) {
  return (
    resolveElementBySelector(target?.selector ?? null, target) ??
    resolveElementByXPath(target?.xpath ?? null) ??
    null
  );
}

export async function editAnnotationRecordForTest(record, options) {
  return editAnnotationRecord(record, options);
}

export function setAnnotationDialogOpenHandlerForTest(handler) {
  annotationState.dialogOpenHandlerForTest = typeof handler === 'function' ? handler : null;
}
