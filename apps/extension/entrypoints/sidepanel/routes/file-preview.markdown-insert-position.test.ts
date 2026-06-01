// @vitest-environment node

import { JSDOM } from 'jsdom';
import { describe, expect, it } from 'vitest';
import {
  buildMarkdownFloatingImageInsertTarget,
  buildMarkdownInsertTargetFromNode,
  resolveMarkdownInsertOffset,
} from './file-preview.markdown-insert-position';

function setup(html: string) {
  const dom = new JSDOM(`<article>${html}</article>`, { url: 'http://localhost/' });
  Object.assign(globalThis, {
    document: dom.window.document,
    NodeFilter: dom.window.NodeFilter,
  });
  return dom.window.document.querySelector('article') as HTMLElement;
}

describe('markdown insert position resolver', () => {
  it('resolves a paragraph target to the end of the matching markdown paragraph', () => {
    const article = setup('<p>第一段内容</p><p>第二段内容</p>');
    const source = '第一段内容\n\n第二段内容';
    const target = buildMarkdownInsertTargetFromNode(article, article.querySelectorAll('p')[0]);

    expect(resolveMarkdownInsertOffset(source, target)).toEqual({
      ok: true,
      offset: '第一段内容'.length,
    });
  });

  it('resolves a text node inside a paragraph', () => {
    const article = setup('<p>安得智联-技术中心</p>');
    const textNode = article.querySelector('p')!.firstChild!;
    const target = buildMarkdownInsertTargetFromNode(article, textNode);

    expect(resolveMarkdownInsertOffset('安得智联-技术中心', target)).toEqual({
      ok: true,
      offset: '安得智联-技术中心'.length,
    });
  });

  it('resolves heading, list, and table cell text', () => {
    const article = setup(
      '<h2>目标用户</h2><ul><li>调度员</li></ul><table><tbody><tr><td>核心诉求</td></tr></tbody></table>'
    );
    const source = '## 目标用户\n\n- 调度员\n\n| 字段 |\n| --- |\n| 核心诉求 |';

    expect(
      resolveMarkdownInsertOffset(
        source,
        buildMarkdownInsertTargetFromNode(article, article.querySelector('h2')!)
      )
    ).toEqual({ ok: true, offset: '## 目标用户'.length });
    expect(
      resolveMarkdownInsertOffset(
        source,
        buildMarkdownInsertTargetFromNode(article, article.querySelector('li')!)
      )
    ).toEqual({ ok: true, offset: '## 目标用户\n\n- 调度员'.length });
    expect(
      resolveMarkdownInsertOffset(
        source,
        buildMarkdownInsertTargetFromNode(article, article.querySelector('td')!)
      )
    ).toEqual({ ok: true, offset: source.length });
  });

  it('inserts after the whole table when clicking text inside a table cell', () => {
    const article = setup(
      '<p>上文</p><table><tbody><tr><td>单元格一</td><td>单元格二</td></tr><tr><td>单元格三</td><td>单元格四</td></tr></tbody></table><p>下文</p>'
    );
    const source = [
      '上文',
      '',
      '| 列一 | 列二 |',
      '| --- | --- |',
      '| 单元格一 | 单元格二 |',
      '| 单元格三 | 单元格四 |',
      '',
      '下文',
    ].join('\n');

    expect(
      resolveMarkdownInsertOffset(
        source,
        buildMarkdownInsertTargetFromNode(article, article.querySelector('td')!.firstChild!)
      )
    ).toEqual({
      ok: true,
      offset: source.indexOf('\n\n下文'),
    });
  });

  it('allows tbody and row targets to resolve to the end of the whole table', () => {
    const article = setup(
      '<p>上文</p><table><tbody><tr><td>单元格一</td><td>单元格二</td></tr><tr><td>单元格三</td><td>单元格四</td></tr></tbody></table>'
    );
    const source = [
      '上文',
      '',
      '| 列一 | 列二 |',
      '| --- | --- |',
      '| 单元格一 | 单元格二 |',
      '| 单元格三 | 单元格四 |',
    ].join('\n');

    expect(
      resolveMarkdownInsertOffset(
        source,
        buildMarkdownInsertTargetFromNode(article, article.querySelector('tbody')!)
      )
    ).toEqual({
      ok: true,
      offset: source.length,
    });

    expect(
      resolveMarkdownInsertOffset(
        source,
        buildMarkdownInsertTargetFromNode(article, article.querySelector('tr')!)
      )
    ).toEqual({
      ok: true,
      offset: source.length,
    });
  });

  it('resolves a GFM table without leading or trailing pipes to the end of the whole table', () => {
    const article = setup('<table><tbody><tr><td>单元格一</td><td>单元格二</td></tr></tbody></table>');
    const source = ['列一 | 列二', '--- | ---', '单元格一 | 单元格二', '', '下文'].join('\n');

    expect(
      resolveMarkdownInsertOffset(
        source,
        buildMarkdownInsertTargetFromNode(article, article.querySelector('table')!)
      )
    ).toEqual({
      ok: true,
      offset: source.indexOf('\n\n下文'),
    });

    expect(
      resolveMarkdownInsertOffset(
        source,
        buildMarkdownInsertTargetFromNode(article, article.querySelector('td')!.firstChild!)
      )
    ).toEqual({
      ok: true,
      offset: source.indexOf('\n\n下文'),
    });
  });

  it('fails when target text appears more than once', () => {
    const article = setup('<p>重复内容</p><p>重复内容</p>');
    const target = buildMarkdownInsertTargetFromNode(article, article.querySelector('p')!);

    expect(resolveMarkdownInsertOffset('重复内容\n\n重复内容', target)).toEqual({
      ok: false,
      message: '当前位置无法唯一定位，请换一个插入位置',
    });
  });

  it('resolves duplicate body text to the end of the clicked body paragraph', () => {
    const article = setup('<blockquote><p>重复内容</p></blockquote><p>重复内容</p><p>总结</p>');
    const source = ['> 重复内容', '', '重复内容', '', '总结'].join('\n');
    const target = buildMarkdownInsertTargetFromNode(article, article.querySelectorAll('p')[1]!);

    expect(resolveMarkdownInsertOffset(source, target)).toEqual({
      ok: true,
      offset: source.indexOf('\n\n总结'),
    });
  });

  it('resolves duplicate text inside a blockquote to the end of the blockquote markdown', () => {
    const article = setup('<blockquote><p>重复内容</p></blockquote><p>重复内容</p><p>总结</p>');
    const source = ['> 重复内容', '', '重复内容', '', '总结'].join('\n');
    const target = buildMarkdownInsertTargetFromNode(article, article.querySelector('blockquote p')!);

    expect(resolveMarkdownInsertOffset(source, target)).toEqual({
      ok: true,
      offset: source.indexOf('\n\n重复内容'),
    });
  });

  it('rejects code blocks and mermaid blocks', () => {
    const article = setup('<pre><code>const a = 1</code></pre><div data-mermaid-root="true">graph TD</div>');
    expect(buildMarkdownInsertTargetFromNode(article, article.querySelector('code')!)).toEqual({
      ok: false,
      message: '当前位置暂不支持插入图片，请点到正文段落、标题、列表或表格单元格中',
    });
    expect(buildMarkdownInsertTargetFromNode(article, article.querySelector('[data-mermaid-root]')!)).toEqual({
      ok: false,
      message: '当前位置暂不支持插入图片，请点到正文段落、标题、列表或表格单元格中',
    });
  });

  it('builds a floating image insert target from a supported hovered node', () => {
    const article = setup('<h2>二、背景与目标</h2>');
    const heading = article.querySelector('h2')!;
    heading.getBoundingClientRect = () =>
      ({
        left: 120,
        top: 240,
        right: 520,
        bottom: 280,
        width: 400,
        height: 40,
        x: 120,
        y: 240,
        toJSON: () => undefined,
      }) as DOMRect;

    expect(
      buildMarkdownFloatingImageInsertTarget({
        root: article,
        node: heading.firstChild!,
        source: '## 二、背景与目标',
        viewportWidth: 800,
      })
    ).toEqual({
      ok: true,
      offset: '## 二、背景与目标'.length,
      x: 528,
      y: 248,
    });
  });
});
