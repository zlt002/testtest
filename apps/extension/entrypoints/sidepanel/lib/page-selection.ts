export type PageSelectionContext = {
  url: string;
  title?: string;
  selectionSource?: 'deep-read' | 'website-tool';
  comparison?: {
    matches: boolean;
    warnings: string[];
  };
  selection: {
    address?: string | null;
    text?: string | null;
    formula?: string | null;
    value2?: unknown;
    row?: number;
    column?: number;
    rowsCount?: number;
    columnsCount?: number;
    domSelection?: {
      type?: string | null;
      isCollapsed?: boolean;
      rangeCount?: number;
      text?: string;
    } | null;
  };
  activeCell?: {
    address?: string | null;
    text?: string | null;
    formula?: string | null;
    value2?: unknown;
    row?: number;
    column?: number;
    rowsCount?: number;
    columnsCount?: number;
  } | null;
};

function formatScalar(value: unknown): string {
  if (value === null || typeof value === 'undefined' || value === '') {
    return '(none)';
  }
  if (typeof value === 'object') {
    return JSON.stringify(value);
  }
  return String(value);
}

export function formatPageSelectionContext(context: PageSelectionContext): string {
  const selection = context.selection;
  const lines = [
    '[当前页面选区]',
    `title: ${context.title || '(untitled)'}`,
    `url: ${context.url}`,
    `selectionSource: ${context.selectionSource || 'deep-read'}`,
    `address: ${formatScalar(selection.address)}`,
    `row: ${formatScalar(selection.row)}`,
    `column: ${formatScalar(selection.column)}`,
    `rowsCount: ${formatScalar(selection.rowsCount)}`,
    `columnsCount: ${formatScalar(selection.columnsCount)}`,
    `text: ${formatScalar(selection.text)}`,
    `formula: ${formatScalar(selection.formula)}`,
    `value2: ${formatScalar(selection.value2)}`,
  ];

  if (selection.domSelection) {
    lines.push(
      `domSelection.type: ${formatScalar(selection.domSelection.type)}`,
      `domSelection.isCollapsed: ${formatScalar(selection.domSelection.isCollapsed)}`,
      `domSelection.rangeCount: ${formatScalar(selection.domSelection.rangeCount)}`,
      `domSelection.text: ${formatScalar(selection.domSelection.text)}`
    );
  }

  if (context.activeCell) {
    lines.push(
      `activeCell.address: ${formatScalar(context.activeCell.address)}`,
      `activeCell.row: ${formatScalar(context.activeCell.row)}`,
      `activeCell.column: ${formatScalar(context.activeCell.column)}`,
      `activeCell.rowsCount: ${formatScalar(context.activeCell.rowsCount)}`,
      `activeCell.columnsCount: ${formatScalar(context.activeCell.columnsCount)}`,
      `activeCell.text: ${formatScalar(context.activeCell.text)}`,
      `activeCell.formula: ${formatScalar(context.activeCell.formula)}`,
      `activeCell.value2: ${formatScalar(context.activeCell.value2)}`
    );
  }

  if (context.comparison?.warnings?.length) {
    lines.push(`selectionWarning: ${context.comparison.warnings.join('；')}`);
  }

  lines.push('[/当前页面选区]');
  return lines.join('\n');
}

export function insertPageSelectionBlock(
  currentValue: string,
  context: PageSelectionContext
): string {
  const block = formatPageSelectionContext(context);
  if (!currentValue.trim()) {
    return block;
  }
  return `${currentValue.trimEnd()}\n\n${block}`;
}
