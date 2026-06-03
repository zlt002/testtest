import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { DomAnalysisSuggestionCard } from './DomAnalysisSuggestionCard';

describe('DomAnalysisSuggestionCard', () => {
  it('展示页面分析证据并支持关闭和插入命令', () => {
    const onInsertCommand = vi.fn();
    const onClose = vi.fn();

    render(
      <DomAnalysisSuggestionCard
        card={{
          pageName: '快递询价',
          route: '#/entrustedOrderModule/expressInquiry',
          targetAction: '点击「搜索」',
          actionType: '列表查询',
          tableHeaders: ['供应商简称', '价目表名称', '起始国/地区', '目的地', '服务类型'],
          recommendedApi: '/api-miloms/guarantee/expressCostPrice/summarySearch',
          confidence: 'medium',
        }}
        suggestedCommand='/ewankb-server-query graph gls "快递询价 搜索 列表查询 expressCostPrice summarySearch 供应商简称 目的地 服务类型"'
        onInsertCommand={onInsertCommand}
        onClose={onClose}
      />
    );

    expect(screen.getByTestId('dom-analysis-suggestion-card')).toBeTruthy();
    expect(screen.getByText('页面分析建议')).toBeTruthy();
    expect(screen.getByText('中置信度')).toBeTruthy();
    expect(screen.getByText('快递询价')).toBeTruthy();
    expect(screen.getByText('列表查询')).toBeTruthy();
    expect(screen.getByText('供应商简称、价目表名称、起始国/地区、目的地、服务类型')).toBeTruthy();
    expect(screen.getByText('/api-miloms/guarantee/expressCostPrice/summarySearch')).toBeTruthy();
    expect(screen.getByTestId('dom-analysis-suggestion-header')).toBeTruthy();
    expect(screen.getByTestId('dom-analysis-suggestion-header-actions')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: '插入命令' }));

    expect(onInsertCommand).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('button', { name: '关闭页面分析建议' }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
