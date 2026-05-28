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

function sumVxeColgroupWidth(table: HTMLElement | null): number {
  if (!table) {
    return 0;
  }

  const colgroup = table.querySelector(':scope > colgroup');
  if (!(colgroup instanceof HTMLElement)) {
    return 0;
  }

  return Array.from(colgroup.children).reduce((total, child) => {
    if (!(child instanceof HTMLElement) || child.tagName !== 'COL') {
      return total;
    }

    return total + readInlinePixelValue(child.style.width);
  }, 0);
}

function syncVxeTableWidthToColgroup(table: HTMLElement | null): void {
  if (!table) {
    return;
  }

  const totalWidth = sumVxeColgroupWidth(table);
  if (totalWidth > 0) {
    table.style.width = `${totalWidth}px`;
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

function getDirectChild(root: HTMLElement, selector: string): HTMLElement | null {
  const element = root.querySelector(`:scope > ${selector}`);
  return element instanceof HTMLElement ? element : null;
}

function getVxeMainWrapper(root: HTMLElement): HTMLElement | null {
  if (root.classList.contains('vxe-table--main-wrapper')) {
    return root;
  }

  return getDirectChild(root, '.vxe-table--main-wrapper');
}

function getVxeMainSectionWrapper(
  root: HTMLElement,
  selector: '.vxe-table--header-wrapper.body--wrapper' | '.vxe-table--body-wrapper.body--wrapper'
): HTMLElement | null {
  const mainWrapper = getVxeMainWrapper(root);
  if (mainWrapper) {
    return getDirectChild(mainWrapper, selector);
  }

  return getDirectChild(root, selector);
}

function getVxeFixedContainer(root: HTMLElement, side: 'left' | 'right'): HTMLElement | null {
  const directContainer = getDirectChild(root, `.vxe-table--fixed-${side}-wrapper`);
  if (directContainer) {
    return directContainer;
  }

  const fixedWrapper = getDirectChild(root, '.vxe-table--fixed-wrapper');
  if (fixedWrapper) {
    return getDirectChild(fixedWrapper, `.vxe-table--fixed-${side}-wrapper`);
  }

  return null;
}

function cleanupEmptyVxeFixedWrapper(root: HTMLElement): void {
  const fixedWrapper = getDirectChild(root, '.vxe-table--fixed-wrapper');
  if (!fixedWrapper) {
    return;
  }

  const hasRemainingFixedChildren = Array.from(fixedWrapper.children).some(
    (child) =>
      child instanceof HTMLElement &&
      (child.classList.contains('vxe-table--fixed-left-wrapper') ||
        child.classList.contains('vxe-table--fixed-right-wrapper'))
  );

  if (!hasRemainingFixedChildren) {
    fixedWrapper.remove();
  }
}

function getVxeFixedSectionWrapper(
  root: HTMLElement,
  side: 'left' | 'right',
  section: 'header' | 'body'
): HTMLElement | null {
  const fixedClass = side === 'left' ? 'fixed-left--wrapper' : 'fixed-right--wrapper';
  const sectionSelector =
    section === 'header' ? `.vxe-table--header-wrapper.${fixedClass}` : `.vxe-table--body-wrapper.${fixedClass}`;
  const fixedContainer = getVxeFixedContainer(root, side);
  if (fixedContainer) {
    return getDirectChild(fixedContainer, sectionSelector);
  }

  return getDirectChild(root, sectionSelector);
}

function mainRowsContainAllVxeColumns(
  wrapper: HTMLElement | null,
  rowSelector: string,
  colIds: string[]
): boolean {
  if (!wrapper || colIds.length === 0) {
    return false;
  }

  return colIds.every((colId) => wrapper.querySelector(`${rowSelector}[colid="${colId}"]`));
}

function flattenVxeFixedWrapperPair(root: HTMLElement, side: 'left' | 'right'): boolean {
  const fixedContainer = getVxeFixedContainer(root, side);
  const mainHeaderWrapper = getVxeMainSectionWrapper(root, '.vxe-table--header-wrapper.body--wrapper');
  const mainBodyWrapper = getVxeMainSectionWrapper(root, '.vxe-table--body-wrapper.body--wrapper');
  const fixedHeaderWrapper = getVxeFixedSectionWrapper(root, side, 'header');
  const fixedBodyWrapper = getVxeFixedSectionWrapper(root, side, 'body');

  let copiedHeader = false;
  let copiedBody = false;

  if (mainHeaderWrapper instanceof HTMLElement && fixedHeaderWrapper instanceof HTMLElement) {
    const mainHeaderTable = mainHeaderWrapper.querySelector(':scope > table');
    const fixedHeaderTable = fixedHeaderWrapper.querySelector(':scope > table');
    const headerResult = flattenVxeFixedRowsIntoMainRows(
      Array.from(mainHeaderWrapper.querySelectorAll('tr')),
      Array.from(fixedHeaderWrapper.querySelectorAll('tr')),
      side
    );
    ensureVxeColgroupColumns(
      mainHeaderTable,
      fixedHeaderTable,
      headerResult.colIds,
      side
    );
    syncVxeTableWidthToColgroup(mainHeaderTable instanceof HTMLElement ? mainHeaderTable : null);
    copiedHeader =
      headerResult.colIds.length > 0 &&
      mainRowsContainAllVxeColumns(mainHeaderWrapper, 'th', headerResult.colIds);
  }

  if (mainBodyWrapper instanceof HTMLElement && fixedBodyWrapper instanceof HTMLElement) {
    const mainBodyTable = mainBodyWrapper.querySelector(':scope > table');
    const fixedBodyTable = fixedBodyWrapper.querySelector(':scope > table');
    const bodyResult = flattenVxeFixedRowsIntoMainRows(
      Array.from(mainBodyWrapper.querySelectorAll('tr')),
      Array.from(fixedBodyWrapper.querySelectorAll('tr')),
      side
    );
    ensureVxeColgroupColumns(
      mainBodyTable,
      fixedBodyTable,
      bodyResult.colIds,
      side
    );
    syncVxeTableWidthToColgroup(mainBodyTable instanceof HTMLElement ? mainBodyTable : null);
    copiedBody =
      bodyResult.colIds.length > 0 &&
      mainRowsContainAllVxeColumns(mainBodyWrapper, 'td', bodyResult.colIds);
  }

  const hasFixedHeader = fixedHeaderWrapper instanceof HTMLElement;
  const hasFixedBody = fixedBodyWrapper instanceof HTMLElement;
  const shouldRemove = (!hasFixedHeader || copiedHeader) && (!hasFixedBody || copiedBody);

  if (shouldRemove) {
    if (fixedContainer) {
      fixedContainer.remove();
    } else {
      fixedHeaderWrapper?.remove();
      fixedBodyWrapper?.remove();
    }
  }

  return shouldRemove;
}

function flattenVxeFixedTableColumns(doc: Document): void {
  for (const root of Array.from(doc.querySelectorAll('.vxe-table--render-wrapper, .vxe-table--main-wrapper')).filter(
    (element): element is HTMLElement => element instanceof HTMLElement
  )) {
    flattenVxeFixedWrapperPair(root, 'left');
    flattenVxeFixedWrapperPair(root, 'right');
    cleanupEmptyVxeFixedWrapper(root);
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

  if (
    scrollContainer.classList.contains('vxe-table--body-wrapper') &&
    scrollContainer.classList.contains('body--wrapper')
  ) {
    const mainWrapper = scrollContainer.closest('.vxe-table--main-wrapper');
    const headerTable = mainWrapper?.querySelector(
      ':scope > .vxe-table--header-wrapper.body--wrapper > table'
    );
    const bodyTable = scrollContainer.querySelector(':scope > table');

    const vxeTables = [headerTable, bodyTable].filter(
      (element): element is HTMLElement => element instanceof HTMLElement
    );

    for (const table of vxeTables) {
      const existingMarginLeft = table.style.marginLeft.trim();
      table.style.marginLeft = existingMarginLeft
        ? `calc(${existingMarginLeft} - ${scrollLeft}px)`
        : `-${scrollLeft}px`;
    }
    return;
  }

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
  freezeCapturedScrollState(doc);
}
