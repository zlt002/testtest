import { describe, expect, it } from 'vitest';
import { cloneCaptureRoot, normalizeCapturedDocument } from './dom-clone';

describe('capture dom clone', () => {
  it('clones full document body for page mode', () => {
    document.documentElement.innerHTML =
      '<head><title>测试页面</title></head><body><main><section>内容</section></main></body>';

    const root = cloneCaptureRoot(document, { mode: 'page' });

    expect(root.querySelector('section')?.textContent).toBe('内容');
    expect(root.title).toBe('测试页面');
  });

  it('keeps only the picked element for element mode', () => {
    document.body.innerHTML = '<main><p id="keep">保留</p><p>忽略</p></main>';
    const target = document.getElementById('keep');

    const root = cloneCaptureRoot(document, { mode: 'element', targetElement: target });

    expect(root.body.textContent).toContain('保留');
    expect(root.body.textContent).not.toContain('忽略');
  });

  it('removes executable scripts and normalizes lazy images', () => {
    document.body.innerHTML =
      '<script src="https://example.com/app.js"></script><main><img data-src="/lazy.png"></main>';

    const clone = normalizeCapturedDocument(document);

    expect(clone.querySelector('script')).toBeNull();
    expect(clone.querySelector('img')?.getAttribute('src')).toBe('/lazy.png');
  });
});
