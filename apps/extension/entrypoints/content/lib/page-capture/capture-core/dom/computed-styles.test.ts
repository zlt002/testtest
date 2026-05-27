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

  it('copies key box-model layout properties without inlining unrelated typography styles', () => {
    document.head.innerHTML = `
      <style>
        .runtime-panel {
          width: 320px;
          min-height: 180px;
          padding: 12px 20px;
          box-sizing: border-box;
          position: absolute;
          font-size: 20px;
          line-height: 28px;
        }
      </style>
    `;
    document.body.innerHTML = '<section class="runtime-panel">panel</section>';

    const capturedDoc = document.implementation.createHTMLDocument('capture');
    capturedDoc.body.innerHTML = `<section ${SOURCE_INDEX_ATTRIBUTE}="0">panel</section>`;

    inlineComputedLayoutStyles(capturedDoc, document);

    const capturedPanel = capturedDoc.querySelector('section') as HTMLElement;
    expect(capturedPanel.style.width).toBe('320px');
    expect(capturedPanel.style.minHeight).toBe('180px');
    expect(capturedPanel.style.padding).toBe('12px 20px');
    expect(capturedPanel.style.boxSizing).toBe('border-box');
    expect(capturedPanel.style.fontSize).toBe('');
    expect(capturedPanel.style.lineHeight).toBe('');
  });

  it('copies transform-related layout properties and white-space when needed', () => {
    document.head.innerHTML = `
      <style>
        .runtime-offset {
          transform: translateX(24px) scale(0.9);
          transform-origin: right top;
          white-space: nowrap;
        }
      </style>
    `;
    document.body.innerHTML = '<section class="runtime-offset">offset</section>';

    const capturedDoc = document.implementation.createHTMLDocument('capture');
    capturedDoc.body.innerHTML = `<section ${SOURCE_INDEX_ATTRIBUTE}="0">offset</section>`;

    inlineComputedLayoutStyles(capturedDoc, document);

    const capturedOffset = capturedDoc.querySelector('section') as HTMLElement;
    expect(capturedOffset.style.transform).toBe('translateX(24px) scale(0.9)');
    expect(capturedOffset.style.transformOrigin).toBe('right top');
    expect(capturedOffset.style.whiteSpace).toBe('nowrap');
  });

  it('does not override existing inline layout properties while filling missing ones', () => {
    document.head.innerHTML = `
      <style>
        .runtime-drawer {
          width: 320px;
          min-height: 180px;
          padding: 16px 24px;
          box-sizing: border-box;
          transform: translateX(24px);
          transform-origin: right top;
          white-space: nowrap;
        }
      </style>
    `;
    document.body.innerHTML = '<aside class="runtime-drawer">drawer</aside>';

    const capturedDoc = document.implementation.createHTMLDocument('capture');
    capturedDoc.body.innerHTML = `
      <aside
        ${SOURCE_INDEX_ATTRIBUTE}="0"
        style="width: 240px; padding: 4px; transform: rotate(5deg); white-space: pre-wrap"
      >
        drawer
      </aside>
    `;

    inlineComputedLayoutStyles(capturedDoc, document);

    const capturedDrawer = capturedDoc.querySelector('aside') as HTMLElement;
    expect(capturedDrawer.style.width).toBe('240px');
    expect(capturedDrawer.style.padding).toBe('4px');
    expect(capturedDrawer.style.transform).toBe('rotate(5deg)');
    expect(capturedDrawer.style.whiteSpace).toBe('pre-wrap');
    expect(capturedDrawer.style.minHeight).toBe('180px');
    expect(capturedDrawer.style.boxSizing).toBe('border-box');
    expect(capturedDrawer.style.transformOrigin).toBe('right top');
  });

  it('does not inline fixed width for plain flow content without an explicit layout context', () => {
    document.head.innerHTML = `
      <style>
        .runtime-copy {
          width: 480px;
          min-height: 180px;
          padding: 12px 20px;
          box-sizing: border-box;
        }
      </style>
    `;
    document.body.innerHTML = '<div class="runtime-copy">copy</div>';

    const capturedDoc = document.implementation.createHTMLDocument('capture');
    capturedDoc.body.innerHTML = `<div ${SOURCE_INDEX_ATTRIBUTE}="0">copy</div>`;

    inlineComputedLayoutStyles(capturedDoc, document);

    const capturedCopy = capturedDoc.querySelector('div') as HTMLElement;
    expect(capturedCopy.style.width).toBe('');
    expect(capturedCopy.style.minHeight).toBe('180px');
    expect(capturedCopy.style.padding).toBe('12px 20px');
    expect(capturedCopy.style.boxSizing).toBe('border-box');
  });

  it('does not write padding shorthand when inline padding longhands already exist', () => {
    document.head.innerHTML = `
      <style>
        .runtime-panel {
          width: 320px;
          min-height: 180px;
          padding: 12px 20px;
          box-sizing: border-box;
          position: absolute;
        }
      </style>
    `;
    document.body.innerHTML = '<section class="runtime-panel">panel</section>';

    const capturedDoc = document.implementation.createHTMLDocument('capture');
    capturedDoc.body.innerHTML = `
      <section ${SOURCE_INDEX_ATTRIBUTE}="0" style="padding-left: 4px">
        panel
      </section>
    `;

    inlineComputedLayoutStyles(capturedDoc, document);

    const capturedPanel = capturedDoc.querySelector('section') as HTMLElement;
    expect(capturedPanel.style.padding).toBe('');
    expect(capturedPanel.style.paddingLeft).toBe('4px');
    expect(capturedPanel.style.width).toBe('320px');
    expect(capturedPanel.style.minHeight).toBe('180px');
    expect(capturedPanel.style.boxSizing).toBe('border-box');
  });
});
