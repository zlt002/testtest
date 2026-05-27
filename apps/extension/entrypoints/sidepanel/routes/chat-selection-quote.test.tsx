// @vitest-environment node

import { describe, expect, it } from 'vitest';
import { appendChatSelectionQuote } from '../lib/chat-selection-quote';

describe('appendChatSelectionQuote', () => {
  it('空输入框时直接插入引用块', () => {
    expect(appendChatSelectionQuote('', '  第一行\n第二行  ')).toBe(
      '补充上下文：\n“第一行\n第二行”'
    );
  });

  it('已有输入框内容时先去尾空白再追加两个换行和引用块', () => {
    expect(appendChatSelectionQuote('已有内容  \n', '  选中文本  ')).toBe(
      '已有内容\n\n补充上下文：\n“选中文本”'
    );
  });
});
