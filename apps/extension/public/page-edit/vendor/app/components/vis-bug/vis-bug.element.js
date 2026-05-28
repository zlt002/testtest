import $          from '../../vendor-deps/blingblingjs.js'
import hotkeys    from '../../vendor-deps/hotkeys-js.js'

import {
  Handles, Label, Overlay, Gridlines, Corners,
  Metatip, Ally, Distance, BoxModel, Grip
} from '../index.js'

import {
  Selectable, Moveable, Padding, Margin, EditText, Font,
  Flex, Search, ColorPicker, BoxShadow, HueShift, MetaTip,
  Guides, Screenshot, Position, Accessibility, draggable
} from '../../features/index.js'

import { VisBugStyles, visbug_css, supportsAdoptedStyleSheets } from '../styles.store.js'
import { VisBugModel }            from './model.js'
import * as Icons                 from './vis-bug.icons.js'
import {
  bottomToolbarTools,
  getBottomToolbarTool,
} from './bottom-toolbar.tools.js'
import { getBottomToolbarAvailability } from './bottom-toolbar.capabilities.js'
import { provideSelectorEngine }  from '../../features/search.js'
import { metaKey }                from '../../utilities/index.js'
import { PluginRegistry }         from '../../plugins/_registry.js'
import { positionElement }        from '../../features/position.js'
import { padElement, padAllElementSides } from '../../features/padding.js'
import { pushElement, pushAllElementSides } from '../../features/margin.js'
import {
  changeFontSize,
  changeFontWeight,
  changeLeading,
  changeKerning,
  setFontSize,
  setFontWeight,
  setLineHeight,
  setLetterSpacing,
} from '../../features/font.js'
import {
  changeDirection,
} from '../../features/flex.js'
import { changeBoxShadow }        from '../../features/boxshadow.js'
import { changeHue }              from '../../features/hueshift.js'
import { moveElement }            from '../../features/move.js'
import { getCurrentPageMode, isLocalSnapshotMode } from '../../../../runtime/page-mode.js'
import {
  clearSelectionAnnotationUi,
  subscribeSelectionAnnotationState,
  toggleSelectionAnnotationMarkers,
} from '../../../../runtime/annotations.js'

const modemap = {
  'hex':  'toHexString',
  'hsla': 'toHslString',
  'rgba': 'toRgbString',
}
const selectionActionsToggleStorageKey = 'webmcp:page-edit-selection-actions-everywhere'
const hiddenToolbarTools = new Set(['accessibility', 'search'])
const toolbarSections = [
  {
    id: 'primary',
    label: '主工具',
    description: '高频操作，默认直接展示',
    collapsible: false,
  },
  {
    id: 'layout',
    label: '布局调整',
    description: '定位、间距与弹性布局',
    collapsible: true,
  },
  {
    id: 'style',
    label: '样式编辑',
    description: '颜色、阴影与字体样式',
    collapsible: true,
  },
]

const pageEditDebugEnabled = () => {
  try {
    return (
      globalThis.__WEBMCP_PAGE_EDIT_DEBUG__ === true ||
      window.localStorage?.getItem('webmcp:page-edit-debug') === '1'
    )
  } catch (_) {
    return globalThis.__WEBMCP_PAGE_EDIT_DEBUG__ === true
  }
}

const debugLog = (label, payload = {}) => {
  if (!pageEditDebugEnabled()) return
  console.log(`[page-edit][visbug] ${label}`, payload)
}

const runCleanupStep = (label, step) => {
  if (typeof step !== 'function') return

  try {
    step()
  } catch (error) {
    console.warn(`[page-edit][visbug] cleanup step failed: ${label}`, error)
  }
}

export default class VisBug extends HTMLElement {
  #selectionBridgeNonce = null

  constructor() {
    super()

    this.toolbar_model  = VisBugModel
    this._tutsBaseURL   = 'tuts' // can be set by content script
    this.$shadow        = this.attachShadow({mode: 'closed'})
    this.styles         = supportsAdoptedStyleSheets ? [VisBugStyles] : [visbug_css]
    this._selectionActionsEverywhere = this.readSelectionActionsPreference()
    this._annotationStateUnsubscribe = null
    this._bottomToolbarState = {
      activeSubtool: null,
    }
    this._handleDocumentPointerDown = null
    this._typographyPanelDraft = {
      values: {},
      advancedOpen: false,
    }
    this._spacingPanelDraft = {
      padding: { mode: null },
      margin: { mode: null },
    }
  }

  connectedCallback() {
    if (supportsAdoptedStyleSheets) this.$shadow.adoptedStyleSheets = this.styles

    if (!this.$shadow.innerHTML)
      this.setup()

    this.selectorEngine = Selectable(this)
    this.setSelectionBridgeNonce(this.#selectionBridgeNonce)
    this.colorPicker    = ColorPicker(this.$shadow, this.selectorEngine)
    this.bindLivePageAnnotationState()

    provideSelectorEngine(this.selectorEngine)

    if (this.isLocalSnapshotWorkbench()) {
      this.selectorEngine.onSelectedUpdate(() => {
        this.syncBottomToolbarSelectionState()
        this.refreshLocalSnapshotToolbar()
      })
    }

    if (!this.isLocalSnapshotWorkbench())
      this.toolSelected('selection')
  }

  disconnectedCallback() {
    runCleanupStep('deactivate_feature', () => this.deactivate_feature?.())
    runCleanupStep('cleanup', () => this.cleanup())
    runCleanupStep('annotation_unsubscribe', () => this._annotationStateUnsubscribe?.())
    this._annotationStateUnsubscribe = null
    runCleanupStep('annotation_ui', () => clearSelectionAnnotationUi())
    runCleanupStep('selector_disconnect', () => this.selectorEngine?.disconnect?.())
    runCleanupStep('hotkeys', () =>
      hotkeys.unbind(
        Object.keys(this.toolbar_model).reduce((events, key) =>
          events += ',' + key, '')))
    runCleanupStep('hotkeys_toggle', () => hotkeys.unbind(`${metaKey}+/`))
  }

  setup() {
    this.$shadow.innerHTML = this.render()
    this._colormode = modemap['hsla']
    this.bindToolbarActionButtons()
    this.bindBottomToolbarEvents()
    this.bindGlobalBottomToolbarEvents()

    this.enableSnapshotToolbarDragging()

    hotkeys(`${metaKey}+/,${metaKey}+.`, e =>
      this.$shadow.host.style.display =
        this.$shadow.host.style.display === 'none'
      ? 'block'
          : 'none')
  }

  bindToolbarActionButtons() {
    $('button[data-action="save-file"]', this.$shadow).on('click', e => {
      e.preventDefault()
      e.stopPropagation()
      this.saveCurrentFile()
    })

    $('button[data-action="toggle-selection-actions"]', this.$shadow).on('click', e => {
      e.preventDefault()
      e.stopPropagation()
      this.toggleSelectionActionsEverywhere()
    })

    $('button[data-action="capture-page"]', this.$shadow).on('click', e => {
      e.preventDefault()
      e.stopPropagation()
      this.captureCurrentPage()
    })

    $('button[data-action="toggle-annotation-markers"]', this.$shadow).on('click', e => {
      e.preventDefault()
      e.stopPropagation()
      this.toggleAnnotationMarkers()
    })
  }

  bindBottomToolbarEvents() {
    if (!this.isLocalSnapshotWorkbench()) return

    $('button[data-bottom-tool]', this.$shadow).on('click', e => {
      e.preventDefault()
      e.stopPropagation()
      this.activateBottomToolbarTool(e.currentTarget.dataset.bottomTool)
    })

    $('button[data-bottom-action]', this.$shadow).on('click', e => {
      e.preventDefault()
      e.stopPropagation()
      this.runBottomToolbarAction(
        e.currentTarget.dataset.toolId,
        e.currentTarget.dataset.bottomAction,
      )
    })

    $('button[data-bottom-color-target]', this.$shadow).on('click', e => {
      e.preventDefault()
      e.stopPropagation()
      this.colorPicker?.setActive?.(e.currentTarget.dataset.bottomColorTarget)
      this.refreshLocalSnapshotToolbar()
    })

    this.$shadow
      .querySelectorAll('#background input[type="color"]')
      .forEach(input => {
        input.addEventListener('click', event => {
          event.stopPropagation()
          this.colorPicker?.setActive?.('background')
        })

        input.addEventListener('input', event => {
          event.stopPropagation()
          this.colorPicker?.setActive?.('background')
        })
      })

    this.$shadow
      .querySelectorAll('input[data-typography-input]')
      .forEach(input => {
        input.addEventListener('keydown', event => {
          if (event.key !== 'Enter') return

          event.preventDefault()
          this.handleTypographyInputCommit(
            event.currentTarget?.dataset?.typographyInput,
            event.currentTarget?.value,
          )
        })

        input.addEventListener('blur', event => {
          this.handleTypographyInputCommit(
            event.currentTarget?.dataset?.typographyInput,
            event.currentTarget?.value,
          )
        })
      })

    this.$shadow
      .querySelectorAll('input[data-spacing-input]')
      .forEach(input => {
        input.addEventListener('keydown', event => {
          if (event.key !== 'Enter') return

          event.preventDefault()
          this.handleSpacingInputCommit(
            input.dataset.spacingKind,
            input.dataset.spacingInput,
            input.value,
          )
        })

        input.addEventListener('blur', () => {
          this.handleSpacingInputCommit(
            input.dataset.spacingKind,
            input.dataset.spacingInput,
            input.value,
          )
        })
      })

    $('button[data-spacing-toggle]', this.$shadow).on('click', e => {
      e.preventDefault()
      e.stopPropagation()
      this.toggleSpacingPanelMode(e.currentTarget.dataset.spacingToggle)
    })
  }

  bindGlobalBottomToolbarEvents() {
    if (!this.isLocalSnapshotWorkbench()) return
    if (this._handleDocumentPointerDown) return

    this._handleDocumentPointerDown = event => {
      if (!this._bottomToolbarState?.activeSubtool) return

      const eventPath = typeof event.composedPath === 'function'
        ? event.composedPath()
        : []

      if (eventPath.includes(this)) return

      this._bottomToolbarState = {
        ...(this._bottomToolbarState || {}),
        activeSubtool: null,
      }
      this.refreshLocalSnapshotToolbar()
    }

    document.addEventListener('pointerdown', this._handleDocumentPointerDown, true)
  }

  enableSnapshotToolbarDragging() {
    if (!this.isLocalSnapshotWorkbench()) return

    const dragSurface =
      this.$shadow.querySelector('[data-bottom-toolbar]') ??
      this.$shadow.querySelector('[data-toolbar-panel]') ??
      this.$shadow.querySelector('[data-toolbar-shell]')

    if (!dragSurface) return

    draggable({
      el:this,
      surface: dragSurface,
      cursor: 'grab',
    })
  }

  refreshLocalSnapshotToolbar() {
    if (!this.isLocalSnapshotWorkbench()) return

    this.$shadow.innerHTML = this.render()
    this.colorPicker = ColorPicker(this.$shadow, this.selectorEngine)
    this.bindToolbarActionButtons()
    this.bindBottomToolbarEvents()
    this.enableSnapshotToolbarDragging()
  }

  cleanup() {
    if (this._handleDocumentPointerDown) {
      document.removeEventListener('pointerdown', this._handleDocumentPointerDown, true)
      this._handleDocumentPointerDown = null
    }

    const bye = [
      ...document.getElementsByTagName('visbug-hover'),
      ...document.getElementsByTagName('visbug-handles'),
      ...document.getElementsByTagName('visbug-selected'),
      ...document.getElementsByTagName('visbug-label'),
      ...document.getElementsByTagName('visbug-gridlines'),
    ].forEach(el => el.remove())

    this.teardown?.();

    document.querySelectorAll('[data-pseudo-select=true]')
      .forEach(el =>
        el.removeAttribute('data-pseudo-select'))
  }

  bindLivePageAnnotationState() {
    this._annotationStateUnsubscribe?.()
    this._annotationStateUnsubscribe = subscribeSelectionAnnotationState(state =>
      this.syncAnnotationSummary(state))
  }

  toolSelected(el) {
    if (typeof el === 'string')
      return this.activateTool(el, this.isLocalSnapshotWorkbench()
        ? $(`[data-tool="${el}"]`, this.$shadow)[0]
        : null)

    if (!this.isLocalSnapshotWorkbench()) return
    return this.activateTool(el?.dataset?.tool, el)
  }

  activateTool(tool, el = null) {
    if (typeof tool !== 'string' || typeof this[tool] !== 'function') return

    if (this.active_tool?.dataset?.tool === tool) return

    debugLog('tool:selected', {
      requestedTool: tool,
      currentTool: this.active_tool?.dataset?.tool || null,
      hasToolbarButton: !!el,
    })

    if (this.active_tool) {
      this.active_tool.attr?.('data-active', null)
      this.deactivate_feature?.()
    }

    el?.attr?.('data-active', true)
    this.active_tool = el || { dataset: { tool } }
    this[tool]()
    this.selectorEngine?.refreshSelectionUi?.()
  }

  readSelectionActionsPreference() {
    try {
      return window.localStorage?.getItem(selectionActionsToggleStorageKey) === '1'
    } catch (_) {
      return false
    }
  }

  shouldShowSelectionActionsEverywhere() {
    return this._selectionActionsEverywhere === true
  }

  getPageMode() {
    return getCurrentPageMode()
  }

  isLocalSnapshotWorkbench() {
    return isLocalSnapshotMode(this.getPageMode())
  }

  syncSelectionActionsToggleButton() {
    const button = this.$shadow?.querySelector('button[data-action="toggle-selection-actions"]')
    if (!button) return

    const enabled = this.shouldShowSelectionActionsEverywhere()
    button.innerHTML = Icons.toggle_actions
    button.setAttribute('aria-label', enabled ? '关闭全局操作' : '开启全局操作')
    button.setAttribute('title', enabled ? '关闭全局操作' : '开启全局操作')
    button.setAttribute('aria-pressed', enabled ? 'true' : 'false')
    button.setAttribute('data-enabled', enabled ? 'true' : 'false')
  }

  getToolbarToolsBySection(sectionId) {
    return Object.entries(this.toolbar_model).filter(([, tool]) =>
      (tool.section || 'primary') === sectionId &&
      !hiddenToolbarTools.has(tool.tool))
  }

  syncAnnotationSummary(state = { count: 0, historyVisible: false }) {
    const countNode = this.$shadow?.querySelector('[data-role="annotation-count"]')
    const toggleButton = this.$shadow?.querySelector('button[data-action="toggle-annotation-markers"]')
    if (countNode) countNode.textContent = String(state.count ?? 0)
    if (toggleButton) {
      const active = state.historyVisible === true
      toggleButton.setAttribute('aria-pressed', active ? 'true' : 'false')
      toggleButton.setAttribute('data-enabled', active ? 'true' : 'false')
    }
  }

  setSelectionActionsEverywhere(enabled) {
    this._selectionActionsEverywhere = enabled === true

    try {
      if (this._selectionActionsEverywhere)
        window.localStorage?.setItem(selectionActionsToggleStorageKey, '1')
      else
        window.localStorage?.removeItem(selectionActionsToggleStorageKey)
    } catch (_) {}

    this.syncSelectionActionsToggleButton()
    this.selectorEngine?.refreshSelectionUi?.()
  }

  toggleSelectionActionsEverywhere() {
    this.setSelectionActionsEverywhere(!this.shouldShowSelectionActionsEverywhere())
  }

  captureCurrentPage() {
    if (!this.#selectionBridgeNonce) return

    const origin = window.location.origin
    const targetOrigin = origin && origin !== 'null' && window.location.protocol !== 'file:'
      ? origin
      : '*'

    window.postMessage(
      {
        type: 'page_edit_capture_page',
        payload: {
          nonce: this.#selectionBridgeNonce,
        },
      },
      targetOrigin
    )
  }

  toggleAnnotationMarkers() {
    this.syncAnnotationSummary({
      count: Number(this.$shadow?.querySelector('[data-role="annotation-count"]')?.textContent || 0),
      historyVisible: toggleSelectionAnnotationMarkers(),
    })
  }

  render() {
    if (!this.isLocalSnapshotWorkbench()) {
      return `
      ${this.renderStyles()}
      <ol data-live-toolbar>
          <li class="toolbar-action">
            <button type="button" data-action="capture-page" aria-label="采集当前页面">
              ${Icons.camera}
            </button>
          </li>
          <li class="toolbar-action">
            <button type="button" data-action="toggle-annotation-markers" aria-label="切换标记显示" aria-pressed="false" data-enabled="false">
              <span data-role="annotation-icon">${Icons.inspector}</span>
              <span data-role="annotation-count">0</span>
            </button>
          </li>
        </ol>
      `
    }

    return `
      ${this.renderStyles()}
      ${this.renderBottomToolbar()}
    `
  }

  getBottomToolbarState() {
    const selectedNodes = this.selectorEngine?.selection?.()
    return Array.isArray(selectedNodes) && selectedNodes.length > 0
      ? 'selected'
      : 'idle'
  }

  syncBottomToolbarSelectionState() {
    if (this.getBottomToolbarState() !== 'selected') {
      this._bottomToolbarState = {
        activeSubtool: null,
      }
    }
  }

  getBottomToolbarTools() {
    return bottomToolbarTools
  }

  getBottomToolbarTool(toolId) {
    return getBottomToolbarTool(toolId)
  }

  getSelectedBottomToolbarAvailability() {
    const [selectedNode] = this.selectorEngine?.selection?.() ?? []
    return getBottomToolbarAvailability(selectedNode)
  }

  getBottomToolbarToolActions(toolId) {
    switch (toolId) {
      case 'content':
        return [[{ id: 'activate', label: '编辑' }]]
      case 'move':
        return [
          [{ id: 'up-1', label: '上 1' }, { id: 'down-1', label: '下 1' }, { id: 'left-1', label: '左 1' }, { id: 'right-1', label: '右 1' }],
          [{ id: 'up-10', label: '上 10' }, { id: 'down-10', label: '下 10' }, { id: 'left-10', label: '左 10' }, { id: 'right-10', label: '右 10' }],
        ]
      case 'resize':
        return [
          [{ id: 'width-plus-1', label: '宽 +1' }, { id: 'width-minus-1', label: '宽 -1' }, { id: 'height-plus-1', label: '高 +1' }, { id: 'height-minus-1', label: '高 -1' }],
          [{ id: 'width-plus-10', label: '宽 +10' }, { id: 'width-minus-10', label: '宽 -10' }, { id: 'height-plus-10', label: '高 +10' }, { id: 'height-minus-10', label: '高 -10' }],
        ]
      case 'padding':
      case 'margin':
        return []
      case 'flex':
        return [
          [{ id: 'direction-row', label: '横向' }, { id: 'direction-column', label: '纵向' }, { id: 'wrap-on', label: '换行' }, { id: 'wrap-off', label: '不换行' }],
          [{ id: 'justify-start', label: '主轴 左' }, { id: 'justify-center', label: '主轴 中' }, { id: 'justify-end', label: '主轴 右' }, { id: 'justify-between', label: '主轴 分布' }],
          [{ id: 'align-start', label: '交叉轴 上' }, { id: 'align-center', label: '交叉轴 中' }, { id: 'align-end', label: '交叉轴 下' }, { id: 'align-between', label: '交叉轴 分布' }],
        ]
      case 'typography':
        return [
          [{ id: 'font-plus-1', label: '字号 +1' }, { id: 'font-minus-1', label: '字号 -1' }, { id: 'font-plus-10', label: '字号 +10' }, { id: 'font-minus-10', label: '字号 -10' }],
          [{ id: 'weight-plus', label: '字重 +100' }, { id: 'weight-minus', label: '字重 -100' }, { id: 'leading-plus', label: '行高 +1' }, { id: 'leading-minus', label: '行高 -1' }],
          [{ id: 'align-left', label: '左对齐' }, { id: 'align-center', label: '居中' }, { id: 'align-right', label: '右对齐' }, { id: 'kerning-plus', label: '字距 +0.1' }, { id: 'kerning-minus', label: '字距 -0.1' }],
        ]
      case 'background':
        return []
      case 'reorder':
        return [[{ id: 'move-left', label: '前移' }, { id: 'move-right', label: '后移' }]]
      default:
        return []
    }
  }

  renderBottomToolbar() {
    if (this.getBottomToolbarState() === 'idle') {
      return `
        <section data-bottom-toolbar="idle">
          <div data-bottom-toolbar-hint>点击页面元素开始编辑</div>
          ${this.renderBottomToolbarActions()}
        </section>
      `
    }

    return `
      <section data-bottom-toolbar="selected">
        <nav data-bottom-tools>
          ${this.getBottomToolbarTools().map((tool, index, tools) => `
            ${index > 0 && tools[index - 1].interactionType !== tool.interactionType
              ? '<span data-bottom-divider aria-hidden="true"></span>'
              : ''}
            ${this.renderBottomToolbarTool(tool)}
          `).join('')}
        </nav>
        ${this.renderBottomToolbarActions()}
      </section>
    `
  }

  renderBottomToolbarActions() {
    if (!this.isLocalSnapshotWorkbench()) return ''

    return `
      <div data-bottom-toolbar-actions>
        <span data-bottom-divider aria-hidden="true"></span>
        <button
          type="button"
          data-action="save-file"
          data-bottom-toolbar-action="save"
          aria-label="保存当前文件"
          title="保存当前文件"
        >
          <span class="tool-icon">${Icons.save}</span>
        </button>
      </div>
    `
  }

  renderBottomToolbarTool(tool) {
    const availability = this.getSelectedBottomToolbarAvailability()?.[tool.id] ?? {
      available: true,
      reason: '',
    }
    const isDisabled = availability.available === false
    const disabledReason = availability.reason || tool.label
    const isActive = tool.id === 'background'
      ? this.colorPicker?.getActive?.() === 'background'
      : this._bottomToolbarState?.activeSubtool === tool.id
    const actionRows = this.getBottomToolbarToolActions(tool.id)

    return `
      <div data-bottom-tool-item data-tool-id="${tool.id}" data-open="${isActive ? 'true' : 'false'}">
        ${tool.id === 'background' && !isDisabled
          ? this.renderInlineBackgroundTool(tool, isActive)
          : `
            <button
              type="button"
              data-bottom-tool="${tool.id}"
              data-tool="${tool.feature}"
              data-active="${isActive ? 'true' : 'false'}"
              data-disabled="${isDisabled ? 'true' : 'false'}"
              aria-disabled="${isDisabled ? 'true' : 'false'}"
              aria-expanded="${isActive ? 'true' : 'false'}"
              aria-label="${tool.label}"
              title="${isDisabled ? disabledReason : tool.label}"
            >
              <span class="tool-icon">${tool.icon}</span>
            </button>
          `}
        ${isDisabled
          ? `
            <div data-bottom-tooltip role="tooltip">${disabledReason}</div>
          `
          : `
            ${tool.id === 'typography'
              ? this.renderTypographyPanel()
              : tool.id === 'padding' || tool.id === 'margin'
                ? this.renderSpacingPanel(tool.id)
              : tool.id === 'background'
                ? ''
                : `
                <div data-bottom-menu>
                  ${this.renderBottomToolbarActionRows(tool.id)}
                </div>
              `}
          `}
      </div>
    `
  }

  renderInlineBackgroundTool(tool, isActive = false) {
    return `
      <div
        id="background"
        data-background-inline-tool
        style="--background-tool-color:${this.colorPicker?.background?.color ? 'var(--contextual_color, transparent)' : 'transparent'}"
      >
        <button
          type="button"
          data-bottom-tool="${tool.id}"
          data-tool="${tool.feature}"
          data-active="${isActive ? 'true' : 'false'}"
          data-disabled="false"
          aria-disabled="false"
          aria-expanded="false"
          aria-label="${tool.label}"
          title="${tool.label}"
        >
          <span class="tool-icon">${tool.icon}</span>
          <span data-background-tool-swatch></span>
        </button>
        <input type="color" aria-label="背景颜色">
      </div>
    `
  }

  renderBottomToolbarActionRows(toolId) {
    return this.getBottomToolbarToolActions(toolId).map(actionRow => `
      <div data-bottom-menu-row>
        ${actionRow.map(action => `
          <button
            type="button"
            data-bottom-action="${action.id}"
            data-tool-id="${toolId}"
            title="${action.label}"
          >${action.label}</button>
        `).join('')}
      </div>
    `).join('')
  }

  getSpacingPanelState(kind) {
    const [selectedElement] = this.selectorEngine?.selection?.() ?? []
    const defaultValues = {
      top: '',
      right: '',
      bottom: '',
      left: '',
      vertical: '',
      horizontal: '',
    }
    const draft = this._spacingPanelDraft?.[kind] ?? { mode: null }

    if (!(selectedElement instanceof Element)) {
      return {
        values: defaultValues,
        mode: draft.mode || 'linked',
      }
    }

    const computedStyle = getComputedStyle(selectedElement)
    const top = computedStyle[`${kind}Top`] || ''
    const right = computedStyle[`${kind}Right`] || ''
    const bottom = computedStyle[`${kind}Bottom`] || ''
    const left = computedStyle[`${kind}Left`] || ''
    const symmetricVertical = top === bottom
    const symmetricHorizontal = right === left

    return {
      values: {
        top,
        right,
        bottom,
        left,
        vertical: symmetricVertical ? top : '',
        horizontal: symmetricHorizontal ? right : '',
      },
      mode: draft.mode || (symmetricVertical && symmetricHorizontal ? 'linked' : 'split'),
    }
  }

  renderSpacingPanel(kind) {
    const state = this.getSpacingPanelState(kind)
    const title = kind === 'padding' ? '内边距' : '外边距'
    const isSplit = state.mode === 'split'

    return `
      <div data-bottom-menu data-spacing-panel="${kind}">
        <div data-spacing-header>
          <strong data-spacing-title>${title}</strong>
          <button
            type="button"
            data-spacing-toggle="${kind}"
            data-mode="${state.mode}"
            title="${isSplit ? '切换为上下/左右' : '切换为单边'}"
          >${isSplit ? '四边' : '上下/左右'}</button>
        </div>
        ${isSplit
          ? `
            <div data-spacing-grid="split">
              ${this.renderSpacingInput(kind, 'top', '上', state.values.top)}
              ${this.renderSpacingInput(kind, 'right', '右', state.values.right)}
              ${this.renderSpacingInput(kind, 'bottom', '下', state.values.bottom)}
              ${this.renderSpacingInput(kind, 'left', '左', state.values.left)}
            </div>
          `
          : `
            <div data-spacing-grid="linked">
              ${this.renderSpacingInput(kind, 'vertical', '上下', state.values.vertical)}
              ${this.renderSpacingInput(kind, 'horizontal', '左右', state.values.horizontal)}
            </div>
          `}
      </div>
    `
  }

  renderSpacingInput(kind, field, label, value = '') {
    return `
      <label data-spacing-field="${field}">
        <span>${label}</span>
        <input
          type="text"
          data-spacing-kind="${kind}"
          data-spacing-input="${field}"
          value="${value}"
          aria-label="${label}"
        >
      </label>
    `
  }

  getTypographyPanelState() {
    const [selectedElement] = this.selectorEngine?.selection?.() ?? []
    const defaultState = {
      values: {
        fontSize: '',
        fontWeight: '',
        lineHeight: '',
        letterSpacing: '',
        textAlign: '',
        bold: false,
        italic: false,
        underline: false,
        foreground: '',
      },
      advancedOpen: this._typographyPanelDraft?.advancedOpen ?? false,
    }

    if (!(selectedElement instanceof Element))
      return defaultState

    const computedStyle = getComputedStyle(selectedElement)
    const fontWeight = computedStyle.fontWeight || ''
    const parsedFontWeight = Number.parseFloat(fontWeight)
    const textDecorationLine = computedStyle.textDecorationLine || computedStyle.textDecoration || ''
    return {
      values: {
        fontSize: computedStyle.fontSize || '',
        fontWeight,
        lineHeight: computedStyle.lineHeight || '',
        letterSpacing: computedStyle.letterSpacing || '',
        textAlign: computedStyle.textAlign || '',
        bold: fontWeight === 'bold' || (!Number.isNaN(parsedFontWeight) && parsedFontWeight >= 600),
        italic: (computedStyle.fontStyle || '').includes('italic'),
        underline: textDecorationLine.includes('underline'),
        foreground: computedStyle.color || '',
      },
      advancedOpen: this._typographyPanelDraft?.advancedOpen ?? false,
    }
  }
  renderTypographyPanel() {
    const { values } = this.getTypographyPanelState()
    const textAlign = values.textAlign || 'left'
    const activeColor = values.foreground || 'transparent'

    return `
      <div data-bottom-menu data-typography-panel>
        <div data-bottom-menu-row data-typography-inputs>
          ${this.renderTypographyInput('font-size', '字号', values.fontSize)}
          ${this.renderTypographyInput('font-weight', '字重', values.fontWeight)}
          ${this.renderTypographyInput('line-height', '行高', values.lineHeight)}
          ${this.renderTypographyInput('letter-spacing', '字距', values.letterSpacing)}
        </div>
        <div data-bottom-menu-row data-typography-action-groups>
          <div data-typography-group data-typography-group="align" aria-label="文本对齐">
            ${this.renderTypographyAction('align-left', '左对齐', Icons.align_left, textAlign === 'left' || textAlign === 'start')}
            ${this.renderTypographyAction('align-center', '居中对齐', Icons.align_center, textAlign === 'center')}
            ${this.renderTypographyAction('align-right', '右对齐', Icons.align_right, textAlign === 'right' || textAlign === 'end')}
            ${this.renderTypographyAction('align-justify', '两端对齐', Icons.align_justify, textAlign === 'justify')}
          </div>
          <div data-typography-group data-typography-group="style" aria-label="字形强调">
            ${this.renderTypographyAction('font-bold', '加粗', '<span data-typography-glyph data-variant="bold">B</span>', values.bold)}
            ${this.renderTypographyAction('font-italic', '斜体', '<span data-typography-glyph data-variant="italic">I</span>', values.italic)}
            ${this.renderTypographyAction('font-underline', '下划线', '<span data-typography-glyph data-variant="underline">U</span>', values.underline)}
          </div>
          <div class="toolbar-color-entry" data-typography-color-entry>
            <button
              type="button"
              data-typography-color-trigger
              data-bottom-color-target="foreground"
              data-active="${this.colorPicker?.getActive?.() === 'foreground' ? 'true' : 'false'}"
              style="--typography-color:${activeColor}"
              title="文字颜色"
            >
              <span data-typography-color-icon>${Icons.color_text}</span>
              <span data-typography-color-swatch></span>
            </button>
            <ol colors class="toolbar-colors" data-typography-color-palette>
              <li class="color" id="foreground" aria-label="文字颜色" aria-description="修改文字颜色">
                <input type="color">
                ${Icons.color_text}
              </li>
            </ol>
          </div>
        </div>
      </div>
    `
  }

  renderTypographyInput(inputId, label, value = '') {
    return `
      <label data-typography-field="${inputId}">
        <span>${label}</span>
        <input
          type="text"
          data-typography-input="${inputId}"
          value="${value}"
          aria-label="${label}"
        >
      </label>
    `
  }

  renderTypographyAction(actionId, label, content, isActive = false) {
    return `
      <button
        type="button"
        data-typography-action="${actionId}"
        data-bottom-action="${actionId}"
        data-tool-id="typography"
        data-active="${isActive ? 'true' : 'false'}"
        title="${label}"
      >${content}</button>
    `
  }

  normalizeTypographyInputValue(field, rawValue, fallbackValue = '') {
    const value = String(rawValue ?? '').trim()
    const fallback = String(fallbackValue ?? '')
    const parsedValue = Number.parseFloat(value)

    switch (field) {
      case 'font-size':
        if (!Number.isNaN(parsedValue) && parsedValue >= 6)
          return `${parsedValue}px`
        return fallback
      case 'font-weight':
        if (
          !Number.isNaN(parsedValue) &&
          parsedValue >= 100 &&
          parsedValue <= 900 &&
          parsedValue % 100 === 0
        )
          return String(parsedValue)
        return fallback
      case 'line-height':
        if (!Number.isNaN(parsedValue) && parsedValue > 0)
          return `${parsedValue}px`
        return fallback
      case 'letter-spacing':
        if (!Number.isNaN(parsedValue) && parsedValue >= -2)
          return `${parsedValue}px`
        return fallback
      default:
        return fallback
    }
  }

  normalizeSpacingInputValue(kind, field, rawValue, fallbackValue = '') {
    const value = String(rawValue ?? '').trim()
    const fallback = String(fallbackValue ?? '')
    const parsedValue = Number.parseFloat(value)

    if (Number.isNaN(parsedValue))
      return fallback

    if (kind === 'padding' && parsedValue < 0)
      return fallback

    return `${parsedValue}px`
  }

  getTypographyInputFallbackValue(field, selectedElement) {
    if (!(selectedElement instanceof Element)) return ''

    const computedStyle = getComputedStyle(selectedElement)
    const typographyValues = {
      'font-size': computedStyle.fontSize || '',
      'font-weight': computedStyle.fontWeight || '',
      'line-height': computedStyle.lineHeight || '',
      'letter-spacing': computedStyle.letterSpacing || '',
    }

    return typographyValues[field] || ''
  }

  getSpacingInputFallbackValue(kind, field, selectedElement) {
    if (!(selectedElement instanceof Element)) return ''

    const computedStyle = getComputedStyle(selectedElement)
    const top = computedStyle[`${kind}Top`] || ''
    const right = computedStyle[`${kind}Right`] || ''
    const bottom = computedStyle[`${kind}Bottom`] || ''
    const left = computedStyle[`${kind}Left`] || ''

    const spacingValues = {
      top,
      right,
      bottom,
      left,
      vertical: top === bottom ? top : '',
      horizontal: right === left ? right : '',
    }

    return spacingValues[field] || ''
  }

  handleTypographyInputCommit(field, rawValue) {
    if (typeof field !== 'string' || !field) return

    const selectedNodes = this.selectorEngine?.selection?.() ?? []
    const [selectedElement] = selectedNodes
    const fallbackValue = this.getTypographyInputFallbackValue(field, selectedElement)
    const normalizedValue = this.normalizeTypographyInputValue(field, rawValue, fallbackValue)
    const input = this.$shadow?.querySelector(`input[data-typography-input="${field}"]`)

    if (input) input.value = normalizedValue
    if (!selectedNodes.length || normalizedValue === fallbackValue) {
      this.refreshLocalSnapshotToolbar()
      return
    }

    const typographySetters = {
      'font-size': () => setFontSize(selectedNodes, normalizedValue),
      'font-weight': () => setFontWeight(selectedNodes, normalizedValue),
      'line-height': () => setLineHeight(selectedNodes, normalizedValue),
      'letter-spacing': () => setLetterSpacing(selectedNodes, normalizedValue),
    }

    const mutate = typographySetters[field]
    if (!mutate) return

    this.applySelectedStyleMutation(`font:${field}`, mutate)
    this.refreshLocalSnapshotToolbar()
  }

  handleSpacingInputCommit(kind, field, rawValue) {
    if (!['padding', 'margin'].includes(kind) || typeof field !== 'string' || !field) return

    const selectedNodes = this.selectorEngine?.selection?.() ?? []
    const [selectedElement] = selectedNodes
    const fallbackValue = this.getSpacingInputFallbackValue(kind, field, selectedElement)
    const normalizedValue = this.normalizeSpacingInputValue(kind, field, rawValue, fallbackValue)
    const input = this.$shadow?.querySelector(
      `input[data-spacing-kind="${kind}"][data-spacing-input="${field}"]`,
    )

    if (input) input.value = normalizedValue
    if (!selectedNodes.length || normalizedValue === fallbackValue) {
      this.refreshLocalSnapshotToolbar()
      return
    }

    const styleKeys = {
      top: `${kind}Top`,
      right: `${kind}Right`,
      bottom: `${kind}Bottom`,
      left: `${kind}Left`,
    }

    this.applySelectedStyleMutation(`${kind}:${field}`, () => {
      selectedNodes.forEach(node => {
        if (!(node instanceof HTMLElement || node instanceof SVGElement)) return

        if (field === 'vertical') {
          node.style[styleKeys.top] = normalizedValue
          node.style[styleKeys.bottom] = normalizedValue
          return
        }

        if (field === 'horizontal') {
          node.style[styleKeys.right] = normalizedValue
          node.style[styleKeys.left] = normalizedValue
          return
        }

        node.style[styleKeys[field]] = normalizedValue
      })
    })

    this.refreshLocalSnapshotToolbar()
  }

  toggleSpacingPanelMode(kind) {
    if (!['padding', 'margin'].includes(kind)) return

    const currentMode = this.getSpacingPanelState(kind).mode
    this._spacingPanelDraft = {
      ...(this._spacingPanelDraft || {}),
      [kind]: {
        ...(this._spacingPanelDraft?.[kind] || {}),
        mode: currentMode === 'split' ? 'linked' : 'split',
      },
    }
    this._bottomToolbarState = {
      ...(this._bottomToolbarState || {}),
      activeSubtool: kind,
    }
    this.refreshLocalSnapshotToolbar()
  }

  activateBottomToolbarTool(toolId) {
    const tool = this.getBottomToolbarTool(toolId)
    const availability = this.getSelectedBottomToolbarAvailability()?.[toolId]
    if (!tool || availability?.available === false) return

    if (this._bottomToolbarState?.activeSubtool === tool.id) {
      this._bottomToolbarState = {
        ...(this._bottomToolbarState || {}),
        activeSubtool: null,
      }
      this.refreshLocalSnapshotToolbar()
      return
    }

    this.syncBottomToolbarColorTarget(toolId)
    this._bottomToolbarState = {
      ...(this._bottomToolbarState || {}),
      activeSubtool: tool.id,
    }

    if (toolId !== 'background')
      this.activateTool(tool.feature)
    this.refreshLocalSnapshotToolbar()
  }

  runBottomToolbarAction(toolId, actionId) {
    const tool = this.getBottomToolbarTool(toolId)
    const selectedNodes = this.selectorEngine?.selection?.() ?? []
    const availability = this.getSelectedBottomToolbarAvailability()?.[toolId]
    if (!tool || !selectedNodes.length || availability?.available === false) return

    this.syncBottomToolbarColorTarget(toolId)
    this._bottomToolbarState = {
      ...(this._bottomToolbarState || {}),
      activeSubtool: tool.id,
    }

    if (toolId !== 'background')
      this.activateTool(tool.feature)

    if (toolId === 'content') {
      this.refreshLocalSnapshotToolbar()
      return
    }

    this.applyBottomToolbarMutation(toolId, actionId, selectedNodes)
    this.refreshLocalSnapshotToolbar()
  }

  applyBottomToolbarMutation(toolId, actionId, selectedNodes) {
    switch (toolId) {
      case 'move':
        return this.applySelectedStyleMutation(`position:${actionId}`, () =>
          this.nudgePositionElements(selectedNodes, actionId))
      case 'resize':
        return this.applySelectedStyleMutation(`size:${actionId}`, () =>
          this.resizeSelectedElements(selectedNodes, actionId))
      case 'padding':
        return this.applySelectedStyleMutation(`padding:${actionId}`, () =>
          this.adjustBoxSpacing('padding', selectedNodes, actionId))
      case 'margin':
        return this.applySelectedStyleMutation(`margin:${actionId}`, () =>
          this.adjustBoxSpacing('margin', selectedNodes, actionId))
      case 'flex':
        return this.applySelectedStyleMutation(`flex:${actionId}`, () =>
          this.adjustFlexLayout(selectedNodes, actionId))
      case 'typography':
        return this.applyTypographyMutation(selectedNodes, actionId)
      case 'reorder':
        return this.moveSelectedElements(selectedNodes, actionId)
    }
  }

  syncBottomToolbarSelectionState() {
    if (this.getBottomToolbarState() !== 'selected')
      this._bottomToolbarState = {}
  }

  renderToolSection(section) {
    const tools = this.getToolbarToolsBySection(section.id)

    return `
      <section
        class="toolbar-group"
        data-section="${section.id}"
        aria-label="${section.label}"
      >
        <ol data-tool-list>
          ${tools.reduce((list, [key, tool]) => `
            ${list}
            ${this.renderToolItem(key, tool)}
          `, '')}
        </ol>
      </section>
    `
  }

  renderToolbarActions() {
    return `
      <section class="toolbar-group" data-section="actions">
        <ol data-toolbar-actions>
          <li class="toolbar-action">
            <button
              type="button"
              data-action="toggle-selection-actions"
              aria-label="${this.shouldShowSelectionActionsEverywhere() ? '关闭全局操作' : '开启全局操作'}"
              title="${this.shouldShowSelectionActionsEverywhere() ? '关闭全局操作' : '开启全局操作'}"
              aria-pressed="${this.shouldShowSelectionActionsEverywhere() ? 'true' : 'false'}"
              data-enabled="${this.shouldShowSelectionActionsEverywhere() ? 'true' : 'false'}"
            >
              ${Icons.toggle_actions}
            </button>
          </li>
          ${this.isFilePage() ? `
            <li class="toolbar-action">
              <button type="button" data-action="save-file" aria-label="保存当前文件" title="保存当前文件">
                ${Icons.save}
              </button>
            </li>
          ` : ''}
        </ol>
      </section>
    `
  }

  renderColorSection() {
    return `
      <section class="toolbar-group" data-section="colors">
        <div class="toolbar-color-entry">
          <button
            type="button"
            class="tool-trigger toolbar-color-trigger"
            aria-label="颜色工具"
            title="颜色工具"
          >
            <span class="tool-icon">${Icons.palette}</span>
          </button>
          <ol colors class="toolbar-colors toolbar-color-popup">
            <li class="color" id="foreground" aria-label="Text" aria-description="Change the text color">
              <input type="color">
              ${Icons.color_text}
            </li>
            <li class="color" id="background" aria-label="Background or Fill" aria-description="Change the background color or fill of svg">
              <input type="color">
              ${Icons.color_background}
            </li>
            <li class="color" id="border" aria-label="Border or Stroke" aria-description="Change the border color or stroke of svg">
              <input type="color">
              ${Icons.color_border}
            </li>
          </ol>
        </div>
      </section>
    `
  }

  applySelectedStyleMutation(label, mutate) {
    if (typeof mutate !== 'function') return

    this.selectorEngine?.recordStyleMutation?.({
      elements: this.selectorEngine?.selection?.() ?? [],
      label,
      mutate,
    })
  }

  resizeSelectedElements(elements, actionId) {
    const [, axis, sign, amountText] = actionId.match(/^(width|height)-(plus|minus)-(\d+)$/) ?? []
    if (!axis || !sign || !amountText) return

    const amount = Number(amountText) * (sign === 'minus' ? -1 : 1)

    elements.forEach(element => {
      const rect = element.getBoundingClientRect()
      const styleKey = axis === 'width' ? 'width' : 'height'
      const fallback = axis === 'width' ? rect.width : rect.height
      const current = parseFloat(getComputedStyle(element)[styleKey]) || fallback
      element.style[styleKey] = `${Math.max(1, Math.round(current + amount))}px`
    })
  }

  nudgePositionElements(elements, actionId) {
    const [, direction, amountText] = actionId.match(/^(up|down|left|right)-(\d+)$/) ?? []
    if (!direction || !amountText) return

    const command = Number(amountText) === 10
      ? `shift+${direction}`
      : direction

    positionElement(elements, command)
  }

  adjustBoxSpacing(kind, elements, actionId) {
    if (actionId.startsWith('all-')) {
      const amount = actionId.endsWith('-10') ? 10 : 1
      const command = actionId.includes('minus')
        ? `${metaKey}+down${amount === 10 ? '+shift' : ''}`
        : `${metaKey}+up${amount === 10 ? '+shift' : ''}`

      if (kind === 'padding') padAllElementSides(elements, command)
      else pushAllElementSides(elements, command)
      return
    }

    const [, side, sign, amountText] = actionId.match(/^(up|right|down|left)-(plus|minus)-(\d+)$/) ?? []
    if (!side || !sign || !amountText) return
    const amount = amountText === '10' ? 'shift+' : ''
    const negative = sign === 'minus' ? 'alt+' : ''
    const command = `${amount}${negative}${side}`

    if (kind === 'padding') padElement(elements, command)
    else pushElement(elements, command)
  }

  adjustFlexLayout(elements, actionId) {
    elements.forEach(element => {
      element.style.display = 'flex'
    })

    const flexMutations = {
      'direction-row': () => changeDirection(elements, 'row'),
      'direction-column': () => changeDirection(elements, 'column'),
      'wrap-on': () => elements.forEach(element => { element.style.flexWrap = 'wrap' }),
      'wrap-off': () => elements.forEach(element => { element.style.flexWrap = 'nowrap' }),
      'justify-start': () => elements.forEach(element => { element.style.justifyContent = 'flex-start' }),
      'justify-center': () => elements.forEach(element => { element.style.justifyContent = 'center' }),
      'justify-end': () => elements.forEach(element => { element.style.justifyContent = 'flex-end' }),
      'justify-between': () => elements.forEach(element => { element.style.justifyContent = 'space-between' }),
      'align-start': () => elements.forEach(element => { element.style.alignItems = 'flex-start' }),
      'align-center': () => elements.forEach(element => { element.style.alignItems = 'center' }),
      'align-end': () => elements.forEach(element => { element.style.alignItems = 'flex-end' }),
      'align-between': () => elements.forEach(element => { element.style.alignContent = 'space-between' }),
    }

    flexMutations[actionId]?.()
  }

  adjustFontStyles(elements, actionId) {
    const fontMutations = {
      'font-plus-1': () => changeFontSize(elements, 'up'),
      'font-minus-1': () => changeFontSize(elements, 'down'),
      'font-plus-10': () => changeFontSize(elements, 'shift+up'),
      'font-minus-10': () => changeFontSize(elements, 'shift+down'),
      'weight-plus': () => changeFontWeight(elements, 'up'),
      'weight-minus': () => changeFontWeight(elements, 'down'),
      'font-bold': () => elements.forEach(element => {
        const computedWeight = Number.parseInt(getComputedStyle(element).fontWeight, 10)
        const currentWeight = Number.isNaN(computedWeight)
          ? Number.parseInt(element.style.fontWeight, 10) || 400
          : computedWeight
        element.style.fontWeight = currentWeight >= 600 ? '400' : '700'
      }),
      'font-italic': () => elements.forEach(element => {
        const currentStyle = getComputedStyle(element).fontStyle || element.style.fontStyle
        element.style.fontStyle = currentStyle === 'italic' ? 'normal' : 'italic'
      }),
      'font-underline': () => elements.forEach(element => {
        const currentDecoration = getComputedStyle(element).textDecorationLine
          || element.style.textDecorationLine
          || element.style.textDecoration
        element.style.textDecoration = currentDecoration.includes('underline')
          ? 'none'
          : 'underline'
      }),
      'leading-plus': () => changeLeading(elements, 'shift+up'),
      'leading-minus': () => changeLeading(elements, 'shift+down'),
      'align-left': () => elements.forEach(element => { element.style.textAlign = 'left' }),
      'align-center': () => elements.forEach(element => { element.style.textAlign = 'center' }),
      'align-right': () => elements.forEach(element => { element.style.textAlign = 'right' }),
      'align-justify': () => elements.forEach(element => { element.style.textAlign = 'justify' }),
      'kerning-plus': () => changeKerning(elements, 'right'),
      'kerning-minus': () => changeKerning(elements, 'left'),
    }

    fontMutations[actionId]?.()
  }

  adjustSelectedColors(elements, actionId) {
    const colorActions = {
      'hue-plus': ['up', 'h'],
      'hue-minus': ['down', 'h'],
      'light-plus': ['up', 'l'],
      'light-minus': ['down', 'l'],
      'sat-plus': ['right', 's'],
      'sat-minus': ['left', 's'],
      'alpha-plus': [`${metaKey}+right`, 'a'],
      'alpha-minus': [`${metaKey}+left`, 'a'],
    }

    const action = colorActions[actionId]
    if (!action) return

    changeHue(elements, action[0], action[1], this.colorPicker)
  }

  syncBottomToolbarColorTarget(toolId) {
    if (toolId === 'typography') {
      const activeTarget = this.colorPicker?.getActive?.()
      if (activeTarget !== 'foreground')
        this.colorPicker?.setActive?.('foreground')
      return
    }

    if (toolId !== 'background') return
    const activeTarget = this.colorPicker?.getActive?.()
    if (activeTarget !== 'background')
      this.colorPicker?.setActive?.('background')
  }

  applyTypographyMutation(selectedNodes, actionId) {
    const colorActions = new Set([
      'hue-plus',
      'hue-minus',
      'light-plus',
      'light-minus',
      'sat-plus',
      'sat-minus',
      'alpha-plus',
      'alpha-minus',
    ])

    if (colorActions.has(actionId)) {
      return this.applySelectedStyleMutation(`typography-color:${actionId}`, () =>
        this.adjustSelectedColors(selectedNodes, actionId))
    }

    return this.applySelectedStyleMutation(`font:${actionId}`, () =>
      this.adjustFontStyles(selectedNodes, actionId))
  }

  adjustSelectedShadows(elements, actionId) {
    const shadowActions = {
      'x-plus': ['right', 'x'],
      'x-minus': ['left', 'x'],
      'y-plus': ['down', 'y'],
      'y-minus': ['up', 'y'],
      'blur-plus': ['alt+down', 'blur'],
      'blur-minus': ['alt+up', 'blur'],
      'size-plus': ['alt+right', 'size'],
      'size-minus': ['alt+left', 'size'],
      'opacity-plus': [`${metaKey}+right`, 'opacity'],
      'opacity-minus': [`${metaKey}+left`, 'opacity'],
    }

    const action = shadowActions[actionId]
    if (!action) return

    changeBoxShadow(elements, action[0].split('+'), action[1])
  }

  moveSelectedElements(elements, actionId) {
    const direction = actionId === 'move-left' ? 'left' : actionId === 'move-right' ? 'right' : null
    if (!direction) return

    elements.forEach(element => moveElement(element, direction))
  }

  renderToolItem(key, tool) {
    return `
      <li
        aria-label="${tool.label}"
        aria-description="${tool.description}"
        aria-hotkey="${key}"
        data-tool="${tool.tool}"
        data-active="${key == 'g'}"
      >
        <button
          type="button"
          class="tool-trigger"
          aria-label="${tool.label}"
          title="${tool.label}"
        >
          <span class="tool-icon">${tool.icon}</span>
        </button>
        <div class="tool-hover-card" aria-hidden="true">
          <div class="tool-hover-header">
            <strong class="tool-hover-label">${tool.label}</strong>
            <span class="tool-hover-hotkey">快捷键 ${this.formatToolHotkey(key)}</span>
          </div>
          ${this.renderToolInstructionSummary(tool.instruction)}
        </div>
      </li>
    `
  }

  renderStyles() {
    return supportsAdoptedStyleSheets ? '' : `<style>${this.styles.join('\n')}</style>`;
  }

  formatToolHotkey(key) {
    return String(key || '').trim().toUpperCase()
  }

  renderToolInstructionSummary(instruction) {
    if (typeof instruction !== 'string' || instruction.trim().length === 0) return ''

    const rows = [...instruction.matchAll(/<div>\s*<b>(.*?)<\/b>\s*<span>(.*?)<\/span>\s*<\/div>/g)]
      .map(([, label, value]) => ({
        label: this.stripHtml(label).trim(),
        value: this.stripHtml(value).trim(),
      }))
      .filter(row => row.label && row.value)

    if (rows.length === 0) return ''

    return `
      <div class="tool-hover-instructions">
        ${rows.map(row => `
          <div class="tool-hover-instruction-row">
            <span class="tool-hover-instruction-label">${row.label}</span>
            <span class="tool-hover-instruction-value">${row.value}</span>
          </div>
        `).join('')}
      </div>
    `
  }

  stripHtml(text) {
    return String(text || '').replace(/<[^>]+>/g, '')
  }

  move() {
    this.deactivate_feature = Moveable(this.selectorEngine)
  }

  margin() {
    this.deactivate_feature = Margin(this.selectorEngine)
  }

  padding() {
    this.deactivate_feature = Padding(this.selectorEngine)
  }

  font() {
    this.deactivate_feature = Font(this.selectorEngine)
  }

  text() {
    this.selectorEngine.onSelectedUpdate(EditText)
    this.deactivate_feature = () =>
      this.selectorEngine.removeSelectedCallback(EditText)
  }

  align() {
    this.deactivate_feature = Flex(this.selectorEngine)
  }

  search() {
    this.deactivate_feature = Search($('[data-tool="search"]', this.$shadow))
  }

  boxshadow() {
    this.deactivate_feature = BoxShadow(this.selectorEngine)
  }

  hueshift() {
    this.deactivate_feature = HueShift({
      Color:  this.colorPicker,
      Visbug: this.selectorEngine,
    })
  }

  activatePositionFeature() {
    debugLog('position:activate')
    let feature = Position()
    this.selectorEngine.onSelectedUpdate(feature.onNodesSelected)

    return () => {
      debugLog('position:deactivate')
      this.selectorEngine.removeSelectedCallback(feature.onNodesSelected)
      feature.disconnect()
    }
  }

  inspector() {
    debugLog('inspector:activate')
    const deactivateInspector = MetaTip(this.selectorEngine)
    const deactivatePosition = this.activatePositionFeature()

    this.deactivate_feature = () => {
      deactivateInspector?.()
      deactivatePosition?.()
    }
  }

  accessibility() {
    this.deactivate_feature = Accessibility()
  }

  guides() {
    this.selection()
  }

  selection() {
    this.deactivate_feature = Guides(this.selectorEngine)
  }

  screenshot() {
    this.deactivate_feature = Screenshot()
  }

  position() {
    this.deactivate_feature = this.activatePositionFeature()
  }

  execCommand(command) {
    const query = `/${command}`

    if (PluginRegistry.has(query))
      return PluginRegistry.get(query)({
        selected: this.selectorEngine.selection(),
        query
      })

    return Promise.resolve(new Error("Query not found"))
  }

  setSelectionBridgeNonce(nonce) {
    this.#selectionBridgeNonce =
      typeof nonce === 'string' && nonce.length > 0
        ? nonce
        : null

    if (typeof this.selectorEngine?.setSelectionBridgeNonce === 'function')
      this.selectorEngine.setSelectionBridgeNonce(this.#selectionBridgeNonce)
  }

  isFilePage() {
    return window.location.protocol === 'file:'
  }

  serializeCurrentDocument() {
    const doctype = document.doctype
      ? `<!DOCTYPE ${[
          document.doctype.name,
          document.doctype.publicId
            ? `PUBLIC "${document.doctype.publicId}"`
            : document.doctype.systemId
              ? 'SYSTEM'
              : '',
          document.doctype.systemId ? `"${document.doctype.systemId}"` : '',
        ]
          .filter(Boolean)
          .join(' ')}>`
      : '<!DOCTYPE html>'

    return `${doctype}\n${document.documentElement.outerHTML}`
  }

  saveCurrentFile() {
    if (!this.isFilePage() || !this.#selectionBridgeNonce) return

    const confirmed = window.confirm('将覆盖原始 HTML 文件，是否继续保存？')
    if (!confirmed) return

    window.postMessage(
      {
        type: 'page_edit_save_file',
        payload: {
          nonce: this.#selectionBridgeNonce,
          pageUrl: window.location.href,
          html: this.serializeCurrentDocument(),
        },
      },
      '*'
    )
  }

  get activeTool() {
    return this.active_tool?.dataset?.tool ?? null
  }

  set tutsBaseURL(url) {
    this._tutsBaseURL = url
    this.setup()
  }

  set colorMode(mode) {
    this._colormode = modemap[mode]
  }

  get colorMode() {
    return this._colormode
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

  if (!registry.get('vis-bug')) {
    try {
      registry.define('vis-bug', VisBug);
    } catch (error) {
      if (!(error instanceof DOMException) || error.name !== 'NotSupportedError' || !registry.get('vis-bug')) {
        throw error;
      }
    }
  }
})()
