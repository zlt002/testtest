export type StructuredDomSignals = {
  navLabels: string[];
  formLabels: string[];
  tableHeaders: string[];
};

export const EMPTY_STRUCTURED_DOM_SIGNALS: StructuredDomSignals = {
  navLabels: [],
  formLabels: [],
  tableHeaders: [],
};

const MAX_STRUCTURED_SUMMARY_ITEMS = 20;
const DEFAULT_ACTION_TYPE_KEYWORDS = ['搜索', '查询', '筛选', '检索'];

function uniqueStrings(values: string[], limit: number): string[] {
  const result: string[] = [];
  const seen = new Set<string>();

  for (const value of values) {
    const normalizedValue = value.trim();
    if (!normalizedValue || seen.has(normalizedValue)) {
      continue;
    }
    seen.add(normalizedValue);
    result.push(normalizedValue);
    if (result.length >= limit) {
      break;
    }
  }

  return result;
}

export function extractStructuredDomSignals(doc: Document = document): StructuredDomSignals {
  const MAX_NAV_LABELS = 8;
  const MAX_FORM_LABELS = 12;
  const MAX_TABLE_HEADERS = 12;
  const TABLE_HEADER_STOP_WORDS = new Set(['操作', '序号', '更多']);

  const normalizeText = (value: string | null | undefined): string =>
    (value ?? '').replace(/\s+/g, ' ').trim();

  const dedupe = (values: string[], limit: number, stopWords?: Set<string>): string[] => {
    const result: string[] = [];
    const seen = new Set<string>();

    for (const value of values) {
      const normalized = normalizeText(value);
      if (!normalized || seen.has(normalized)) {
        continue;
      }
      if (stopWords?.has(normalized)) {
        continue;
      }
      if (normalized.length < 2 && !/[A-Za-z0-9]/.test(normalized)) {
        continue;
      }
      if (/^[^\p{L}\p{N}]+$/u.test(normalized)) {
        continue;
      }

      seen.add(normalized);
      result.push(normalized);
      if (result.length >= limit) {
        break;
      }
    }

    return result;
  };

  const navTextCandidates = Array.from(
    doc.querySelectorAll(
      [
        'nav a',
        'nav span',
        '[role="navigation"] a',
        '[role="navigation"] span',
        '.ant-breadcrumb-link',
        '.breadcrumb a',
        '.breadcrumb span',
        '.ant-menu-item-selected',
        '.menu-item.active',
        '.is-active',
        '[aria-current="page"]',
        '[aria-selected="true"]',
        '.ant-tabs-tab-active',
      ].join(',')
    )
  ).map((element) => element.textContent ?? '');

  const formLabelCandidates = Array.from(
    doc.querySelectorAll(
      [
        'label',
        '.ant-form-item-label',
        '.el-form-item__label',
        '.form-item-label',
        'input[placeholder]',
        'textarea[placeholder]',
        '[role="textbox"][aria-label]',
        'select[aria-label]',
        '[data-label]',
      ].join(',')
    )
  ).map((element) => {
    const tagName = element.tagName.toLowerCase();
    if (tagName === 'input' || tagName === 'textarea') {
      return element.getAttribute('placeholder');
    }
    if (tagName === 'select') {
      return element.getAttribute('aria-label');
    }
    return (
      element.getAttribute('aria-label') ||
      element.getAttribute('data-label') ||
      element.textContent
    );
  });

  const tableHeaderCandidates = Array.from(
    doc.querySelectorAll(
      [
        'table thead th',
        'table thead td',
        '[role="columnheader"]',
        '.ant-table-thead th',
        '.el-table__header th',
      ].join(',')
    )
  ).map((element) => element.textContent ?? '');

  return {
    navLabels: dedupe(navTextCandidates, MAX_NAV_LABELS),
    formLabels: dedupe(formLabelCandidates, MAX_FORM_LABELS),
    tableHeaders: dedupe(tableHeaderCandidates, MAX_TABLE_HEADERS, TABLE_HEADER_STOP_WORDS),
  };
}

export function normalizeStructuredDomSignals(
  value: Partial<StructuredDomSignals> | null | undefined
): StructuredDomSignals {
  if (!value || typeof value !== 'object') {
    return EMPTY_STRUCTURED_DOM_SIGNALS;
  }

  return {
    navLabels: Array.isArray(value.navLabels) ? uniqueStrings(value.navLabels, 8) : [],
    formLabels: Array.isArray(value.formLabels) ? uniqueStrings(value.formLabels, 12) : [],
    tableHeaders: Array.isArray(value.tableHeaders) ? uniqueStrings(value.tableHeaders, 12) : [],
  };
}

export function inferStructuredActionType(input: {
  tagName: string;
  text: string | null;
  hasFormContext: boolean;
  hasTableContext: boolean;
  keywords?: string[];
}): string | null {
  const normalizedText = input.text?.trim() ?? '';
  if (!normalizedText) {
    return null;
  }

  const keywords = input.keywords ?? DEFAULT_ACTION_TYPE_KEYWORDS;
  if (
    input.tagName.toLowerCase() === 'button' &&
    keywords.some((keyword) => normalizedText.includes(keyword)) &&
    input.hasFormContext &&
    input.hasTableContext
  ) {
    return '列表查询';
  }

  return null;
}

export function mergeStructuredSummaryTerms(input: {
  pageTextSummary: string[];
  structuredSignals: StructuredDomSignals;
  actionType: string | null;
  limit?: number;
}): string[] {
  return uniqueStrings(
    [
      ...input.structuredSignals.navLabels,
      ...input.structuredSignals.formLabels,
      ...input.structuredSignals.tableHeaders,
      ...(input.actionType ? [input.actionType] : []),
      ...input.pageTextSummary,
    ],
    input.limit ?? MAX_STRUCTURED_SUMMARY_ITEMS
  );
}
