import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';

import {
  readCurrentPageContent,
  type FrameSelectionSummary,
} from './read-current-page-content';
import { getMcpHubInstance } from './mcpHub';

type StableSelectionSummary = NonNullable<FrameSelectionSummary>;
type SelectionSource = 'deep-read' | 'website-tool';
const DEEP_READ_FALLBACK_TIMEOUT_MS = 1_500;

export type SelectionComparison = {
  matches: boolean;
  preferredSource: SelectionSource;
  warnings: string[];
};

export type CurrentPageSelectionResult = {
  url: string;
  title: string;
  selection: StableSelectionSummary;
  activeCell?: StableSelectionSummary;
  selectionSource: SelectionSource;
  deepReadSelection?: StableSelectionSummary;
  websiteSelection?: StableSelectionSummary;
  comparison?: SelectionComparison;
};

type WebsiteSelectionSnapshot = {
  selection: StableSelectionSummary;
  activeCell?: StableSelectionSummary;
};

type PageTabMeta = {
  url: string;
  title: string;
};

type ReadCurrentPageSelectionOptions = {
  lockedTabId?: number;
  windowId?: number;
};

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function normalizeSelection(value: unknown): StableSelectionSummary | null {
  if (!isPlainObject(value)) {
    return null;
  }

  const domSelection = isPlainObject(value.domSelection)
    ? {
        type: typeof value.domSelection.type === 'string' ? value.domSelection.type : null,
        isCollapsed:
          typeof value.domSelection.isCollapsed === 'boolean'
            ? value.domSelection.isCollapsed
            : undefined,
        rangeCount:
          typeof value.domSelection.rangeCount === 'number'
            ? value.domSelection.rangeCount
            : undefined,
        text:
          typeof value.domSelection.text === 'string' ? value.domSelection.text : undefined,
      }
    : null;
  const topLevelText = typeof value.text === 'string' ? value.text : null;
  const domText = typeof domSelection?.text === 'string' ? domSelection.text : null;
  const domHasText = !!domText && domText.trim().length > 0;
  const topLevelHasText = !!topLevelText && topLevelText.trim().length > 0;
  const preferDomSelection = domHasText && !topLevelHasText;

  const selection: StableSelectionSummary = {
    mode:
      value.mode === 'spreadsheet' || value.mode === 'document' || value.mode === 'unknown'
        ? value.mode
        : undefined,
    source: preferDomSelection
      ? 'dom-selection'
      : typeof value.source === 'string'
        ? value.source
        : null,
    address: typeof value.address === 'string' ? value.address : null,
    text: topLevelHasText ? topLevelText : domText,
    formula: typeof value.formula === 'string' ? value.formula : null,
    value2: value.value2,
    row: typeof value.row === 'number' ? value.row : undefined,
    column: typeof value.column === 'number' ? value.column : undefined,
    rowsCount: typeof value.rowsCount === 'number' ? value.rowsCount : undefined,
    columnsCount: typeof value.columnsCount === 'number' ? value.columnsCount : undefined,
    isCollapsed: preferDomSelection
      ? domSelection?.isCollapsed
      : typeof value.isCollapsed === 'boolean'
        ? value.isCollapsed
        : undefined,
    rangeCount: preferDomSelection
      ? domSelection?.rangeCount
      : typeof value.rangeCount === 'number'
        ? value.rangeCount
        : undefined,
    domSelection: domSelection,
  };

  return hasStableSelection(selection) ? selection : null;
}

function hasStableSelection(selection: FrameSelectionSummary): selection is StableSelectionSummary {
  if (!selection) {
    return false;
  }

  const hasSelectionAddress =
    typeof selection.address === 'string' && selection.address.trim().length > 0;
  const hasSelectionText = typeof selection.text === 'string' && selection.text.trim().length > 0;
  const hasSelectionShape =
    typeof selection.rowsCount === 'number' || typeof selection.columnsCount === 'number';
  const hasDomSelectionText =
    typeof selection.domSelection?.text === 'string' && selection.domSelection.text.trim().length > 0;
  const hasDocumentCursorState =
    selection.mode === 'document' &&
    (typeof selection.isCollapsed === 'boolean' ||
      typeof selection.rangeCount === 'number' ||
      typeof selection.domSelection?.isCollapsed === 'boolean' ||
      typeof selection.domSelection?.rangeCount === 'number');

  return (
    hasSelectionAddress ||
    hasSelectionText ||
    hasSelectionShape ||
    hasDomSelectionText ||
    hasDocumentCursorState
  );
}

function parseToolPayload(result: CallToolResult): unknown {
  const firstTextPart = result.content?.find(
    (part): part is { type: 'text'; text: string } =>
      part.type === 'text' && typeof part.text === 'string'
  );

  if (!firstTextPart?.text) {
    return null;
  }

  try {
    return JSON.parse(firstTextPart.text);
  } catch {
    return null;
  }
}

async function readWebsiteSelection(
  lockedTabId?: number
): Promise<WebsiteSelectionSnapshot | null> {
  const hub = getMcpHubInstance();
  if (!hub) {
    return null;
  }

  for (const toolName of ['webedit_get_document_selection', 'webedit_get_selection']) {
    const result =
      typeof lockedTabId === 'number'
        ? await hub.executeWebsiteToolOnActiveTab(toolName, {}, lockedTabId)
        : await hub.executeWebsiteToolOnActiveTab(toolName, {});
    if (result.isError) {
      continue;
    }

    const payload = parseToolPayload(result);
    if (!isPlainObject(payload)) {
      continue;
    }

    const data = isPlainObject(payload.data) ? payload.data : null;
    if (!data) {
      continue;
    }

    const normalizedSelection = normalizeSelection(data.selection || data);
    const normalizedActiveCell = normalizeSelection(data.activeCell);
    if (normalizedSelection) {
      if (!normalizedSelection.domSelection && isPlainObject(data.domSelection)) {
        normalizedSelection.domSelection = {
          type: typeof data.domSelection.type === 'string' ? data.domSelection.type : null,
          isCollapsed:
            typeof data.domSelection.isCollapsed === 'boolean'
              ? data.domSelection.isCollapsed
              : undefined,
          rangeCount:
            typeof data.domSelection.rangeCount === 'number'
              ? data.domSelection.rangeCount
              : undefined,
          text: typeof data.domSelection.text === 'string' ? data.domSelection.text : undefined,
        };
      }
      const domText =
        typeof normalizedSelection.domSelection?.text === 'string'
          ? normalizedSelection.domSelection.text
          : null;
      const topLevelHasText =
        typeof normalizedSelection.text === 'string' && normalizedSelection.text.trim().length > 0;
      const domHasText = !!domText && domText.trim().length > 0;
      if (domHasText && !topLevelHasText) {
        normalizedSelection.text = domText;
        normalizedSelection.isCollapsed =
          typeof normalizedSelection.domSelection?.isCollapsed === 'boolean'
            ? normalizedSelection.domSelection.isCollapsed
            : normalizedSelection.isCollapsed;
        normalizedSelection.rangeCount =
          typeof normalizedSelection.domSelection?.rangeCount === 'number'
            ? normalizedSelection.domSelection.rangeCount
            : normalizedSelection.rangeCount;
        normalizedSelection.source = 'dom-selection';
      }
      return {
        selection: normalizedSelection,
        activeCell: normalizedActiveCell || undefined,
      };
    }

    if (isPlainObject(data.domSelection)) {
      const domBackfilledSelection = normalizeSelection({
        mode: toolName === 'webedit_get_document_selection' ? 'document' : undefined,
        domSelection: data.domSelection,
        text: typeof data.domSelection.text === 'string' ? data.domSelection.text : null,
      });
      if (domBackfilledSelection) {
        return {
          selection: domBackfilledSelection,
          activeCell: normalizedActiveCell || undefined,
        };
      }
    }
  }

  return null;
}

async function readActiveTabMeta(options: ReadCurrentPageSelectionOptions = {}): Promise<PageTabMeta> {
  try {
    if (typeof chrome === 'undefined') {
      return { url: '', title: '' };
    }

    if (typeof options.lockedTabId === 'number' && chrome.tabs?.get) {
      const lockedTab = await chrome.tabs.get(options.lockedTabId);
      return {
        url: lockedTab?.url || '',
        title: lockedTab?.title || '',
      };
    }

    if (!chrome.tabs?.query) {
      return { url: '', title: '' };
    }

    const [activeTab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
    return {
      url: activeTab?.url || '',
      title: activeTab?.title || '',
    };
  } catch {
    return { url: '', title: '' };
  }
}

async function readDeepSelectionWithTimeout(
  options: ReadCurrentPageSelectionOptions = {},
  timeoutMs = DEEP_READ_FALLBACK_TIMEOUT_MS
) {
  const timeoutError = new Error(`deep-read timeout after ${timeoutMs}ms`);
  return Promise.race([
    readCurrentPageContent({
      tabId: options.lockedTabId,
      windowId: options.windowId,
      includeFrames: true,
      frameStrategy: 'wps-priority',
      includeFrameAnalysis: true,
      maxChars: 6000,
    }),
    new Promise<never>((_, reject) => {
      setTimeout(() => reject(timeoutError), timeoutMs);
    }),
  ]);
}

function formatShape(selection: StableSelectionSummary): string {
  const rows = typeof selection.rowsCount === 'number' ? selection.rowsCount : '?';
  const columns = typeof selection.columnsCount === 'number' ? selection.columnsCount : '?';
  return `${rows}x${columns}`;
}

function isSingleCellSelection(selection: StableSelectionSummary): boolean | null {
  if (
    typeof selection.rowsCount === 'number' &&
    typeof selection.columnsCount === 'number'
  ) {
    return selection.rowsCount === 1 && selection.columnsCount === 1;
  }

  if (typeof selection.address === 'string' && selection.address.trim()) {
    return !selection.address.includes(':');
  }

  return null;
}

function compareSelections(
  deepReadSelection: StableSelectionSummary,
  websiteSelection: StableSelectionSummary
): SelectionComparison {
  const warnings: string[] = [];

  if (
    deepReadSelection.address &&
    websiteSelection.address &&
    deepReadSelection.address !== websiteSelection.address
  ) {
    warnings.push(
      `选区地址不一致：深读=${deepReadSelection.address}，website tool=${websiteSelection.address}`
    );
  }

  if (
    typeof deepReadSelection.rowsCount === 'number' &&
    typeof deepReadSelection.columnsCount === 'number' &&
    typeof websiteSelection.rowsCount === 'number' &&
    typeof websiteSelection.columnsCount === 'number' &&
    (deepReadSelection.rowsCount !== websiteSelection.rowsCount ||
      deepReadSelection.columnsCount !== websiteSelection.columnsCount)
  ) {
    warnings.push(
      `选区尺寸不一致：深读=${formatShape(deepReadSelection)}，website tool=${formatShape(websiteSelection)}`
    );
  }

  const deepReadSingleCell = isSingleCellSelection(deepReadSelection);
  const websiteSingleCell = isSingleCellSelection(websiteSelection);
  if (
    deepReadSingleCell !== null &&
    websiteSingleCell !== null &&
    deepReadSingleCell !== websiteSingleCell
  ) {
    warnings.push(
      deepReadSingleCell
        ? '深读识别为单格，但 website tool 返回了多格选区'
        : '深读识别为多格，但 website tool 返回了单格选区'
    );
  }

  if (
    deepReadSelection.mode === 'document' &&
    websiteSelection.mode === 'document' &&
    deepReadSelection.text &&
    websiteSelection.text &&
    deepReadSelection.text !== websiteSelection.text
  ) {
    warnings.push(
      `文档选中文本不一致：深读=${deepReadSelection.text}，website tool=${websiteSelection.text}`
    );
  }

  if (
    deepReadSelection.mode === 'document' &&
    websiteSelection.mode === 'document' &&
    typeof deepReadSelection.isCollapsed === 'boolean' &&
    typeof websiteSelection.isCollapsed === 'boolean' &&
    deepReadSelection.isCollapsed !== websiteSelection.isCollapsed
  ) {
    warnings.push(
      `文档光标折叠状态不一致：深读=${deepReadSelection.isCollapsed}，website tool=${websiteSelection.isCollapsed}`
    );
  }

  return {
    matches: warnings.length === 0,
    preferredSource: 'website-tool',
    warnings,
  };
}

export async function readCurrentPageSelection(
  options: ReadCurrentPageSelectionOptions = {}
): Promise<CurrentPageSelectionResult> {
  const websiteSnapshot = await readWebsiteSelection(options.lockedTabId);
  const websiteSelection = websiteSnapshot?.selection || null;

  let deepReadResult:
    | Awaited<ReturnType<typeof readCurrentPageContent>>
    | null = null;
  if (!websiteSelection) {
    deepReadResult = await readCurrentPageContent({
      tabId: options.lockedTabId,
      windowId: options.windowId,
      includeFrames: true,
      frameStrategy: 'wps-priority',
      includeFrameAnalysis: true,
      maxChars: 6000,
    });
  } else {
    try {
      deepReadResult = await readDeepSelectionWithTimeout(options);
    } catch {
      deepReadResult = null;
    }
  }

  const deepReadSelection = normalizeSelection(deepReadResult?.selection);
  const selection = websiteSelection || deepReadSelection;

  if (!selection) {
    throw new Error('当前页面未检测到可用选区');
  }

  const fallbackTabMeta = websiteSelection ? await readActiveTabMeta(options) : null;
  const pageUrl = deepReadResult?.url || fallbackTabMeta?.url || '';
  const pageTitle = deepReadResult?.title || fallbackTabMeta?.title || '';

  const comparison =
    deepReadSelection && websiteSelection
      ? compareSelections(deepReadSelection, websiteSelection)
      : undefined;

  return {
    url: pageUrl,
    title: pageTitle,
    selection,
    activeCell: websiteSnapshot?.activeCell,
    selectionSource: websiteSelection ? 'website-tool' : 'deep-read',
    deepReadSelection: deepReadSelection || undefined,
    websiteSelection: websiteSelection || undefined,
    comparison,
  };
}
