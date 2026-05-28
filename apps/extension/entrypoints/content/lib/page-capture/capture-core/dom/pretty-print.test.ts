import { describe, expect, it } from 'vitest';
import { prettyPrintHtml } from './pretty-print';

describe('prettyPrintHtml', () => {
  it('does not inject formatting whitespace between inline-layout-sensitive siblings', () => {
    const doc = document.implementation.createHTMLDocument('capture');
    doc.body.innerHTML = '';

    const wrap = doc.createElement('div');
    wrap.className = 'side-bar-btn-wrap';

    const search = doc.createElement('div');
    search.className = 'side-bar-search';

    const button = doc.createElement('button');
    button.className = 'side-bar-open-btn';
    button.textContent = 'toggle';

    wrap.appendChild(search);
    wrap.appendChild(button);
    doc.body.appendChild(wrap);

    const html = prettyPrintHtml(doc);

    expect(html).toContain(
      '<div class="side-bar-btn-wrap"><div class="side-bar-search"></div><button class="side-bar-open-btn">toggle</button></div>'
    );
  });
});
