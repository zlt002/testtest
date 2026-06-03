import $ from '../vendor-deps/blingblingjs.js';
import hotkeys from '../vendor-deps/hotkeys-js.js';

import { TinyColor } from '../vendor-deps/tinycolor/public_api.js';
import { canMoveLeft, canMoveRight, canMoveUp } from './move.js';
import { createHistoryManager } from './history.js';
import { watchImagesForUpload } from './imageswap.js';
import { queryPage } from './search.js';
import { createMeasurements, clearMeasurements } from './measurements.js';
import { createMarginVisual } from './margin.js';
import { createPaddingVisual } from './padding.js';
import {
  buildMarqueeRect,
  didMovePastThreshold,
  filterIntersectingElements,
  shouldStartIntersectionMarquee,
} from './intersection-marquee.js';

import { showTip as showMetaTip, removeAll as removeAllMetaTips } from './metatip.js';
import {
  showTip as showAccessibilityTip,
  removeAll as removeAllAccessibilityTips,
} from './accessibility.js';
import {
  buildPickedElementCaptureContext,
  describeSelectedElement,
  findSelectableParentElement,
  isPageEditUiElement,
} from './selection-actions.js';
import {
  buildSelectionAnnotateMessage,
  requestSelectionAnnotationContent,
  syncSelectionAnnotationUi,
  upsertSelectionAnnotation,
} from '../../../runtime/annotations.js';
import {
  getCurrentPageMode,
  hasPageEditRuntimeConfig,
  isEditableWorkbenchMode,
} from '../../../runtime/page-mode.js';
import { createSelectionPresentationPolicy } from './selection-presentation.js';

import {
  metaKey,
  htmlStringToDom,
  htmlStringToNodes,
  createClassname,
  camelToDash,
  isOffBounds,
  getStyles,
  deepElementFromPoint,
  getShadowValues,
  isSelectorValid,
  findNearestChildElement,
  findNearestParentElement,
  getTextShadowValues,
} from '../utilities/index.js';
import '../components/selection/selected.element.js';

export function Selectable(visbug) {
  const page = document.body;
  const history = createHistoryManager();
  let selected = [];
  let selectedCallbacks = [];
  let labels = [];
  let handles = [];
  let nextSelectionId = 0;
  let nodeClipboard = null;
  let copyBackup = null;
  let copiedStyles = null;
  const requiresSelectionBridgeNonce = visbug instanceof HTMLElement;
  let selectionBridgeNonce = null;

  const hover_state = {
    target: null,
    element: null,
    label: null,
  };

  let marqueeState = {
    active: false,
    dragging: false,
    suppressedClick: null,
    start: null,
    current: null,
    selectedSnapshot: [],
    overlay: null,
  };

  const isPrimaryModifierPressed = (event) => (metaKey === 'cmd' ? event.metaKey : event.ctrlKey);

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

  const formatDebugNode = (node) => {
    if (!(node instanceof Element)) return String(node);

    const id = node.id ? `#${node.id}` : '';
    const classes =
      typeof node.className === 'string' && node.className.trim()
        ? `.${node.className.trim().split(/\s+/).join('.')}`
        : '';

    return `${node.nodeName.toLowerCase()}${id}${classes}`;
  };

  const formatDebugSelection = (elements = []) =>
    elements.map((element) => formatDebugNode(element));

  const debugLog = (label, payload = {}) => {
    if (!pageEditDebugEnabled()) return;
    console.log(`[page-edit][selectable] ${label}`, payload);
  };

  const getWorkbenchMode = () => getCurrentPageMode();
  const getPresentationPolicy = () =>
    createSelectionPresentationPolicy({
      pageMode: getWorkbenchMode(),
      activeTool: visbug.activeTool,
      showSelectionActionsEverywhere: !!visbug.shouldShowSelectionActionsEverywhere?.(),
    });

  const canEditCurrentPage = () => {
    if (!hasPageEditRuntimeConfig()) {
      return true;
    }

    return isEditableWorkbenchMode(getWorkbenchMode());
  };

  const blockEditMutation = (event, reason) => {
    debugLog('edit:block', {
      reason,
      pageMode: getWorkbenchMode(),
      selection: formatDebugSelection(selected),
    });

    if (typeof event?.preventDefault === 'function') {
      event.preventDefault();
    }

    if (typeof event?.stopPropagation === 'function') {
      event.stopPropagation();
    }

    return false;
  };

  const undoHotkeys = `${metaKey}+z`;
  const redoHotkeys = metaKey === 'cmd' ? `${metaKey}+shift+z` : `${metaKey}+shift+z,${metaKey}+y`;
  const pageEditAllowedKeys = new Set([
    'Escape',
    'Backspace',
    'Delete',
    'Tab',
    'Enter',
    'Shift',
    'Meta',
    'Control',
    'Alt',
    'ArrowUp',
    'ArrowDown',
    'ArrowLeft',
    'ArrowRight',
    '[',
    ']',
  ]);

  const isPageEditUiTarget = (target) => target instanceof Element && isPageEditUiElement(target);

  const stopEventForPageFreeze = (event) => {
    debugLog('freeze:block', {
      type: event.type,
      key: event.key,
      code: event.code,
      target: formatDebugNode(event.target),
      ctrlKey: event.ctrlKey,
      metaKey: event.metaKey,
      shiftKey: event.shiftKey,
      altKey: event.altKey,
    });
    event.preventDefault();
    event.stopPropagation();
    if (typeof event.stopImmediatePropagation === 'function') {
      event.stopImmediatePropagation();
    }
  };

  const isPageEditShortcutEvent = (event) => {
    if (event.metaKey || event.ctrlKey || event.altKey) {
      return true;
    }

    return pageEditAllowedKeys.has(event.key);
  };

  const resolveEditableTarget = (target) => {
    if (target instanceof Element) {
      return target.closest('[contenteditable="true"], input, textarea');
    }

    const parentElement = target?.parentElement;
    if (parentElement instanceof Element) {
      return parentElement.closest('[contenteditable="true"], input, textarea');
    }

    return null;
  };

  const isEditableKeyboardTarget = (target) => {
    const editableRoot = resolveEditableTarget(target);
    if (!editableRoot) return false;

    if (editableRoot.matches('input, textarea')) return true;
    return editableRoot.getAttribute('contenteditable') === 'true';
  };

  const isEditableSelectionTarget = (target) => {
    const editableRoot = resolveEditableTarget(target);
    if (!editableRoot) return false;

    return selected.some((node) =>
      node === editableRoot ||
      (node instanceof Element && node.contains(editableRoot)) ||
      (editableRoot instanceof Element && editableRoot.contains(node))
    );
  };

  const shouldBlockEditableNavigation = (target) => {
    if (!(target instanceof Element)) {
      return false;
    }

    if (!resolveEditableTarget(target)) {
      return false;
    }

    return target.closest('a[href]') instanceof Element;
  };

  const hasDirectEditableTextContent = (el) => {
    if (!(el instanceof Element)) return false;

    if (el.matches('input, textarea')) return true;

    const textNodeType = el.ownerDocument?.defaultView?.Node?.TEXT_NODE ?? 3;

    return Array.from(el.childNodes).some(
      (node) => node.nodeType === textNodeType && String(node.textContent || '').trim().length > 0
    );
  };

  const shouldAllowSelectionForActiveTool = (el) => {
    if (!(el instanceof Element)) return false;

    if (visbug.activeTool !== 'text') return true;
    return hasDirectEditableTextContent(el);
  };

  const freezePageKeyboardInteraction = (event) => {
    if (isPageEditUiTarget(event.target)) {
      debugLog('freeze:pass-ui-target', {
        type: event.type,
        key: event.key,
        target: formatDebugNode(event.target),
      });
      return;
    }
    if (isEditableKeyboardTarget(event.target)) {
      debugLog('freeze:pass-editable-target', {
        type: event.type,
        key: event.key,
        target: formatDebugNode(event.target),
      });
      return;
    }
    if (isPageEditShortcutEvent(event)) {
      debugLog('freeze:pass-shortcut', {
        type: event.type,
        key: event.key,
        target: formatDebugNode(event.target),
        ctrlKey: event.ctrlKey,
        metaKey: event.metaKey,
        shiftKey: event.shiftKey,
        altKey: event.altKey,
      });
      return;
    }
    stopEventForPageFreeze(event);
  };

  const resolveInteractionTarget = (event) => {
    if (isPageEditUiTarget(event.target)) return event.target;
    return deepElementFromPoint(event.clientX, event.clientY) || event.target;
  };

  const debugDocumentBubbleKeyboard = (event) => {
    debugLog('document:bubble', {
      type: event.type,
      key: event.key,
      code: event.code,
      target: formatDebugNode(event.target),
      ctrlKey: event.ctrlKey,
      metaKey: event.metaKey,
      shiftKey: event.shiftKey,
      altKey: event.altKey,
      cancelBubble: event.cancelBubble,
      defaultPrevented: event.defaultPrevented,
    });
  };

  const setSelectionBridgeNonce = (nonce) => {
    selectionBridgeNonce = typeof nonce === 'string' && nonce ? nonce : null;
  };

  const locationChangeListenerKey = '__webmcpPageEditLocationChangeListenerCount__';
  const locationChangePatchStateKey = '__webmcpPageEditLocationChangePatch__';

  const dispatchLocationChangeEvent = (trigger) => {
    window.dispatchEvent(
      new window.CustomEvent('webmcp:page-edit-locationchange', {
        detail: {
          href: window.location.href,
          trigger,
        },
      })
    );
  };

  const ensureLocationChangeEventsPatched = () => {
    const currentCount = Number(window[locationChangeListenerKey] || 0);
    window[locationChangeListenerKey] = currentCount + 1;

    if (window[locationChangePatchStateKey]) return;

    const originalPushState = window.history.pushState.bind(window.history);
    const originalReplaceState = window.history.replaceState.bind(window.history);

    window.history.pushState = function (...args) {
      const result = originalPushState(...args);
      dispatchLocationChangeEvent('pushState');
      return result;
    };

    window.history.replaceState = function (...args) {
      const result = originalReplaceState(...args);
      dispatchLocationChangeEvent('replaceState');
      return result;
    };

    window[locationChangePatchStateKey] = {
      originalPushState,
      originalReplaceState,
    };
  };

  const cleanupLocationChangeEventsPatched = () => {
    const currentCount = Number(window[locationChangeListenerKey] || 0);
    const nextCount = Math.max(0, currentCount - 1);
    window[locationChangeListenerKey] = nextCount;

    if (nextCount > 0) return;

    const patchState = window[locationChangePatchStateKey];
    if (!patchState) return;

    window.history.pushState = patchState.originalPushState;
    window.history.replaceState = patchState.originalReplaceState;
    delete window[locationChangePatchStateKey];
  };

  const isSelectionAnalysisGuidanceActive = () =>
    typeof document?.documentElement?.getAttribute === 'function' &&
    typeof document.documentElement.getAttribute('data-webmcp-page-edit-analysis-mode') ===
      'string';

  let lastKnownHref = window.location.href;

  const handleLocationChange = (event) => {
    const nextHref = window.location.href;
    if (nextHref === lastKnownHref) return;

    debugLog('location:change', {
      previousHref: lastKnownHref,
      nextHref,
      trigger: event?.type || event?.detail?.trigger || 'unknown',
      selectionBefore: formatDebugSelection(selected),
    });

    lastKnownHref = nextHref;
    cleanupTransientUi();
    unselect_all();
  };

  const listen = () => {
    lastKnownHref = window.location.href;
    ensureLocationChangeEventsPatched();

    document.addEventListener('keydown', freezePageKeyboardInteraction, true);
    document.addEventListener('keyup', freezePageKeyboardInteraction, true);
    page.addEventListener('keydown', freezePageKeyboardInteraction, true);
    page.addEventListener('keyup', freezePageKeyboardInteraction, true);
    document.addEventListener('keydown', debugDocumentBubbleKeyboard, false);
    document.addEventListener('keyup', debugDocumentBubbleKeyboard, false);

    page.addEventListener('mousedown', on_pointer_down, true);
    page.addEventListener('click', on_click, true);
    page.addEventListener('dblclick', on_dblclick, true);

    page.on('selectstart', on_selection);
    page.on('mousemove', on_hover);
    document.addEventListener('mousemove', on_pointer_move, true);
    document.addEventListener('mouseup', on_pointer_up, true);
    document.addEventListener('copy', on_copy);
    document.addEventListener('cut', on_cut);
    document.addEventListener('paste', on_paste);
    window.addEventListener('hashchange', handleLocationChange, true);
    window.addEventListener('popstate', handleLocationChange, true);
    window.addEventListener('webmcp:page-edit-locationchange', handleLocationChange, true);

    watchCommandKey();

    hotkeys(`${metaKey}+alt+c`, on_copy_styles);
    hotkeys(`${metaKey}+alt+v`, (e) => on_paste_styles());
    hotkeys('esc', on_esc);
    hotkeys(`${metaKey}+d`, on_duplicate);
    hotkeys('backspace,del,delete', on_delete_debug);
    hotkeys('alt+del,alt+backspace', on_clearstyles);
    hotkeys(`${metaKey}+e,${metaKey}+shift+e`, on_expand_selection);
    hotkeys(`${metaKey}+g,${metaKey}+shift+g`, on_group);
    hotkeys('tab,shift+tab,enter,shift+enter', on_keyboard_traversal);
    hotkeys(`${metaKey}+shift+enter`, on_select_children);
    hotkeys(undoHotkeys, on_undo);
    hotkeys(redoHotkeys, on_redo);
  };

  const unlisten = () => {
    document.removeEventListener('keydown', freezePageKeyboardInteraction, true);
    document.removeEventListener('keyup', freezePageKeyboardInteraction, true);
    page.removeEventListener('keydown', freezePageKeyboardInteraction, true);
    page.removeEventListener('keyup', freezePageKeyboardInteraction, true);
    document.removeEventListener('keydown', debugDocumentBubbleKeyboard, false);
    document.removeEventListener('keyup', debugDocumentBubbleKeyboard, false);

    page.removeEventListener('mousedown', on_pointer_down, true);
    page.removeEventListener('click', on_click, true);
    page.removeEventListener('dblclick', on_dblclick, true);

    page.off('selectstart', on_selection);
    page.off('mousemove', on_hover);
    document.removeEventListener('mousemove', on_pointer_move, true);
    document.removeEventListener('mouseup', on_pointer_up, true);

    document.removeEventListener('copy', on_copy);
    document.removeEventListener('cut', on_cut);
    document.removeEventListener('paste', on_paste);
    window.removeEventListener('hashchange', handleLocationChange, true);
    window.removeEventListener('popstate', handleLocationChange, true);
    window.removeEventListener('webmcp:page-edit-locationchange', handleLocationChange, true);
    cleanupLocationChangeEventsPatched();

    hotkeys.unbind(
      `esc,${metaKey}+d,backspace,del,delete,alt+del,alt+backspace,${metaKey}+e,${metaKey}+shift+e,${metaKey}+g,${metaKey}+shift+g,tab,shift+tab,enter,shift+enter`
    );
    hotkeys.unbind(undoHotkeys);
    hotkeys.unbind(redoHotkeys);
  };

  const on_click = (e) => {
    if (isSelectionAnalysisGuidanceActive()) {
      clearMeasurements();
      clearHover();
      return;
    }

    if (isPageEditUiTarget(e.target)) {
      return;
    }

    if (shouldBlockEditableNavigation(e.target)) {
      e.preventDefault();
      e.stopPropagation();
      return;
    }

    if (isEditableKeyboardTarget(e.target)) {
      return;
    }

    if (marqueeState.suppressedClick) {
      const shouldSuppress = marqueeState.suppressedClick.button === e.button;

      marqueeState.suppressedClick = null;

      if (shouldSuppress) {
        e.preventDefault();
        e.stopPropagation();
        return;
      }
    }

    const $target = resolveInteractionTarget(e);
    if (!$target) return;

    if (isOffBounds($target) && !selected.filter((el) => el == $target).length) return;

    e.preventDefault();
    if (!e.altKey) e.stopPropagation();

    if (!e.shiftKey) {
      unselect_all({ silent: true });
      clearMeasurements();
    }

    if (e.shiftKey && $target.hasAttribute('data-selected'))
      unselect($target.getAttribute('data-label-id'));
    else select($target);
  };

  const unselect = (id) => {
    [...labels, ...handles]
      .filter((node) => node.getAttribute('data-label-id') === id)
      .forEach((node) => node.remove());

    selected
      .filter((node) => node.getAttribute('data-label-id') === id)
      .forEach((node) =>
        $(node).attr({
          'data-selected': null,
          'data-selected-hide': null,
          'data-label-id': null,
          'data-pseudo-select': null,
          'data-measuring': null,
        })
      );

    selected = selected.filter((node) => node.getAttribute('data-label-id') !== id);

    tellWatchers();
  };

  const on_dblclick = (e) => {
    if (isSelectionAnalysisGuidanceActive()) {
      clearMeasurements();
      clearHover();
      return;
    }

    e.preventDefault();
    e.stopPropagation();
    if (isOffBounds(e.target)) return;
    if (!canEditCurrentPage()) return;
    visbug.toolSelected('text');
  };

  const watchCommandKey = (e) => {
    let did_hide = false;

    document.onkeydown = function (e) {
      if (hotkeys.ctrl && selected.length) {
        $('visbug-handles, visbug-selected, visbug-label, visbug-hover, visbug-grip').forEach(
          (el) => (el.style.display = 'none')
        );

        did_hide = true;
      }
    };

    document.onkeyup = function (e) {
      if (did_hide) {
        $('visbug-handles, visbug-selected, visbug-label, visbug-hover, visbug-grip').forEach(
          (el) => (el.style.display = null)
        );

        did_hide = false;
      }
    };
  };

  const on_esc = (_) => (marqueeState.active ? cleanupMarquee() : unselect_all());

  const cleanupTransientUi = () => {
    cleanupMarquee({ suppressedClick: null });
    clearMeasurements();
    clearHover();
    removeAllMetaTips();
    removeAllAccessibilityTips();
  };

  const replayHistory = (methodName) => {
    cleanupTransientUi();
    history[methodName]();
    cleanupTransientUi();
  };

  const on_undo = (e) => {
    e.preventDefault();
    e.stopPropagation();
    replayHistory('undo');
  };

  const on_redo = (e) => {
    e.preventDefault();
    e.stopPropagation();
    replayHistory('redo');
  };

  const applyInlineStyleText = (el, styleText) => {
    if (!el) return;

    if (styleText == null) el.removeAttribute('style');
    else el.setAttribute('style', styleText);
  };

  const recordStyleMutation = ({ elements = [], label = 'style', mutate }) => {
    if (!canEditCurrentPage()) return;

    const targets = getConnectedUniqueElements(elements);
    if (!targets.length || typeof mutate !== 'function') return;

    const beforeStyles = targets.map((el) => el.getAttribute('style'));

    mutate();

    const afterStyles = targets.map((el) => el.getAttribute('style'));
    const didChange = afterStyles.some((style, index) => style !== beforeStyles[index]);

    if (!didChange) return;

    history.record({
      label,
      elements: targets,
      beforeStyles,
      afterStyles,
      undo() {
        targets.forEach((el, index) => applyInlineStyleText(el, beforeStyles[index]));
        tellWatchers();
      },
      redo() {
        targets.forEach((el, index) => applyInlineStyleText(el, afterStyles[index]));
        tellWatchers();
      },
    });
  };

  const createSuppressedClick = (e) => ({
    button: e.button,
  });

  const cleanupMarquee = ({ suppressedClick = marqueeState.suppressedClick } = {}) => {
    marqueeState.overlay?.remove();
    marqueeState = {
      active: false,
      dragging: false,
      suppressedClick,
      start: null,
      current: null,
      selectedSnapshot: [],
      overlay: null,
    };
  };

  const getConnectedUniqueElements = (elements) =>
    Array.from(new Set(elements.filter((node) => node && node.isConnected)));

  const rebuildSelection = (elements) => {
    debugLog('selection:rebuild:start', {
      nextSelection: formatDebugSelection(elements),
    });
    unselect_all({ silent: true });

    getConnectedUniqueElements(elements)
      .slice()
      .reverse()
      .forEach((element) => select(element, { silent: true }));

    debugLog('selection:rebuild:end', {
      selection: formatDebugSelection(selected),
    });
    tellWatchers();
  };

  const createStructureAnchor = (node) => ({
    parent: node.parentNode,
    previous: node.previousSibling,
    next: node.nextSibling,
  });

  const tableStructureTags = new Set([
    'caption',
    'col',
    'colgroup',
    'tbody',
    'td',
    'tfoot',
    'th',
    'thead',
    'tr',
  ]);

  const isTableStructureElement = (node) =>
    node instanceof Element && tableStructureTags.has(node.tagName.toLowerCase());

  const resolveStructuredPasteTargets = (targets, html) => {
    if (!targets.length) return targets;

    const primaryTarget = targets[0];
    const parsedNodes = htmlStringToNodes(html, primaryTarget);
    const parsedNode = parsedNodes[0] || null;

    if (
      targets.length > 1 &&
      parsedNodes.length === 1 &&
      isTableStructureElement(parsedNode) &&
      targets.every(isTableStructureElement)
    ) {
      return [primaryTarget];
    }

    return targets;
  };

  const restoreNodeAtAnchor = ({ node, anchor }) => {
    if (!anchor.parent) return;

    if (anchor.next?.parentNode === anchor.parent) {
      anchor.parent.insertBefore(node, anchor.next);
      return;
    }

    if (anchor.previous?.parentNode === anchor.parent) {
      anchor.parent.insertBefore(node, anchor.previous.nextSibling);
      return;
    }

    anchor.parent.appendChild(node);
  };

  const getDeletionSelectionTargets = (nodes) =>
    getConnectedUniqueElements(
      nodes.map((el) => canMoveRight(el) || canMoveLeft(el) || el.parentNode)
    ).filter((target) => !nodes.includes(target));

  const sortNodesInDocumentOrder = (nodes) =>
    nodes
      .filter((node) => node?.parentNode)
      .slice()
      .sort((left, right) =>
        left === right ? 0 : left.compareDocumentPosition(right) & 0x02 ? 1 : -1
      );

  const createStructuredRemovalCommand = (nodes) => {
    const orderedNodes = sortNodesInDocumentOrder(nodes);

    if (!orderedNodes.length) return null;

    const entries = orderedNodes.map((node) => ({
      node,
      anchor: createStructureAnchor(node),
    }));

    return {
      undo() {
        debugLog('delete:undo', {
          nodes: formatDebugSelection(orderedNodes),
        });
        entries.forEach(restoreNodeAtAnchor);
        rebuildSelection(orderedNodes);
      },
      redo() {
        const selectionTargets = getDeletionSelectionTargets(orderedNodes);
        debugLog('delete:redo', {
          removing: formatDebugSelection(orderedNodes),
          fallbackSelection: formatDebugSelection(selectionTargets),
        });
        unselect_all({ silent: true });
        orderedNodes.forEach((node) => node.remove());
        rebuildSelection(selectionTargets);
      },
    };
  };

  const applyStructuredRemoval = (nodes) => {
    if (!canEditCurrentPage()) return;

    debugLog('delete:apply', {
      requested: formatDebugSelection(nodes),
      connected: formatDebugSelection(getConnectedUniqueElements(nodes)),
    });
    const command = createStructuredRemovalCommand(nodes);
    if (!command) {
      debugLog('delete:skip-empty');
      return;
    }

    command.redo();
    history.record(command);
  };

  const createStructuredGroupCommand = (nodes) => {
    const orderedNodes = sortNodesInDocumentOrder(nodes);
    const parent = nodes[0]?.parentNode;
    if (!orderedNodes.length || !parent) return null;

    const container = document.createElement('div');
    const entries = orderedNodes.map((node) => ({
      node,
      anchor: createStructureAnchor(node),
    }));

    return {
      undo() {
        unselect_all({ silent: true });
        entries.forEach(restoreNodeAtAnchor);
        container.remove();
        rebuildSelection(orderedNodes);
      },
      redo() {
        unselect_all({ silent: true });
        orderedNodes.forEach((node) => container.appendChild(node));
        parent.prepend(container);
        rebuildSelection([container]);
      },
    };
  };

  const applyStructuredGroup = (nodes) => {
    if (!canEditCurrentPage()) return;

    const command = createStructuredGroupCommand(nodes);
    if (!command) return;

    command.redo();
    history.record(command);
  };

  const createStructuredUngroupCommand = (nodes) => {
    const containers = nodes
      .filter((node) => node?.parentNode)
      .slice()
      .reverse()
      .map((container) => ({
        container,
        anchor: createStructureAnchor(container),
        childEntries: Array.from(container.childNodes).map((node) => ({
          node,
          anchor: createStructureAnchor(node),
        })),
        selectionTargets: Array.from(container.children),
      }));

    if (!containers.length) return null;

    return {
      undo() {
        unselect_all({ silent: true });
        containers.forEach(({ container, anchor, childEntries }) => {
          restoreNodeAtAnchor({ node: container, anchor });
          childEntries.forEach(restoreNodeAtAnchor);
        });
        rebuildSelection(containers.map(({ container }) => container));
      },
      redo() {
        const selectionTargets = containers.flatMap(({ selectionTargets }) => selectionTargets);

        unselect_all({ silent: true });
        containers.forEach(({ container }) => {
          const parent = container.parentNode;
          if (!parent) return;

          while (container.childNodes.length > 0) {
            const node = container.childNodes[container.childNodes.length - 1];
            parent.prepend(node);
          }

          container.remove();
        });
        rebuildSelection(selectionTargets);
      },
    };
  };

  const applyStructuredUngroup = (nodes) => {
    if (!canEditCurrentPage()) return;

    const command = createStructuredUngroupCommand(nodes);
    if (!command) return;

    command.redo();
    history.record(command);
  };

  const applyStructuredPaste = (targets, html) => {
    if (!canEditCurrentPage()) return;
    if (!targets.length) return;

    const clipboardNodes = htmlStringToNodes(html, targets[0]).filter(Boolean);
    if (!clipboardNodes.length) return;

    const orderedTargets = sortNodesInDocumentOrder(targets);
    const shouldPairNodesByIndex =
      clipboardNodes.length > 1 && clipboardNodes.length === orderedTargets.length;

    const pastedEntries = orderedTargets.reduce((entries, target, index) => {
      const parent = target?.parentNode;
      if (!parent) return entries;

      const sourceNode = shouldPairNodesByIndex ? clipboardNodes[index] : clipboardNodes[0];
      const node = sourceNode?.cloneNode(true);
      if (!node) return entries;

      const anchor = createStructureAnchor(target);
      parent.insertBefore(node, anchor.next);
      entries.push({ node, anchor });
      return entries;
    }, []);

    if (!pastedEntries.length) return;

    history.record({
      undo() {
        pastedEntries.forEach(({ node }) => node.remove());
        rebuildSelection(targets);
      },
      redo() {
        pastedEntries.forEach(restoreNodeAtAnchor);
        rebuildSelection(targets);
      },
    });
  };

  const on_pointer_down = (e) => {
    if (isSelectionAnalysisGuidanceActive()) {
      clearMeasurements();
      clearHover();
      marqueeState.suppressedClick = null;
      return;
    }

    if (isEditableKeyboardTarget(e.target)) {
      return;
    }

    marqueeState.suppressedClick = null;

    const $target = resolveInteractionTarget(e);
    if (isPageEditUiTarget($target)) {
      return;
    }
    const isSelectedTarget =
      $target instanceof Element && $target.hasAttribute('data-selected');
    const isMoveToolDragTarget =
      visbug.activeTool === 'move' &&
      $target instanceof Element &&
      ($target.hasAttribute('draggable') || $target.closest('[draggable="true"]'));

    debugLog('pointer:down', {
      target: formatDebugNode($target),
      isSelectedTarget,
      isMoveToolDragTarget,
      ctrlKey: e.ctrlKey,
      metaKey: e.metaKey,
      shiftKey: e.shiftKey,
      button: e.button,
      selection: formatDebugSelection(selected),
    });

    if (!isPageEditUiTarget($target) && !isMoveToolDragTarget) {
      e.preventDefault();

      // Allow page-edit feature listeners on the selected element itself
      // (for example drag-based position edits) to receive mousedown.
      if (!isSelectedTarget) e.stopPropagation();
    }

    if (
      !shouldStartIntersectionMarquee({
        button: e.button,
        primaryModifierKey: isPrimaryModifierPressed(e),
        shiftKey: e.shiftKey,
        selectedCount: selected.length,
        isOffBoundsTarget: !$target || !!isOffBounds($target),
      })
    )
      return;

    e.preventDefault();
    e.stopPropagation();

    cleanupMarquee();
    marqueeState = {
      ...marqueeState,
      active: true,
      dragging: false,
      start: { x: e.clientX, y: e.clientY },
      current: { x: e.clientX, y: e.clientY },
      selectedSnapshot: [...selected],
    };

    debugLog('marquee:start', {
      start: marqueeState.start,
      selectedSnapshot: formatDebugSelection(marqueeState.selectedSnapshot),
    });
  };

  const on_pointer_move = (e) => {
    if (!marqueeState.active) return;

    if (!isPrimaryModifierPressed(e) || !e.shiftKey) {
      e.preventDefault();
      e.stopPropagation();
      cleanupMarquee({
        suppressedClick: marqueeState.dragging ? createSuppressedClick(e) : null,
      });
      return;
    }

    marqueeState.current = { x: e.clientX, y: e.clientY };

    if (!marqueeState.dragging && !didMovePastThreshold(marqueeState.start, marqueeState.current))
      return;

    e.preventDefault();
    e.stopPropagation();

    marqueeState.dragging = true;
    clearMeasurements();
    clearHover();

    const rect = buildMarqueeRect(marqueeState.start, marqueeState.current);

    if (!marqueeState.overlay) {
      marqueeState.overlay = document.createElement('visbug-marquee');
      document.body.appendChild(marqueeState.overlay);
    }

    marqueeState.overlay.position = rect;
  };

  const on_pointer_up = (e) => {
    if (!marqueeState.active) return;

    e.preventDefault();
    e.stopPropagation();

    const didDrag =
      marqueeState.dragging &&
      marqueeState.start &&
      marqueeState.current &&
      didMovePastThreshold(marqueeState.start, marqueeState.current);

    const shouldCancel = !isPrimaryModifierPressed(e) || !e.shiftKey;
    const survivors =
      !didDrag || shouldCancel
        ? marqueeState.selectedSnapshot
        : filterIntersectingElements(
            marqueeState.selectedSnapshot,
            buildMarqueeRect(marqueeState.start, marqueeState.current)
          );

    debugLog('marquee:end', {
      didDrag,
      shouldCancel,
      selectionBefore: formatDebugSelection(selected),
      selectedSnapshot: formatDebugSelection(marqueeState.selectedSnapshot),
      survivors: formatDebugSelection(survivors),
      ctrlKey: e.ctrlKey,
      metaKey: e.metaKey,
      shiftKey: e.shiftKey,
    });

    cleanupMarquee({
      suppressedClick: didDrag ? createSuppressedClick(e) : null,
    });

    if (!didDrag || shouldCancel) return;

    rebuildSelection(survivors);
  };

  const on_duplicate = (e) => {
    if (!canEditCurrentPage()) {
      return blockEditMutation(e, 'duplicate');
    }

    const root_node = selected[0];
    if (!root_node) return;

    const deep_clone = root_node.cloneNode(true);
    deep_clone.removeAttribute('data-selected');
    root_node.parentNode.insertBefore(deep_clone, root_node.nextSibling);
    e.preventDefault();
  };

  const on_delete = (e) => {
    if (!canEditCurrentPage()) {
      return blockEditMutation(e, 'delete');
    }

    return selected.length && applyStructuredRemoval([...selected]);
  };
  const on_delete_debug = (e) => {
    debugLog('delete:hotkey', {
      key: e.key,
      code: e.code,
      selection: formatDebugSelection(selected),
      selectionCount: selected.length,
    });

    return on_delete(e);
  };

  const on_clearstyles = (e) => {
    if (!canEditCurrentPage()) {
      return blockEditMutation(e, 'clear-styles');
    }

    return selected.forEach((el) => el.attr('style', null));
  };

  const on_copy = async (e) => {
    if (!canEditCurrentPage()) {
      return blockEditMutation(e, 'copy-structure');
    }

    // if user has selected text, dont try to copy an element
    if (window.getSelection().toString().length) return;

    if (selected[0] && nodeClipboard !== selected[0]) {
      e.preventDefault();
      const orderedSelection = sortNodesInDocumentOrder(selected);
      const copiedHtml = orderedSelection
        .map((node) => {
          const clonedNode = node.cloneNode(true);
          clonedNode.removeAttribute?.('data-selected');
          return clonedNode.outerHTML;
        })
        .join('');

      copyBackup = copiedHtml;
      e.clipboardData.setData('text/html', copyBackup);

      const { state } = await navigator.permissions.query({ name: 'clipboard-write' });

      if (state === 'granted') await navigator.clipboard.writeText(copyBackup);
    }
  };

  const on_cut = (e) => {
    if (!canEditCurrentPage()) {
      return blockEditMutation(e, 'cut-structure');
    }

    if (selected[0] && nodeClipboard !== selected[0]) {
      let $node = selected[0].cloneNode(true);
      $node.removeAttribute('data-selected');
      copyBackup = $node.outerHTML;
      e.clipboardData.setData('text/html', copyBackup);
      applyStructuredRemoval([selected[0]]);
    }
  };

  const on_paste = async (e, index = 0) => {
    if (!canEditCurrentPage()) {
      return blockEditMutation(e, 'paste-structure');
    }

    const clipData = e.clipboardData.getData('text/html');
    const globalClipboard = await navigator.clipboard.readText();
    const potentialHTML = clipData || globalClipboard || copyBackup;

    if (selected.length && potentialHTML) {
      e.preventDefault();
      applyStructuredPaste(resolveStructuredPasteTargets([...selected], potentialHTML), potentialHTML);
    }
  };

  const on_copy_styles = async (e) => {
    if (!canEditCurrentPage()) {
      return blockEditMutation(e, 'copy-styles');
    }

    e.preventDefault();

    copiedStyles = selected.map((el) => getStyles(el));

    try {
      const colormode = visbug.colorMode;

      const styles = copiedStyles[0]
        .map(({ prop, value }) => {
          if (
            prop.includes('color') ||
            prop.includes('background-color') ||
            prop.includes('border-color') ||
            prop.includes('Color') ||
            prop.includes('fill') ||
            prop.includes('stroke')
          )
            value = new TinyColor(value)[colormode]();

          if (prop.includes('boxShadow')) {
            const [, color, x, y, blur, spread] = getShadowValues(value);
            value = `${new TinyColor(color)[colormode]()} ${x} ${y} ${blur} ${spread}`;
          }

          if (prop.includes('textShadow')) {
            const [, color, x, y, blur] = getTextShadowValues(value);
            value = `${new TinyColor(color)[colormode]()} ${x} ${y} ${blur}`;
          }
          return { prop, value };
        })
        .reduce((message, item) => [...message, `${camelToDash(item.prop)}: ${item.value};`], [])
        .join('\n');

      const { state } = await navigator.permissions.query({ name: 'clipboard-write' });

      if (styles && state === 'granted') {
        await navigator.clipboard.writeText(styles);
        console.info('copied!');
      }
    } catch (e) {
      console.warn(e);
    }
  };

  const on_paste_styles = async (e, index = 0) => {
    if (!canEditCurrentPage()) {
      return blockEditMutation(e, 'paste-styles');
    }

    if (copiedStyles) {
      selected.forEach((el) => {
        copiedStyles[index].map(({ prop, value }) => (el.style[prop] = value));

        index >= copiedStyles.length - 1 ? (index = 0) : index++;
      });
    } else {
      const potentialStyles = await navigator.clipboard.readText();

      if (selected.length && potentialStyles)
        selected.forEach((el) => (el.style = potentialStyles));
    }
  };

  const on_expand_selection = (e, { key }) => {
    if (!canEditCurrentPage()) {
      return blockEditMutation(e, 'expand-selection');
    }

    e.preventDefault();

    const [root] = selected;
    if (!root) return;

    const query = combineNodeNameAndClass(root);

    if (isSelectorValid(query))
      expandSelection({
        query,
        all: key.includes('shift'),
      });
  };

  const on_group = (e, { key }) => {
    if (!canEditCurrentPage()) {
      return blockEditMutation(e, 'group');
    }

    e.preventDefault();

    if (key.split('+').includes('shift')) applyStructuredUngroup([...selected]);
    else applyStructuredGroup([...selected]);
  };

  const on_selection = (e) => {
    if (isEditableSelectionTarget(e.target)) {
      return;
    }

    !isOffBounds(e.target) &&
      selected.length &&
      selected[0].textContent != e.target.textContent &&
      e.preventDefault();
  };

  const on_keyboard_traversal = (e, { key }) => {
    if (!selected.length) return;

    e.preventDefault();
    e.stopPropagation();

    const targets = selected.reduce((flat_n_unique, node) => {
      const element_to_left = canMoveLeft(node);
      const element_to_right = canMoveRight(node);
      const has_parent_element = findNearestParentElement(node);
      const has_child_elements = findNearestChildElement(node);

      if (key.includes('shift')) {
        if (key.includes('tab') && element_to_left) flat_n_unique.add(element_to_left);
        else if (key.includes('enter') && has_parent_element) flat_n_unique.add(has_parent_element);
        else flat_n_unique.add(node);
      } else {
        if (key.includes('tab') && element_to_right) flat_n_unique.add(element_to_right);
        else if (key.includes('enter') && has_child_elements) flat_n_unique.add(has_child_elements);
        else flat_n_unique.add(node);
      }

      return flat_n_unique;
    }, new Set());

    if (targets.size) {
      unselect_all({ silent: true });
      targets.forEach((node) => {
        select(node);
        show_tip(node);
      });
    }
  };

  const show_tip = (el) => {
    const active_tool = visbug.activeTool;
    let tipFactory;

    if (active_tool === 'accessibility') {
      removeAllAccessibilityTips();
      tipFactory = showAccessibilityTip;
    } else if (active_tool === 'inspector') {
      removeAllMetaTips();
      tipFactory = showMetaTip;
    }

    if (!tipFactory) return;

    const { top, left } = el.getBoundingClientRect();
    const { pageYOffset, pageXOffset } = window;

    tipFactory(el, {
      clientY: top,
      clientX: left,
      pageY: pageYOffset + top - 10,
      pageX: pageXOffset + left + 20,
    });
  };

  const on_hover = (e) => {
    clearPseudoSelectionPreview();

    if (isSelectionAnalysisGuidanceActive()) {
      clearMeasurements();
      return clearHover();
    }

    if (marqueeState.active) return;

    const $target = deepElementFromPoint(e.clientX, e.clientY);
    const tool = visbug.activeTool;
    const policy = getPresentationPolicy();
    const isWithinSelectedTree = selected.some(
      (node) => node === $target || node.contains?.($target)
    );

    if (
      isOffBounds($target) ||
      $target.hasAttribute('data-selected') ||
      isWithinSelectedTree ||
      $target.hasAttribute('draggable')
    ) {
      clearMeasurements();
      return clearHover();
    }

    overlayHoverUI({
      el: $target,
      no_label: !policy.showHoverLabel,
    });

    if (policy.showMeasurement && selected.length >= 1 && !selected.includes($target)) {
      $target.setAttribute('data-measuring', true);
      const [$anchor] = selected;
      createMeasurements({ $anchor, $target });
    } else if (tool === 'margin' && !hover_state.element.$shadow.querySelector('visbug-boxmodel')) {
      hover_state.element.$shadow.appendChild(createMarginVisual(hover_state.target, true));
    } else if (
      tool === 'padding' &&
      !hover_state.element.$shadow.querySelector('visbug-boxmodel')
    ) {
      hover_state.element.$shadow.appendChild(createPaddingVisual(hover_state.target, true));
    } else if ($target.hasAttribute('data-measuring') || selected.includes($target)) {
      clearMeasurements();
    }
  };

  const buildSelectionLabelTemplate = (element, policy) => {
    if (!policy.showSelectionLabel) return '';

    const shouldShowClassSelector = isEditableWorkbenchMode(getWorkbenchMode());
    const classSelector = shouldShowClassSelector ? createClassname(element) : '';

    if (!policy.showSelectionMetadata) {
      return `
        <a node>${element.nodeName.toLowerCase()}</a>
        ${classSelector ? `<a>${classSelector}</a>` : ''}
      `;
    }

    return `
      <a node>${element.nodeName.toLowerCase()}</a>
      ${classSelector ? `<a>${classSelector}</a>` : element.id ? `<a>#${element.id}</a>` : ''}
    `;
  };

  const buildMultiSelectionLabelTemplate = () => `<a node>已选 ${selected.length} 项</a>`;

  const getVisibleMultiSelectionLabelAnchor = () => {
    const viewportWidth = window.innerWidth || document.documentElement?.clientWidth || 0;
    const viewportHeight = window.innerHeight || document.documentElement?.clientHeight || 0;

    const visibleCandidates = selected
      .map((element) => ({
        element,
        rect: element.getBoundingClientRect(),
      }))
      .filter(
        ({ rect }) =>
          rect.bottom > 0 &&
          rect.right > 0 &&
          rect.top < viewportHeight &&
          rect.left < viewportWidth,
      )
      .sort((left, right) => {
        if (left.rect.top !== right.rect.top) {
          return left.rect.top - right.rect.top;
        }

        return left.rect.left - right.rect.left;
      });

    return visibleCandidates[0]?.element || selected[0] || null;
  };

  const renderSelectionLabels = (policy) => {
    Array.from($('visbug-label')).forEach((label) => label.remove());
    labels = [];

    if (!policy.showSelectionLabel || !selected.length) {
      return;
    }

    const anchorElement =
      selected.length > 1 ? getVisibleMultiSelectionLabelAnchor() : selected[0];
    const anchorLabelId = anchorElement?.getAttribute('data-label-id');

    if (!anchorElement || !anchorLabelId) {
      return;
    }

    overlayMetaUI({
      el: anchorElement,
      id: anchorLabelId,
      no_label: false,
      showHandle: false,
      showSelectedOutline: false,
      showActionBar: policy.showActionBar,
      template:
        selected.length > 1
          ? buildMultiSelectionLabelTemplate()
          : buildSelectionLabelTemplate(anchorElement, policy),
      multiSelectionLabel: selected.length > 1,
    });
  };

  const select = (el, { silent = false } = {}) => {
    if (!shouldAllowSelectionForActiveTool(el)) {
      return;
    }

    const id = String(nextSelectionId++);
    const policy = getPresentationPolicy();

    el.setAttribute('data-selected', true);
    el.setAttribute('data-label-id', id);

    clearHover();

    selected.unshift(el);

    overlayMetaUI({
      el,
      id,
      no_label: true,
      showHandle: policy.showHandles,
      showSelectedOutline: policy.showSelectedOutline,
      showActionBar: policy.showActionBar,
      template: buildSelectionLabelTemplate(el, policy),
    });

    renderSelectionLabels(policy);
    syncSelectionAnnotationUi();
    !silent && tellWatchers();
  };

  const selection = () => selected;

  const getPrimarySelectedElement = () => selected[0] || null;

  const getSelectableActionParent = (element) => {
    let parent = findSelectableParentElement(element);

    while (parent && isPageEditUiElement(parent)) {
      parent = findSelectableParentElement(parent);
    }

    return parent;
  };

  const getSelectionActionElement = (detail) => {
    const nodeLabelId = detail?.nodeLabelId;
    if (!nodeLabelId) return null;

    const selectedMatch = selected.find(
      (candidate) => candidate.getAttribute('data-label-id') === nodeLabelId
    );

    if (selectedMatch) return selectedMatch;

    const candidates = $(`[data-label-id="${nodeLabelId}"]`).filter(
      (candidate) => !isPageEditUiElement(candidate)
    );

    return candidates[0] || null;
  };

  const getSelectionMessageTargetOrigin = () => {
    const origin = window.location.origin;
    return origin &&
      origin !== 'null' &&
      origin !== 'file://' &&
      window.location.protocol !== 'file:'
      ? origin
      : '*';
  };

  const notifyLocalSnapshotBridgeNotReady = () => {
    if (window.location.protocol !== 'file:' || getWorkbenchMode() !== 'local-snapshot') {
      return false;
    }

    window.alert('当前 file:// 页面工作台连接未完成，请先刷新页面后再操作。');
    return true;
  };

  const unselect_all = ({ silent = false } = {}) => {
    selected.forEach((el) =>
      $(el).attr({
        'data-selected': null,
        'data-selected-hide': null,
        'data-label-id': null,
        'data-pseudo-select': null,
      })
    );

    $('[data-pseudo-select]').forEach((hover) => hover.removeAttribute('data-pseudo-select'));

    Array.from([
      ...$('visbug-handles'),
      ...$('visbug-selected'),
      ...$('visbug-label'),
      ...$('visbug-hover'),
      ...$('visbug-distance'),
    ]).forEach((el) => el.remove());

    labels = [];
    handles = [];
    selected = [];

    syncSelectionAnnotationUi();
    !silent && tellWatchers();
  };

  const delete_all = () => {
    const selected_after_delete = selected.map((el) => {
      if (canMoveRight(el)) return canMoveRight(el);
      else if (canMoveLeft(el)) return canMoveLeft(el);
      else if (el.parentNode) return el.parentNode;
    });

    Array.from([...selected, ...labels, ...handles]).forEach((el) => el.remove());

    labels = [];
    handles = [];
    selected = [];

    selected_after_delete.forEach((el) => select(el));
  };

  const expandSelection = ({ query, all = false }) => {
    if (all) {
      const unselecteds = $(query + ':not([data-selected])');
      unselecteds.forEach(select);
    } else {
      const potentials = $(query);
      if (!potentials) return;

      const [anchor] = selected;
      const root_node_index = potentials.reduce(
        (index, node, i) => (node == anchor ? (index = i) : index),
        null
      );

      if (root_node_index !== null) {
        if (!potentials[root_node_index + 1]) {
          const potential = potentials.filter((el) => !el.attr('data-selected'))[0];
          if (potential) select(potential);
        } else {
          select(potentials[root_node_index + 1]);
        }
      }
    }
  };

  const combineNodeNameAndClass = (node) =>
    `${node.nodeName.toLowerCase()}${createClassname(node)}`;

  const overlayHoverUI = ({ el, no_hover = false, no_label = true }) => {
    if (hover_state.target === el) return;
    hover_state.target = el;
    const shouldShowClassSelector = isEditableWorkbenchMode(getWorkbenchMode());
    const classSelector = shouldShowClassSelector ? createClassname(el) : '';

    hover_state.element = no_hover ? null : createHover(el);

    hover_state.label = no_label
      ? null
      : createHoverLabel(
          el,
          `
          <a node>${el.nodeName.toLowerCase()}</a>
          ${classSelector ? `<a>${classSelector}</a>` : el.id ? `<a>#${el.id}</a>` : ''}
        `
        );
  };

  const clearHover = () => {
    if (!hover_state.target) return;

    hover_state.element && hover_state.element.remove();
    hover_state.label && hover_state.label.remove();

    hover_state.target = null;
    hover_state.element = null;
    hover_state.label = null;
  };

  const clearPseudoSelectionPreview = () => {
    $('[data-pseudo-select]').forEach((element) => element.removeAttribute('data-pseudo-select'));
  };

  const overlayMetaUI = ({
    el,
    id,
    no_label = true,
    showHandle = true,
    showSelectedOutline = false,
    showActionBar = true,
    template = '',
    multiSelectionLabel = false,
  }) => {
    let handle = showHandle
      ? createHandle({ el, id })
      : showSelectedOutline
        ? createSelectedOutline({ el, id })
        : null;
    let label = no_label
      ? null
      : createLabel({ el, id, template, showActionBar, multiSelectionLabel });

    let observer = createObserver(el, { handle, label });
    let parentObserver = createObserver(el, { handle, label });

    observer.observe(el, { attributes: true });
    parentObserver.observe(el.parentNode, { childList: true, subtree: true });

    if (label) {
      $(label).on('DOMNodeRemoved', (_) => {
        observer.disconnect();
        parentObserver.disconnect();
      });
      return;
    }

    const teardown = () => {
      observer.disconnect();
      parentObserver.disconnect();
    };

    if (handle) {
      $(handle).on('DOMNodeRemoved', teardown);
    }
  };

  const setLabel = (el, label) => (label.update = el.getBoundingClientRect());

  const createLabel = ({
    el,
    id,
    template,
    showActionBar = true,
    multiSelectionLabel = false,
  }) => {
    if (!labels[id]) {
      const label = document.createElement('visbug-label');

      if (!showActionBar) {
        label.setAttribute('data-readonly-label', 'true');
      } else {
        label.removeAttribute('data-readonly-label');
      }

      if (multiSelectionLabel) {
        label.setAttribute('data-multi-selection-label', 'true');
      } else {
        label.removeAttribute('data-multi-selection-label');
      }

      label.text = template;
      document.body.appendChild(label);
      label.position = {
        boundingRect: el.getBoundingClientRect(),
        node_label_id: id,
      };

      $(label).on('query', ({ detail }) => {
        if (!detail.text) return;
        const queryText = detail.text;

        debugLog('query:label', {
          queryText,
          activator: detail.activator,
          selectionBefore: formatDebugSelection(selected),
        });

        clearPseudoSelectionPreview();

        if (detail.activator === 'mouseleave') {
          debugLog('query:label:clear', {
            queryText,
            activator: detail.activator,
          });
          return;
        }

        queryPage(queryText + ':not([data-selected])', (el) =>
          detail.activator === 'mouseenter'
            ? el.setAttribute('data-pseudo-select', true)
            : select(el)
        );

        debugLog('query:label:done', {
          queryText,
          selectionAfter: formatDebugSelection(selected),
        });
      });

      $(label).on('selection-action', ({ detail }) => {
        const actionElement =
          getSelectionActionElement(detail) || getPrimarySelectedElement() || el;

        debugLog('selection-action:received', {
          action: detail?.action,
          nodeLabelId: detail?.nodeLabelId,
          actionElement: formatDebugNode(actionElement),
          currentSelection: formatDebugSelection(selected),
        });

        if (!actionElement) return;

        if (detail?.action === 'select-parent') {
          const parent = getSelectableActionParent(actionElement);
          debugLog('selection-action:select-parent', {
            actionElement: formatDebugNode(actionElement),
            parent: formatDebugNode(parent),
          });
          if (!parent) return;

          unselect_all({ silent: true });
          select(parent);
          return;
        }

        if (detail?.action === 'send-selection') {
          if (requiresSelectionBridgeNonce && !selectionBridgeNonce) {
            notifyLocalSnapshotBridgeNotReady();
            return;
          }

          const sendTargets =
            label.getAttribute('data-multi-selection-label') === 'true' ? [...selected] : [actionElement];

          sendTargets.forEach((target) => {
            const payload = describeSelectedElement(target, {
              pageUrl: window.location.href,
              documentHtml: document.documentElement?.outerHTML || '',
            });

            const messagePayload =
              typeof selectionBridgeNonce === 'string'
                ? {
                    ...payload,
                    nonce: selectionBridgeNonce,
                  }
                : payload;

            window.postMessage(
              {
                type: 'page_edit_selection_append',
                payload: messagePayload,
              },
              getSelectionMessageTargetOrigin()
            );
          });
          return;
        }

        if (detail?.action === 'capture-selection') {
          if (requiresSelectionBridgeNonce && !selectionBridgeNonce) {
            notifyLocalSnapshotBridgeNotReady();
            return;
          }

          const payload = {
            nonce: selectionBridgeNonce,
            target: buildPickedElementCaptureContext(actionElement),
          };

          window.postMessage(
            {
              type: 'page_edit_selection_capture',
              payload,
            },
            getSelectionMessageTargetOrigin()
          );
          return;
        }

        if (detail?.action === 'analyze-selection') {
          if (requiresSelectionBridgeNonce && !selectionBridgeNonce) {
            notifyLocalSnapshotBridgeNotReady();
            return;
          }

          const payload = {
            nonce: selectionBridgeNonce,
            target: buildPickedElementCaptureContext(actionElement),
          };

          window.postMessage(
            {
              type: 'page_edit_selection_analyze',
              payload,
            },
            getSelectionMessageTargetOrigin()
          );
          return;
        }

        if (detail?.action === 'annotate-selection') {
          if (!selectionBridgeNonce) {
            notifyLocalSnapshotBridgeNotReady();
            return;
          }

          void requestSelectionAnnotationContent(actionElement, {
            pageMode: getWorkbenchMode(),
          }).then((content) => {
            if (!content) {
              return;
            }

            upsertSelectionAnnotation(actionElement, content);
            window.postMessage(
              buildSelectionAnnotateMessage({
                nonce: selectionBridgeNonce,
                element: actionElement,
                content,
              }),
              getSelectionMessageTargetOrigin()
            );
          });
        }
      });

      $(label).on('mouseleave', (e) => {
        e.preventDefault();
        e.stopPropagation();
        clearPseudoSelectionPreview();
      });

      labels[labels.length] = label;

      return label;
    }
  };

  const createHandle = ({ el, id }) => {
    if (!handles[id]) {
      const handle = document.createElement('visbug-handles');

      handle.position = { el, node_label_id: id };

      document.body.appendChild(handle);

      handles[handles.length] = handle;
      return handle;
    }
  };

  const createSelectedOutline = ({ el, id }) => {
    if (!handles[id]) {
      const outline = document.createElement('visbug-selected');

      outline.position = { el, node_label_id: id };

      document.body.appendChild(outline);

      handles[handles.length] = outline;
      return outline;
    }
  };

  const createHover = (el) => {
    if (!el.hasAttribute('data-pseudo-select') && !el.hasAttribute('data-label-id')) {
      if (hover_state.element) hover_state.element.remove();

      hover_state.element = document.createElement('visbug-hover');
      document.body.appendChild(hover_state.element);
      hover_state.element.position = { el };

      return hover_state.element;
    }
  };

  const createHoverLabel = (el, text) => {
    if (!el.hasAttribute('data-pseudo-select') && !el.hasAttribute('data-label-id')) {
      if (hover_state.label) hover_state.label.remove();

      hover_state.label = document.createElement('visbug-label');
      document.body.appendChild(hover_state.label);

      hover_state.label.text = text;
      hover_state.label.position = {
        boundingRect: el.getBoundingClientRect(),
        node_label_id: 'hover',
      };

      hover_state.label.style.setProperty(`--label-bg`, `hsl(267, 100%, 58%)`);

      return hover_state.label;
    }
  };

  const createCorners = (el) => {
    if (!el.hasAttribute('data-pseudo-select') && !el.hasAttribute('data-label-id')) {
      if (hover_state.element) hover_state.element.remove();

      hover_state.element = document.createElement('visbug-corners');
      document.body.appendChild(hover_state.element);
      hover_state.element.position = { el };

      return hover_state.element;
    }
  };

  const setHandle = (el, handle) => {
    handle.position = {
      el,
      node_label_id: el.getAttribute('data-label-id'),
    };
  };

  const createObserver = (node, { label, handle }) =>
    new MutationObserver((list) => {
      label && setLabel(node, label);
      handle && setHandle(node, handle);
    });

  const onSelectedUpdate = (cb, immediateCallback = true) => {
    selectedCallbacks.push(cb);
    if (immediateCallback) cb(selected, { history });
  };

  const removeSelectedCallback = (cb) =>
    (selectedCallbacks = selectedCallbacks.filter((callback) => callback != cb));

  const tellWatchers = () => selectedCallbacks.forEach((cb) => cb(selected, { history }));

  const refreshSelectionUi = () => {
    if (!selected.length) return;
    rebuildSelection([...selected]);
    syncSelectionAnnotationUi();
  };

  const disconnect = () => {
    cleanupTransientUi();
    unselect_all();
    history.clear();
    unlisten();
  };

  const on_select_children = (e, { key }) => {
    const targets = selected
      .filter((node) => node.children.length)
      .reduce((flat, { children }) => [...flat, ...Array.from(children)], []);

    if (targets.length) {
      e.preventDefault();
      e.stopPropagation();

      unselect_all();
      targets.forEach((node) => select(node));
    }
  };

  watchImagesForUpload();
  listen();

  return {
    history,
    recordStyleMutation,
    select,
    setSelectionBridgeNonce,
    selection,
    unselect_all,
    onSelectedUpdate,
    removeSelectedCallback,
    refreshSelectionUi,
    disconnect,
  };
}
