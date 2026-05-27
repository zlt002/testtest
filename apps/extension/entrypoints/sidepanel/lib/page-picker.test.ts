// @vitest-environment node

import { describe, expect, it } from 'vitest';
import {
  formatPickedElementContext,
  insertPickedElementBlock,
  type PickedElementContext,
} from './page-picker';

const sampleContext: PickedElementContext = {
  url: 'https://example.com/search?q=ccswitch',
  selector: '#content .result:nth-of-type(1)',
  xpath: '//*[@id="content"]/div[1]',
  tagName: 'div',
  id: 'result-1',
  classList: ['result', 'result-op'],
  dataAttributes: { log: '123' },
  text: 'CC-Switch配置切换神器',
  rect: { x: 120, y: 240, width: 640, height: 180 },
  outerHTMLSnippet: '<div class="result result-op">...</div>',
  ancestors: [
    { tagName: 'div', id: 'content', classList: [] },
    { tagName: 'main', id: null, classList: ['page-root'] },
  ],
  siblings: {
    previous: '搜索框区域',
    next: '相关推荐卡片',
  },
};

const expectedSampleBlock = `[页面元素定位]
url: https://example.com/search?q=ccswitch
selector: #content .result:nth-of-type(1)
xpath: //*[@id="content"]/div[1]
tag: div
id: result-1
classList: result result-op
dataAttributes:
- data-log="123"
text: CC-Switch配置切换神器
rect: x=120,y=240,w=640,h=180
outerHTML: <div class="result result-op">...</div>
ancestors:
- div#content
- main.page-root
siblings:
- prev: 搜索框区域
- next: 相关推荐卡片
[/页面元素定位]`;

describe('formatPickedElementContext', () => {
  it('formats the full structured block for the composer', () => {
    expect(formatPickedElementContext(sampleContext)).toBe(expectedSampleBlock);
  });

  it('falls back gracefully for missing selector, text, ancestors, siblings, and attributes', () => {
    expect(
      formatPickedElementContext({
        ...sampleContext,
        selector: null,
        xpath: null,
        id: null,
        classList: [],
        dataAttributes: {},
        text: null,
        outerHTMLSnippet: null,
        ancestors: [],
        siblings: {
          previous: null,
          next: null,
        },
      })
    ).toBe(`[页面元素定位]
url: https://example.com/search?q=ccswitch
selector: (unavailable)
xpath: (unavailable)
tag: div
id: (none)
classList: (none)
dataAttributes:
- (none)
text: (empty)
rect: x=120,y=240,w=640,h=180
outerHTML: (unavailable)
ancestors:
- (none)
siblings:
- prev: (none)
- next: (none)
[/页面元素定位]`);
  });
});

describe('insertPickedElementBlock', () => {
  it('appends a block after existing text with a separating blank line', () => {
    const next = insertPickedElementBlock('请帮我修改这里', sampleContext);

    expect(next).toBe(`请帮我修改这里\n\n${expectedSampleBlock}`);
  });

  it('returns only the block when the composer is empty', () => {
    const next = insertPickedElementBlock('', sampleContext);

    expect(next).toBe(expectedSampleBlock);
  });

  it('normalizes trailing whitespace before appending the block', () => {
    const next = insertPickedElementBlock('请帮我修改这里   \n\n', sampleContext);

    expect(next).toBe(`请帮我修改这里\n\n${expectedSampleBlock}`);
    expect(next.endsWith('[/页面元素定位]')).toBe(true);
  });
});
