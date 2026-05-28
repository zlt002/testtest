const HIDDEN_TABLE_CELL_CLASS = 'is-hidden';
const TABLE_COLUMN_CLASS_PATTERN = /^el-table_\d+_column_\d+$/;
const HEADER_CELL_TAG = 'TH';
function getRowCells(row: Element | null): HTMLElement[] {
  if (!row) {
    return [];
  }

  return Array.from(row.children).filter((child): child is HTMLElement => child instanceof HTMLElement);
}

function revealTableCell(targetCell: HTMLElement, sourceCell: HTMLElement): void {
  targetCell.classList.remove(HIDDEN_TABLE_CELL_CLASS);
  targetCell.innerHTML = sourceCell.innerHTML;
}

function readInlinePixelValue(rawValue: string): number {
  const match = /^(-?\d+(?:\.\d+)?)px$/.exec(rawValue.trim());
  return match ? Number(match[1]) : 0;
}

function readCellRenderWidth(cell: HTMLElement): number {
  const measuredWidth = Number(cell.getBoundingClientRect?.().width || 0);
  if (measuredWidth > 0) {
    return measuredWidth;
  }

  const inlineWidth = readInlinePixelValue(cell.style.width);
  if (inlineWidth > 0) {
    return inlineWidth;
  }

  const innerCell = cell.querySelector(':scope > .cell');
  if (innerCell instanceof HTMLElement) {
    const innerMeasuredWidth = Number(innerCell.getBoundingClientRect?.().width || 0);
    if (innerMeasuredWidth > 0) {
      return innerMeasuredWidth;
    }

    const innerInlineWidth = readInlinePixelValue(innerCell.style.width);
    if (innerInlineWidth > 0) {
      return innerInlineWidth;
    }
  }

  return 0;
}

function applyStickyPosition(
  targetCell: HTMLElement,
  side: 'left' | 'right',
  offset: number
): void {
  targetCell.style.position = 'sticky';
  targetCell.style[side] = `${offset}px`;
  targetCell.style[side === 'left' ? 'right' : 'left'] = '';
  targetCell.style.zIndex = targetCell.tagName === HEADER_CELL_TAG ? '3' : '2';
}

function isTransparentColor(color: string): boolean {
  const normalized = color.trim().toLowerCase();
  return (
    normalized === '' ||
    normalized === 'transparent' ||
    normalized === 'rgba(0, 0, 0, 0)' ||
    normalized === 'rgba(0,0,0,0)'
  );
}

function pickStickyBackgroundColor(targetCell: HTMLElement, sourceCell: HTMLElement): string {
  const candidates: Array<HTMLElement | null> = [
    targetCell,
    sourceCell,
    targetCell.parentElement as HTMLElement | null,
    sourceCell.parentElement as HTMLElement | null,
    targetCell.closest('thead') as HTMLElement | null,
    targetCell.closest('tbody') as HTMLElement | null,
    targetCell.closest('table') as HTMLElement | null,
  ];

  for (const candidate of candidates) {
    if (!candidate) {
      continue;
    }

    const color = candidate.style.backgroundColor?.trim();
    if (color && !isTransparentColor(color)) {
      return color;
    }
  }

  return '#fff';
}

function applyStickyBackdrop(targetCell: HTMLElement, sourceCell: HTMLElement): void {
  targetCell.style.backgroundColor = pickStickyBackgroundColor(targetCell, sourceCell);
  targetCell.style.backgroundClip = 'padding-box';
}

function hasMeaningfulCellContent(cell: HTMLElement): boolean {
  if (cell.textContent?.trim()) {
    return true;
  }

  return cell.children.length > 0;
}

function getTableColumnClass(cell: HTMLElement): string | null {
  for (const className of Array.from(cell.classList)) {
    if (TABLE_COLUMN_CLASS_PATTERN.test(className)) {
      return className;
    }
  }

  return null;
}

function getVxeColumnId(cell: HTMLElement): string | null {
  const colId = cell.getAttribute('colid');
  return colId && colId.trim() ? colId.trim() : null;
}

function shouldRevealFromFixedCell(targetCell: HTMLElement, sourceCell: HTMLElement): boolean {
  if (!hasMeaningfulCellContent(sourceCell)) {
    return false;
  }

  if (targetCell.classList.contains(HIDDEN_TABLE_CELL_CLASS)) {
    return true;
  }

  return !hasMeaningfulCellContent(targetCell);
}

function cellsHaveEquivalentContent(targetCell: HTMLElement, sourceCell: HTMLElement): boolean {
  const targetHtml = targetCell.innerHTML.replace(/\s+/g, ' ').trim();
  const sourceHtml = sourceCell.innerHTML.replace(/\s+/g, ' ').trim();
  if (targetHtml && sourceHtml) {
    return targetHtml === sourceHtml;
  }

  return (targetCell.textContent || '').trim() === (sourceCell.textContent || '').trim();
}

function findMainCellByColumnClass(
  mainCells: HTMLElement[],
  sourceCell: HTMLElement,
  side: 'left' | 'right'
): HTMLElement | null {
  const columnClass = getTableColumnClass(sourceCell);
  if (columnClass) {
    const matched = mainCells.find((cell) => cell.classList.contains(columnClass));
    if (matched) {
      return matched;
    }
  }

  const hiddenCells = mainCells.filter((cell) => cell.classList.contains(HIDDEN_TABLE_CELL_CLASS));
  if (hiddenCells.length === 0) {
    return null;
  }

  return side === 'left' ? hiddenCells[0] || null : hiddenCells[hiddenCells.length - 1] || null;
}

function flattenFixedRowsIntoMainRows(
  mainRows: Element[],
  fixedRows: Element[],
  side: 'left' | 'right'
): boolean {
  const rowCount = Math.min(mainRows.length, fixedRows.length);
  let copiedMeaningfulCell = false;

  for (let rowIndex = 0; rowIndex < rowCount; rowIndex += 1) {
    const mainCells = getRowCells(mainRows[rowIndex]);
    const fixedCells = getRowCells(fixedRows[rowIndex]);
    if (mainCells.length === 0 || fixedCells.length === 0) {
      continue;
    }

    const stickyOffsets = new Array<number>(fixedCells.length).fill(0);
    if (side === 'left') {
      let offset = 0;
      for (let cellIndex = 0; cellIndex < fixedCells.length; cellIndex += 1) {
        stickyOffsets[cellIndex] = offset;
        offset += readCellRenderWidth(fixedCells[cellIndex]);
      }
    } else {
      let offset = 0;
      for (let cellIndex = fixedCells.length - 1; cellIndex >= 0; cellIndex -= 1) {
        stickyOffsets[cellIndex] = offset;
        offset += readCellRenderWidth(fixedCells[cellIndex]);
      }
    }

    for (let cellIndex = 0; cellIndex < fixedCells.length; cellIndex += 1) {
      const sourceCell = fixedCells[cellIndex];
      const targetCell = findMainCellByColumnClass(mainCells, sourceCell, side);
      if (!targetCell || !sourceCell) {
        continue;
      }

      if (!shouldRevealFromFixedCell(targetCell, sourceCell)) {
        if (hasMeaningfulCellContent(sourceCell) && cellsHaveEquivalentContent(targetCell, sourceCell)) {
          applyStickyPosition(targetCell, side, stickyOffsets[cellIndex] || 0);
          copiedMeaningfulCell = true;
        }
        continue;
      }

      revealTableCell(targetCell, sourceCell);
      applyStickyPosition(targetCell, side, stickyOffsets[cellIndex] || 0);
      applyStickyBackdrop(targetCell, sourceCell);
      copiedMeaningfulCell = true;
    }
  }

  return copiedMeaningfulCell;
}

function flattenFixedTableLayer(table: HTMLElement, side: 'left' | 'right'): boolean {
  const fixedSelector = side === 'left' ? '.el-table__fixed' : '.el-table__fixed-right';
  const fixedLayer = table.querySelector(fixedSelector);
  if (!(fixedLayer instanceof HTMLElement)) {
    return false;
  }

  const mainHeaderRows = Array.from(table.querySelectorAll(':scope > .el-table__header-wrapper tr'));
  const fixedHeaderRows = Array.from(fixedLayer.querySelectorAll('tr'));
  const hasFixedHeaderRows = fixedHeaderRows.length > 0;
  let copiedHeader = false;
  if (mainHeaderRows.length > 0 && hasFixedHeaderRows) {
    copiedHeader = flattenFixedRowsIntoMainRows(
      mainHeaderRows,
      fixedHeaderRows.slice(0, mainHeaderRows.length),
      side
    );
  }

  const mainBodyRows = Array.from(table.querySelectorAll(':scope > .el-table__body-wrapper tr'));
  const fixedBodyRows = Array.from(fixedLayer.querySelectorAll('.el-table__fixed-body-wrapper tr'));
  const hasFixedBodyRows = fixedBodyRows.length > 0;
  let copiedBody = false;
  if (mainBodyRows.length > 0 && hasFixedBodyRows) {
    copiedBody = flattenFixedRowsIntoMainRows(mainBodyRows, fixedBodyRows, side);
  }

  const shouldRemoveLayer = (!hasFixedHeaderRows || copiedHeader) && (!hasFixedBodyRows || copiedBody);
  if (shouldRemoveLayer) {
    fixedLayer.remove();
  }

  return shouldRemoveLayer;
}

function flattenFixedTableColumns(doc: Document): void {
  for (const table of Array.from(doc.querySelectorAll('.el-table')).filter(
    (element): element is HTMLElement => element instanceof HTMLElement
  )) {
    flattenFixedTableLayer(table, 'left');
    flattenFixedTableLayer(table, 'right');
  }
}

function ensureVxeColgroupColumns(
  mainTable: HTMLElement | null,
  fixedTable: HTMLElement | null,
  colIds: string[],
  side: 'left' | 'right'
): void {
  if (!mainTable || !fixedTable || colIds.length === 0) {
    return;
  }

  const mainColgroup = mainTable.querySelector(':scope > colgroup');
  const fixedColgroup = fixedTable.querySelector(':scope > colgroup');
  if (!(mainColgroup instanceof HTMLElement) || !(fixedColgroup instanceof HTMLElement)) {
    return;
  }

  for (const colId of colIds) {
    if (mainColgroup.querySelector(`:scope > col[name="${colId}"]`)) {
      continue;
    }

    const sourceCol = fixedColgroup.querySelector(`:scope > col[name="${colId}"]`);
    if (!(sourceCol instanceof HTMLElement)) {
      continue;
    }

    const clonedCol = sourceCol.cloneNode(true);
    if (side === 'left') {
      mainColgroup.prepend(clonedCol);
    } else {
      mainColgroup.append(clonedCol);
    }
  }
}

function flattenVxeFixedRowsIntoMainRows(
  mainRows: Element[],
  fixedRows: Element[],
  side: 'left' | 'right'
): { copied: boolean; colIds: string[] } {
  const rowCount = Math.min(mainRows.length, fixedRows.length);
  let copied = false;
  const copiedColIds = new Set<string>();

  for (let rowIndex = 0; rowIndex < rowCount; rowIndex += 1) {
    const mainCells = getRowCells(mainRows[rowIndex]);
    const fixedCells = getRowCells(fixedRows[rowIndex]).filter((cell) => Boolean(getVxeColumnId(cell)));
    if (mainCells.length === 0 || fixedCells.length === 0) {
      continue;
    }

    const stickyOffsets = new Array<number>(fixedCells.length).fill(0);
    if (side === 'left') {
      let offset = 0;
      for (let cellIndex = 0; cellIndex < fixedCells.length; cellIndex += 1) {
        stickyOffsets[cellIndex] = offset;
        offset += readCellRenderWidth(fixedCells[cellIndex]);
      }
    } else {
      let offset = 0;
      for (let cellIndex = fixedCells.length - 1; cellIndex >= 0; cellIndex -= 1) {
        stickyOffsets[cellIndex] = offset;
        offset += readCellRenderWidth(fixedCells[cellIndex]);
      }
    }

    for (let cellIndex = 0; cellIndex < fixedCells.length; cellIndex += 1) {
      const sourceCell = fixedCells[cellIndex];
      const colId = getVxeColumnId(sourceCell);
      if (!colId || mainCells.some((cell) => getVxeColumnId(cell) === colId)) {
        continue;
      }

      const clonedCell = sourceCell.cloneNode(true);
      if (!(clonedCell instanceof HTMLElement)) {
        continue;
      }

      applyStickyPosition(clonedCell, side, stickyOffsets[cellIndex] || 0);
      applyStickyBackdrop(clonedCell, sourceCell);

      if (side === 'left') {
        mainRows[rowIndex].prepend(clonedCell);
      } else {
        mainRows[rowIndex].append(clonedCell);
      }

      copied = true;
      copiedColIds.add(colId);
    }
  }

  return { copied, colIds: Array.from(copiedColIds) };
}

function flattenVxeFixedWrapperPair(root: HTMLElement, side: 'left' | 'right'): boolean {
  const fixedClass = side === 'left' ? 'fixed-left--wrapper' : 'fixed-right--wrapper';
  const mainHeaderWrapper = root.querySelector(':scope > .vxe-table--header-wrapper.body--wrapper');
  const mainBodyWrapper = root.querySelector(':scope > .vxe-table--body-wrapper.body--wrapper');
  const fixedHeaderWrapper = root.querySelector(`:scope > .vxe-table--header-wrapper.${fixedClass}`);
  const fixedBodyWrapper = root.querySelector(`:scope > .vxe-table--body-wrapper.${fixedClass}`);

  let copiedHeader = false;
  let copiedBody = false;

  if (mainHeaderWrapper instanceof HTMLElement && fixedHeaderWrapper instanceof HTMLElement) {
    const headerResult = flattenVxeFixedRowsIntoMainRows(
      Array.from(mainHeaderWrapper.querySelectorAll('tr')),
      Array.from(fixedHeaderWrapper.querySelectorAll('tr')),
      side
    );
    ensureVxeColgroupColumns(
      mainHeaderWrapper.querySelector(':scope > table'),
      fixedHeaderWrapper.querySelector(':scope > table'),
      headerResult.colIds,
      side
    );
    copiedHeader = headerResult.copied;
  }

  if (mainBodyWrapper instanceof HTMLElement && fixedBodyWrapper instanceof HTMLElement) {
    const bodyResult = flattenVxeFixedRowsIntoMainRows(
      Array.from(mainBodyWrapper.querySelectorAll('tr')),
      Array.from(fixedBodyWrapper.querySelectorAll('tr')),
      side
    );
    ensureVxeColgroupColumns(
      mainBodyWrapper.querySelector(':scope > table'),
      fixedBodyWrapper.querySelector(':scope > table'),
      bodyResult.colIds,
      side
    );
    copiedBody = bodyResult.copied;
  }

  const shouldRemove =
    (!fixedHeaderWrapper || copiedHeader) &&
    (!fixedBodyWrapper || copiedBody);

  if (shouldRemove) {
    fixedHeaderWrapper?.remove();
    fixedBodyWrapper?.remove();
  }

  return shouldRemove;
}

function flattenVxeFixedTableColumns(doc: Document): void {
  for (const root of Array.from(doc.querySelectorAll('.vxe-table--main-wrapper')).filter(
    (element): element is HTMLElement => element instanceof HTMLElement
  )) {
    flattenVxeFixedWrapperPair(root, 'left');
    flattenVxeFixedWrapperPair(root, 'right');
  }
}

function readInlinePixelWidth(element: HTMLElement): number {
  return readInlinePixelValue(element.style.width);
}

function readMeasuredWidth(element: HTMLElement): number {
  const scrollWidth = Number(element.scrollWidth || 0);
  const clientWidth = Number(element.clientWidth || 0);
  const rectWidth = Number(element.getBoundingClientRect?.().width || 0);
  return Math.max(scrollWidth, clientWidth, rectWidth, 0);
}

function scoreScrollableContentCandidate(element: HTMLElement, container: HTMLElement): number {
  if (element.hasAttribute('data-capture-content-root')) {
    return Number.POSITIVE_INFINITY;
  }

  const inlineWidth = readInlinePixelWidth(element);
  const measuredWidth = readMeasuredWidth(element);
  const containerWidth = readMeasuredWidth(container);
  const contentSignals = element.children.length + element.querySelectorAll('*').length;
  const overflowWidth = Math.max(measuredWidth - containerWidth, 0);

  return inlineWidth * 1000 + overflowWidth * 100 + measuredWidth * 10 + contentSignals;
}

function findScrollableContentElement(container: HTMLElement): HTMLElement | null {
  const directChildren = Array.from(container.children).filter(
    (child): child is HTMLElement => child instanceof HTMLElement,
  );
  if (directChildren.length === 0) {
    return null;
  }

  let bestChild = directChildren[0];
  let bestScore = scoreScrollableContentCandidate(bestChild, container);

  for (const child of directChildren.slice(1)) {
    const score = scoreScrollableContentCandidate(child, container);
    if (score > bestScore) {
      bestChild = child;
      bestScore = score;
    }
  }

  return bestChild;
}

function freezeHorizontalScrollContainer(scrollContainer: HTMLElement): void {
  const rawValue = scrollContainer.getAttribute('data-capture-scroll-left');
  scrollContainer.removeAttribute('data-capture-scroll-left');

  const scrollLeft = Number(rawValue || '0');
  if (!Number.isFinite(scrollLeft) || scrollLeft === 0) {
    return;
  }

  scrollContainer.style.overflowX = 'hidden';

  const tableContentLayers = Array.from(
    scrollContainer.querySelectorAll(
      ':scope > .el-table__header-wrapper > table, :scope > .el-table__body-wrapper > table'
    )
  ).filter((element): element is HTMLElement => element instanceof HTMLElement);
  if (tableContentLayers.length > 0) {
    for (const layer of tableContentLayers) {
      const existingMarginLeft = layer.style.marginLeft.trim();
      layer.style.marginLeft = existingMarginLeft
        ? `calc(${existingMarginLeft} - ${scrollLeft}px)`
        : `-${scrollLeft}px`;
    }
    return;
  }

  const content = findScrollableContentElement(scrollContainer);
  if (!content) {
    return;
  }

  const existingMarginLeft = content.style.marginLeft.trim();
  content.style.marginLeft = existingMarginLeft
    ? `calc(${existingMarginLeft} - ${scrollLeft}px)`
    : `-${scrollLeft}px`;
}

function freezeCapturedScrollState(doc: Document): void {
  for (const element of Array.from(doc.querySelectorAll('[data-capture-scroll-left]'))) {
    if (!(element instanceof HTMLElement)) {
      continue;
    }

    freezeHorizontalScrollContainer(element);
  }
}

export function normalizeCapturedLayout(doc: Document): void {
  flattenFixedTableColumns(doc);
  flattenVxeFixedTableColumns(doc);
  freezeCapturedScrollState(doc);
}
