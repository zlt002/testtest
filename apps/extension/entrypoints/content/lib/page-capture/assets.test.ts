import { describe, expect, it } from 'vitest';
import { collectAssetCandidates, rewriteAssetUrls } from './assets';

describe('capture assets', () => {
  it('collects img and stylesheet assets', async () => {
    document.head.innerHTML = '<link rel="stylesheet" href="/styles/app.css">';
    document.body.innerHTML =
      '<img src="/images/a.png"><img data-src="/images/lazy.png"><div style="background-image:url(/images/bg.png)"></div>';

    const assets = await collectAssetCandidates(document, new URL('https://example.com/post'));
    const urls = assets.map((asset) => asset.sourceUrl).sort();

    expect(urls).toContain('https://example.com/styles/app.css');
    expect(urls).toContain('https://example.com/images/a.png');
    expect(urls).toContain('https://example.com/images/lazy.png');
    expect(urls).toContain('https://example.com/images/bg.png');
  });

  it('rewrites element urls to relative asset paths', () => {
    document.head.innerHTML = '<link rel="stylesheet" href="https://example.com/styles/app.css">';
    document.body.innerHTML =
      '<img src="https://example.com/images/a.png"><div style="background-image:url(https://example.com/images/bg.png)"></div>';

    rewriteAssetUrls(
      document,
      new Map([
        ['https://example.com/styles/app.css', 'assets/styles/app.css'],
        ['https://example.com/images/a.png', 'assets/images/a.png'],
        ['https://example.com/images/bg.png', 'assets/images/bg.png'],
      ]),
      new URL('https://example.com/post')
    );

    expect(document.querySelector('link')?.getAttribute('href')).toBe('assets/styles/app.css');
    expect(document.querySelector('img')?.getAttribute('src')).toBe('assets/images/a.png');
    expect(document.querySelector('div')?.getAttribute('style')).toContain('assets/images/bg.png');
  });
});
