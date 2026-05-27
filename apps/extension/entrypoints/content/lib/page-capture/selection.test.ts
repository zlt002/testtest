import { describe, expect, it } from 'vitest';
import { cloneElementFragment, summarizeElementText } from './selection';

describe('element capture', () => {
  it('keeps selected subtree with required ancestors', () => {
    document.body.innerHTML =
      '<main><article><h1>标题</h1><p id="target">正文<span>片段</span></p></article></main>';
    const target = document.getElementById('target');

    expect(target).not.toBeNull();

    const fragment = cloneElementFragment(document, target as Element);

    expect(fragment.querySelector('main')).not.toBeNull();
    expect(fragment.querySelector('article')).not.toBeNull();
    expect(fragment.textContent).toContain('正文片段');
  });

  it('builds a compact element summary', () => {
    document.body.innerHTML = '<p id="target">  第一段 </p><p>第二段</p>';
    const target = document.getElementById('target');

    expect(target).not.toBeNull();

    expect(summarizeElementText(target as Element)).toBe('第一段');
  });
});
