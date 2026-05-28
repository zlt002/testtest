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

  it('preserves live DOM nesting without reparsing body markup', () => {
    document.body.innerHTML = '';

    const header = document.createElement('header');
    header.className = 'app-header';

    const toolbar = document.createElement('div');
    toolbar.className = 'header-icon-button';

    const userButton = document.createElement('button');
    userButton.type = 'button';
    userButton.className = 'el-button user-name';
    userButton.textContent = 'Logistics Cloud';

    const iconButton = document.createElement('button');
    iconButton.type = 'button';
    iconButton.className = 'el-button icon-button';
    iconButton.textContent = '消息';

    // 这类 live DOM 用 DOM API 可以存在，但一旦走 innerHTML 重解析，
    // parser 会按 button 内容模型重写结构，导致后续节点被弹出原容器。
    userButton.appendChild(iconButton);
    toolbar.appendChild(userButton);
    header.appendChild(toolbar);
    document.body.appendChild(header);

    const clone = clonePageDocument(document);
    const clonedToolbar = clone.querySelector('.header-icon-button');
    const clonedButton = clone.querySelector('.el-button.user-name');
    const clonedIconButton = clone.querySelector('.el-button.icon-button');

    expect(clonedToolbar?.querySelector('.icon-button')).not.toBeNull();
    expect(clonedButton?.querySelector('.icon-button')).not.toBeNull();
    expect(clonedIconButton?.parentElement).toBe(clonedButton);
    expect(clonedToolbar?.nextElementSibling).toBeNull();
  });
});
