// @vitest-environment node

import { describe, expect, it } from 'vitest';
import { JSDOM } from 'jsdom';
import { buildTextRangeAnchor, findTextHighlightRanges, findTextRange } from './file-preview';

function collapseWhitespace(value: string) {
  return value.replace(/\s+/g, ' ').trim();
}

describe('findTextRange', () => {
  it('连续空白被归一化后仍然定位到真实选中文本', () => {
    const dom = new JSDOM('<article></article>', { url: 'http://localhost/' });
    Object.assign(globalThis, {
      document: dom.window.document,
      NodeFilter: dom.window.NodeFilter,
    });
    const article = document.createElement('article');
    article.textContent = [
      '前置说明',
      '',
      '    缩进内容会制造连续空白',
      '',
      '8.2 整改流程',
      '门店接收问题单',
      '门店完成整改并上传凭证',
      '督导复检',
      '通过则关闭，未通过则退回整改',
      '8.3 AI 辅助流程',
      '用户上传图片',
      'AI 返回识别标签',
      '用户确认结果',
      '系统自动关联巡检项或问题单',
    ].join('\n');

    const selectedText = [
      '用户上传图片',
      'AI 返回识别标签',
      '用户确认结果',
      '系统自动关联巡检项或问题单',
    ].join('\n');

    expect(findTextRange(article, selectedText)?.toString()).toBe(selectedText);
  });

  it('有锚点时优先回到重复文本里的原始选区位置', () => {
    const dom = new JSDOM('<article></article>', { url: 'http://localhost/' });
    Object.assign(globalThis, {
      document: dom.window.document,
      NodeFilter: dom.window.NodeFilter,
    });
    const article = document.createElement('article');
    article.innerHTML = [
      '<p>第一处：<strong>快递管理页面中误导运营人员</strong></p>',
      '<p>第二处：<strong>快递管理页面中误导运营人员</strong></p>',
    ].join('');

    const secondTextNode = article.querySelectorAll('strong')[1]?.firstChild as Text;
    const selectionRange = document.createRange();
    selectionRange.setStart(secondTextNode, 0);
    selectionRange.setEnd(secondTextNode, secondTextNode.data.length);

    const anchor = buildTextRangeAnchor(article, selectionRange);
    const restoredRange = findTextRange(
      article,
      '快递管理页面中误导运营人员',
      anchor
    );

    expect(restoredRange?.startContainer).toBe(secondTextNode);
    expect(restoredRange?.toString()).toBe('快递管理页面中误导运营人员');
  });

  it('跨 Markdown inline 节点的标注拆成单文本节点范围用于稳定高亮', () => {
    const dom = new JSDOM('<article></article>', { url: 'http://localhost/' });
    Object.assign(globalThis, {
      document: dom.window.document,
      NodeFilter: dom.window.NodeFilter,
    });
    const article = document.createElement('article');
    article.innerHTML =
      '<p>当前 GLS 委托中心 — 快递管理页面中，<strong>手工导入快递数据时无法校验运单号的真实性</strong>。操作人员通过 Excel</p>';

    const selectedText = '页面中，手工导入快递数据时无法校验运单号的真实性。';
    const ranges = findTextHighlightRanges(article, selectedText);

    expect(ranges.map((range) => range.toString()).join('')).toBe(selectedText);
    expect(ranges.length).toBeGreaterThan(1);
    expect(
      ranges.every((range) => range.startContainer === range.endContainer)
    ).toBe(true);
  });

  it('标题后紧跟表格时，仍能精确恢复标题中的局部选区', () => {
    const dom = new JSDOM('<article></article>', { url: 'http://localhost/' });
    Object.assign(globalThis, {
      document: dom.window.document,
      NodeFilter: dom.window.NodeFilter,
    });
    const article = document.createElement('article');
    article.innerHTML = [
      '<h1>OTP城配系统 — 司机端APP与移动工作台</h1>',
      '<table><tbody><tr><td>字段</td><td>内容</td></tr></tbody></table>',
    ].join('');

    const headingTextNode = article.querySelector('h1')?.firstChild as Text;
    const selectedText = '城配系统 — 司机端APP与移';
    const selectionRange = document.createRange();
    const startOffset = headingTextNode.data.indexOf(selectedText);
    selectionRange.setStart(headingTextNode, startOffset);
    selectionRange.setEnd(headingTextNode, startOffset + selectedText.length);

    const anchor = buildTextRangeAnchor(article, selectionRange, selectedText);
    const restoredRange = findTextRange(article, selectedText, anchor);

    expect(anchor).not.toBeNull();
    expect(restoredRange?.toString()).toBe(selectedText);
    expect(restoredRange?.startContainer).toBe(headingTextNode);
    expect(restoredRange?.endContainer).toBe(headingTextNode);
    expect(restoredRange?.startOffset).toBe(startOffset);
    expect(restoredRange?.endOffset).toBe(startOffset + selectedText.length);
  });

  it('跨块标注在没有 DOM 路径锚点时，也会拆成多个可见高亮片段', () => {
    const dom = new JSDOM('<article></article>', { url: 'http://localhost/' });
    Object.assign(globalThis, {
      document: dom.window.document,
      NodeFilter: dom.window.NodeFilter,
    });
    const article = document.createElement('article');
    article.innerHTML = [
      '<h3>1.1业务背景</h3>',
      '<div>随着 DeepSeek 等大模型 API 的广泛使用，企业和开发者的 API 调用量呈指数级增长。</div>',
    ].join('');

    const selectedText = '务背景 随着 DeepSeek 等大模型 API 的广泛使用';
    const restoredRange = findTextRange(article, selectedText, null);
    const ranges = findTextHighlightRanges(article, selectedText, null);

    expect(restoredRange).not.toBeNull();
    expect(ranges.length).toBeGreaterThan(1);
    expect(ranges[0]?.toString()).toContain('务背景');
    expect(ranges[1]?.toString()).toContain('随着 DeepSeek');
    expect(collapseWhitespace(ranges.map((range) => range.toString()).join(' '))).toBe(selectedText);
  });
});
