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
    expect(screen.getByTestId('dom-analysis-suggestion-card').className).toContain('max-h-full');
    expect(screen.getByTestId('dom-analysis-suggestion-card').className).toContain('overflow-y-auto');

    fireEvent.click(screen.getByRole('button', { name: '插入命令' }));

    expect(onInsertCommand).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('button', { name: '关闭页面分析建议' }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('在内容可继续向下滚动时显示底部渐隐提示，滚到底后隐藏', () => {
    const scrollHeightDescriptor = Object.getOwnPropertyDescriptor(
      HTMLElement.prototype,
      'scrollHeight'
    );
    const clientHeightDescriptor = Object.getOwnPropertyDescriptor(
      HTMLElement.prototype,
      'clientHeight'
    );
    const scrollTopDescriptor = Object.getOwnPropertyDescriptor(
      HTMLElement.prototype,
      'scrollTop'
    );

    let mockScrollTop = 0;
    Object.defineProperty(HTMLElement.prototype, 'scrollHeight', {
      configurable: true,
      get() {
        return 240;
      },
    });
    Object.defineProperty(HTMLElement.prototype, 'clientHeight', {
      configurable: true,
      get() {
        return 120;
      },
    });
    Object.defineProperty(HTMLElement.prototype, 'scrollTop', {
      configurable: true,
      get() {
        return mockScrollTop;
      },
      set(value) {
        mockScrollTop = Number(value);
      },
    });

    try {
      render(
        <DomAnalysisSuggestionCard
          card={{
            pageName: 'GLS',
            route: '#/entrustedOrderModule/entrustedOrderManageNew',
            targetAction: '点击「搜索」',
            actionType: '列表查询',
            tableHeaders: ['委托单号', '委托单状态', '报价单号', '客户名称', '状态'],
            recommendedApi: '/api-miloms/order/query',
            confidence: 'medium',
          }}
          suggestedCommand='/ewankb-server-query graph gls "GLS 搜索 列表查询 委托单号 委托单状态 报价单号 客户名称 状态"'
          onInsertCommand={vi.fn()}
          onClose={vi.fn()}
        />
      );

      expect(screen.getByTestId('dom-analysis-suggestion-bottom-fade')).toBeTruthy();

      const card = screen.getByTestId('dom-analysis-suggestion-card');
      mockScrollTop = 120;
      fireEvent.scroll(card);

      expect(screen.queryByTestId('dom-analysis-suggestion-bottom-fade')).toBeNull();
    } finally {
      if (scrollHeightDescriptor) {
        Object.defineProperty(HTMLElement.prototype, 'scrollHeight', scrollHeightDescriptor);
      } else {
        delete (HTMLElement.prototype as Partial<HTMLElement>).scrollHeight;
      }
      if (clientHeightDescriptor) {
        Object.defineProperty(HTMLElement.prototype, 'clientHeight', clientHeightDescriptor);
      } else {
        delete (HTMLElement.prototype as Partial<HTMLElement>).clientHeight;
      }
      if (scrollTopDescriptor) {
        Object.defineProperty(HTMLElement.prototype, 'scrollTop', scrollTopDescriptor);
      } else {
        delete (HTMLElement.prototype as Partial<HTMLElement>).scrollTop;
      }
    }
  });
});
