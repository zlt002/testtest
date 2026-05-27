import { describe, expect, it } from 'vitest';
import { clonePageDocument } from './clone';
import { replaceResourceElementsWithPlaceholders } from './placeholders';

describe('capture-core placeholders', () => {
  it('replaces visible resource elements with bordered X placeholders and preserves dimensions', () => {
    document.body.innerHTML = `
      <img id="hero" src="/hero.png" width="320" height="180" class="rounded">
      <svg id="large-svg" width="64" height="64"><path d="M0 0h24v24H0z"></path></svg>
      <video id="movie" width="400" height="225" src="/movie.mp4"></video>
      <canvas id="chart" width="600" height="300"></canvas>
    `;

    replaceResourceElementsWithPlaceholders(document);

    const placeholders = Array.from(
      document.querySelectorAll('[data-webmcp-placeholder="resource"]')
    );
    expect(placeholders).toHaveLength(4);
    expect(placeholders[0]?.textContent).toContain('X');
    expect((placeholders[0] as HTMLElement).style.width).toBe('320px');
    expect((placeholders[0] as HTMLElement).style.height).toBe('180px');
    expect(placeholders[0]?.className).toContain('rounded');
    expect(document.querySelector('img')).toBeNull();
    expect(document.querySelector('video')).toBeNull();
    expect(document.querySelector('canvas')).toBeNull();
  });

  it('preserves small inline SVG icons as UI content', () => {
    document.body.innerHTML = `
      <svg id="icon" width="24" height="24"><path d="M0 0h24v24H0z"></path></svg>
      <img id="small-image" width="16" height="16" src="/icon.png">
    `;

    replaceResourceElementsWithPlaceholders(document);

    expect(document.querySelector('svg#icon')).not.toBeNull();
    expect(document.querySelector('img#small-image')).toBeNull();
    expect(document.querySelectorAll('[data-webmcp-placeholder="resource"]')).toHaveLength(1);
  });

  it('falls back for non-pixel or zero dimensions and protects placeholder layout styles', () => {
    document.body.innerHTML = `
      <img id="relative" src="/relative.png" width="50%" height="0" class="hidden-by-site">
      <svg id="styled" style="width: 64px; height: 32px"><path d="M0 0h24v24H0z"></path></svg>
    `;

    replaceResourceElementsWithPlaceholders(document);

    const placeholders = Array.from(
      document.querySelectorAll<HTMLElement>('[data-webmcp-placeholder="resource"]')
    );
    expect(placeholders).toHaveLength(2);
    expect(placeholders[0]?.style.width).toBe('120px');
    expect(placeholders[0]?.style.height).toBe('80px');
    expect(placeholders[0]?.style.getPropertyPriority('display')).toBe('important');
    expect(placeholders[0]?.style.getPropertyPriority('width')).toBe('important');
    expect(placeholders[1]?.style.width).toBe('64px');
    expect(placeholders[1]?.style.height).toBe('32px');
  });

  it('prefers rendered dimensions from the original document', () => {
    document.body.innerHTML = `
      <img id="css-sized" src="/css-sized.png" class="logo-icon">
    `;
    const capturedDoc = clonePageDocument(document);
    const originalImage = document.getElementById('css-sized') as HTMLImageElement;
    originalImage.getBoundingClientRect = () =>
      ({
        width: 28,
        height: 16,
        top: 0,
        right: 28,
        bottom: 16,
        left: 0,
        x: 0,
        y: 0,
        toJSON: () => ({}),
      }) as DOMRect;

    replaceResourceElementsWithPlaceholders(capturedDoc, document);

    const placeholder = capturedDoc.querySelector<HTMLElement>(
      '[data-webmcp-placeholder="resource"]'
    );
    expect(placeholder?.style.width).toBe('28px');
    expect(placeholder?.style.height).toBe('16px');
  });
});
