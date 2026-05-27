// @vitest-environment node

import { describe, expect, it } from 'vitest';

import { createPageEditElementAnalysisSummaryBuilder } from './page-edit-element-analysis-summary';

function createTarget() {
  return {
    url: 'https://example.com',
    selector: '#search-button',
    xpath: '//*[@id="search-button"]',
    tagName: 'button',
    id: 'search-button',
    classList: ['primary'],
    dataAttributes: {},
    text: '查询',
    rect: { x: 1, y: 2, width: 3, height: 4 },
    outerHTMLSnippet: '<button id="search-button">查询</button>',
    ancestors: [],
    siblings: {
      previous: null,
      next: null,
    },
  };
}

describe('createPageEditElementAnalysisSummaryBuilder', () => {
  it('builds interactive guidance for clickable elements', () => {
    const builder = createPageEditElementAnalysisSummaryBuilder();

    const text = builder.buildStartMessage({
      analysisMode: 'interactive',
      target: createTarget(),
    });

    expect(text).toContain('已开始页面元素分析');
    expect(text).toContain('目标元素：查询');
    expect(text).toContain('请在页面上执行一次真实点击或交互');
  });

  it('builds refresh guidance for display elements', () => {
    const builder = createPageEditElementAnalysisSummaryBuilder();

    const text = builder.buildStartMessage({
      analysisMode: 'display',
      target: {
        ...createTarget(),
        tagName: 'span',
        selector: null,
        xpath: null,
        id: null,
        classList: ['status'],
        text: null,
        outerHTMLSnippet: '<span class="status"></span>',
      },
    });

    expect(text).toContain('已开始页面元素分析');
    expect(text).toContain('目标元素：<span.status>');
    expect(text).toContain('请刷新页面或触发一次重新加载');
  });
});
