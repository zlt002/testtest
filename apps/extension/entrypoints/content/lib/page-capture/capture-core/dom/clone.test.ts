import { describe, expect, it } from 'vitest';
import { clonePageDocument } from './clone';

describe('capture-core clone', () => {
  it('preserves document and body attributes used by theme selectors', () => {
    document.documentElement.setAttribute('lang', 'zh-CN');
    document.documentElement.setAttribute('data-vxe-ui-theme', 'light');
    document.body.className = 'otp-body';
    document.body.setAttribute('data-theme', 'default');
    document.body.innerHTML = '<main>content</main>';

    const clone = clonePageDocument(document);

    expect(clone.documentElement.getAttribute('lang')).toBe('zh-CN');
    expect(clone.documentElement.getAttribute('data-vxe-ui-theme')).toBe('light');
    expect(clone.body.className).toBe('otp-body');
    expect(clone.body.getAttribute('data-theme')).toBe('default');
  });

  it('materializes open shadow-root style nodes into the cloned host element', () => {
    document.body.innerHTML =
      '<micro-app id="host"><micro-app-body><div>content</div></micro-app-body></micro-app>';
    const host = document.getElementById('host') as HTMLElement;
    const shadowRoot = host.attachShadow({ mode: 'open' });
    shadowRoot.innerHTML = `
      <micro-app-head>
        <style data-origin-href="https://example.com/a.css">#pane { color: red; }</style>
      </micro-app-head>
      <div class="ignored">ignored</div>
    `;

    const clone = clonePageDocument(document);
    const cloneHost = clone.getElementById('host');

    expect(cloneHost?.querySelector('micro-app-head style')?.textContent).toContain('#pane');
    expect(cloneHost?.querySelector('.ignored')).toBeNull();
  });
});
