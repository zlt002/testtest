import { describe, expect, it } from 'vitest';
import { SOURCE_INDEX_ATTRIBUTE } from './clone';
import { inlineComputedLayoutStyles } from './computed-styles';

describe('inlineComputedLayoutStyles', () => {
  it('copies minimal computed layout styles for flex containers only', () => {
    document.head.innerHTML = `
      <style>
        .runtime-card {
          display: flex;
          gap: 12px;
          margin: 8px 4px;
          padding: 10px;
          font-size: 18px;
          line-height: 24px;
          overflow: hidden;
        }
      </style>
    `;
    document.body.innerHTML = '<section class="runtime-card">card</section>';

    const capturedDoc = document.implementation.createHTMLDocument('capture');
    capturedDoc.body.innerHTML = `<section ${SOURCE_INDEX_ATTRIBUTE}="0">card</section>`;

    inlineComputedLayoutStyles(capturedDoc, document);

    const capturedCard = capturedDoc.querySelector('section') as HTMLElement;
    expect(capturedCard.style.display).toBe('flex');
    expect(capturedCard.style.gap).toBe('12px');
    expect(capturedCard.style.fontSize).toBe('');
    expect(capturedCard.style.lineHeight).toBe('');
    expect(capturedCard.style.overflow).toBe('');
  });

  it('preserves existing inline styles and only fills missing structural properties', () => {
    document.head.innerHTML = `
      <style>
        .runtime-grid {
          display: grid;
          gap: 16px;
          grid-template-columns: 1fr 1fr;
        }
      </style>
    `;
    document.body.innerHTML = '<section class="runtime-grid">grid</section>';

    const capturedDoc = document.implementation.createHTMLDocument('capture');
    capturedDoc.body.innerHTML =
      `<section ${SOURCE_INDEX_ATTRIBUTE}="0" style="display:block">grid</section>`;

    inlineComputedLayoutStyles(capturedDoc, document);

    const capturedCard = capturedDoc.querySelector('section') as HTMLElement;
    expect(capturedCard.style.display).toBe('block');
    expect(capturedCard.style.gap).toBe('16px');
    expect(capturedCard.style.gridTemplateColumns).toBe('1fr 1fr');
  });
});
