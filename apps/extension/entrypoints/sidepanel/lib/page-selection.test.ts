// @vitest-environment node

import { describe, expect, it } from 'vitest';
import {
  formatPageSelectionContext,
  insertPageSelectionBlock,
  type PageSelectionContext,
} from './page-selection';

const sampleSelection: PageSelectionContext = {
  url: 'https://webedit.midea.com/moewebv7/document-cloud?editId=abc',
  title: '任务表示例',
  selectionSource: 'website-tool',
  comparison: {
    matches: false,
    warnings: ['选区地址不一致：深读=B2，website tool=B2:D4'],
  },
  selection: {
    address: 'B2:D4',
    text: '开始日期 截止日期 状态',
    rowsCount: 3,
    columnsCount: 3,
    row: 2,
    column: 2,
    formula: null,
    value2: null,
    domSelection: null,
  },
  activeCell: {
    address: 'D4',
    text: '完成',
    row: 4,
    column: 4,
    rowsCount: 1,
    columnsCount: 1,
  },
};

describe('page selection formatting', () => {
  it('formats current page selection context into a stable block', () => {
    const block = formatPageSelectionContext(sampleSelection);

    expect(block).toContain('[当前页面选区]');
    expect(block).toContain('selectionSource: website-tool');
    expect(block).toContain('address: B2:D4');
    expect(block).toContain('activeCell.address: D4');
    expect(block).toContain('rowsCount: 3');
    expect(block).toContain('columnsCount: 3');
    expect(block).toContain('text: 开始日期 截止日期 状态');
    expect(block).toContain('selectionWarning: 选区地址不一致：深读=B2，website tool=B2:D4');
  });

  it('appends the selection block to existing input content', () => {
    const next = insertPageSelectionBlock('请基于当前选区继续处理', sampleSelection);

    expect(next).toContain('请基于当前选区继续处理');
    expect(next).toContain('[当前页面选区]');
    expect(next).toContain('B2:D4');
  });
});
