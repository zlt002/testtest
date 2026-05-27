import type { CaptureAssetDraft, CaptureAssetKind } from './types';

const URL_FUNCTION_PATTERN = /url\((['"]?)(.*?)\1\)/gi;
const SRCSET_SPLIT_PATTERN = /\s*,\s*/;

function resolveUrl(url: string, baseUrl: URL): string | null {
  if (!url || url.startsWith('data:') || url.startsWith('blob:') || url.startsWith('#')) {
    return null;
  }

  try {
    return new URL(url, baseUrl).href;
  } catch {
    return null;
  }
}

function sanitizeFileName(value: string): string {
  return value.replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/^-+|-+$/g, '') || 'asset';
}

function inferAssetKind(sourceUrl: string): CaptureAssetKind {
  if (/\.(css)(\?|#|$)/i.test(sourceUrl)) return 'stylesheet';
  if (/\.(png|jpe?g|gif|webp|bmp|avif|ico)(\?|#|$)/i.test(sourceUrl)) return 'image';
  if (/\.(svg)(\?|#|$)/i.test(sourceUrl)) return 'svg';
  if (/\.(woff2?|ttf|otf|eot)(\?|#|$)/i.test(sourceUrl)) return 'font';
  if (/\.(mp4|webm|mp3|wav|ogg)(\?|#|$)/i.test(sourceUrl)) return 'media';
  return 'other';
}

function buildRelativePath(kind: CaptureAssetKind, sourceUrl: string, index: number): string {
  const url = new URL(sourceUrl);
  const fileName = sanitizeFileName(url.pathname.split('/').pop() || `${kind}-${index + 1}`);
  const folder =
    kind === 'stylesheet'
      ? 'styles'
      : kind === 'font'
        ? 'fonts'
        : kind === 'media'
          ? 'media'
          : 'images';

  return `assets/${folder}/${index + 1}-${fileName}`;
}

function collectStyleUrls(styleValue: string, baseUrl: URL): string[] {
  const urls: string[] = [];

  for (const match of styleValue.matchAll(URL_FUNCTION_PATTERN)) {
    const rawUrl = match[2]?.trim();
    if (!rawUrl) {
      continue;
    }

    const resolved = resolveUrl(rawUrl, baseUrl);
    if (resolved) {
      urls.push(resolved);
    }
  }

  return urls;
}

function collectStyleTagUrls(doc: Document, baseUrl: URL): string[] {
  const urls: string[] = [];
  for (const style of Array.from(doc.querySelectorAll('style'))) {
    urls.push(...collectStyleUrls(style.textContent || '', baseUrl));
  }
  return urls;
}

function collectSrcsetUrls(srcsetValue: string, baseUrl: URL): string[] {
  return srcsetValue
    .split(SRCSET_SPLIT_PATTERN)
    .map((candidate) => candidate.trim().split(/\s+/)[0] || '')
    .map((url) => resolveUrl(url, baseUrl))
    .filter((url): url is string => Boolean(url));
}

function rewriteSrcsetValue(
  srcsetValue: string,
  assetMap: Map<string, string>,
  baseUrl?: URL
): string {
  return srcsetValue
    .split(SRCSET_SPLIT_PATTERN)
    .map((candidate) => {
      const parts = candidate.trim().split(/\s+/);
      const rawUrl = parts[0] || '';
      const descriptor = parts.slice(1).join(' ');
      const resolved = baseUrl ? resolveUrl(rawUrl, baseUrl) : rawUrl;
      const replacement = (resolved && assetMap.get(resolved)) || assetMap.get(rawUrl) || rawUrl;
      return descriptor ? `${replacement} ${descriptor}` : replacement;
    })
    .join(', ');
}

function rewriteStyleValue(
  styleValue: string,
  assetMap: Map<string, string>,
  baseUrl: URL | undefined
): string {
  return styleValue.replace(URL_FUNCTION_PATTERN, (full, quote: string, rawUrl: string) => {
    const trimmed = rawUrl.trim();
    const resolved = baseUrl ? resolveUrl(trimmed, baseUrl) : trimmed;
    const replacement = resolved ? assetMap.get(resolved) : assetMap.get(trimmed);

    if (!replacement) {
      return full;
    }

    const nextQuote = quote || '';
    return `url(${nextQuote}${replacement}${nextQuote})`;
  });
}

function toBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  const chunkSize = 0x8000;
  for (let index = 0; index < bytes.length; index += chunkSize) {
    const chunk = bytes.subarray(index, index + chunkSize);
    binary += String.fromCharCode(...chunk);
  }
  return btoa(binary);
}

export function collectAssetCandidates(doc: Document, baseUrl: URL): CaptureAssetDraft[] {
  const urls = new Set<string>();

  for (const link of Array.from(doc.querySelectorAll('link[rel="stylesheet"]'))) {
    const href = link.getAttribute('href');
    const resolved = href ? resolveUrl(href, baseUrl) : null;
    if (resolved) {
      urls.add(resolved);
    }
  }

  for (const img of Array.from(doc.querySelectorAll('img'))) {
    const src =
      img.getAttribute('src') || img.getAttribute('data-src') || img.getAttribute('data-original');
    const resolved = src ? resolveUrl(src, baseUrl) : null;
    if (resolved) {
      urls.add(resolved);
    }

    const srcset = img.getAttribute('srcset');
    if (srcset) {
      for (const srcsetUrl of collectSrcsetUrls(srcset, baseUrl)) {
        urls.add(srcsetUrl);
      }
    }
  }

  for (const source of Array.from(doc.querySelectorAll('picture source, source[srcset]'))) {
    const srcset = source.getAttribute('srcset');
    if (!srcset) {
      continue;
    }

    for (const srcsetUrl of collectSrcsetUrls(srcset, baseUrl)) {
      urls.add(srcsetUrl);
    }
  }

  for (const element of Array.from(doc.querySelectorAll('[style]'))) {
    const styleValue = element.getAttribute('style') || '';
    for (const styleUrl of collectStyleUrls(styleValue, baseUrl)) {
      urls.add(styleUrl);
    }
  }

  for (const styleUrl of collectStyleTagUrls(doc, baseUrl)) {
    urls.add(styleUrl);
  }

  return Array.from(urls).map((sourceUrl, index) => {
    const kind = inferAssetKind(sourceUrl);
    return {
      id: `asset-${index + 1}`,
      kind,
      sourceUrl,
      mimeType: null,
      relativePath: buildRelativePath(kind, sourceUrl, index),
      contentBase64: '',
      inlineCandidate: false,
    };
  });
}

export async function hydrateAssetCandidates(assets: CaptureAssetDraft[]): Promise<{
  assets: CaptureAssetDraft[];
  warnings: Array<{ code: string; message: string; sourceUrl?: string }>;
}> {
  const warnings: Array<{ code: string; message: string; sourceUrl?: string }> = [];

  const hydratedAssets = await Promise.all(
    assets.map(async (asset) => {
      try {
        const response = await fetch(asset.sourceUrl);
        if (!response.ok) {
          throw new Error(`HTTP ${response.status}`);
        }

        const buffer = await response.arrayBuffer();
        return {
          ...asset,
          mimeType: response.headers.get('content-type') || asset.mimeType,
          contentBase64: toBase64(buffer),
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        warnings.push({
          code: 'asset_fetch_failed',
          message: `资源抓取失败：${message}`,
          sourceUrl: asset.sourceUrl,
        });
        return {
          ...asset,
          warning: message,
        };
      }
    })
  );

  return { assets: hydratedAssets, warnings };
}

export function rewriteAssetUrls(
  doc: Document,
  assetMap: Map<string, string>,
  baseUrl?: URL
): void {
  for (const link of Array.from(doc.querySelectorAll('link[rel="stylesheet"]'))) {
    const href = link.getAttribute('href');
    const resolved = href && baseUrl ? resolveUrl(href, baseUrl) : href;
    const nextHref =
      (resolved && assetMap.get(resolved)) || (href ? assetMap.get(href) : undefined);
    if (nextHref) {
      link.setAttribute('href', nextHref);
    }
  }

  for (const img of Array.from(doc.querySelectorAll('img'))) {
    const originalSrc =
      img.getAttribute('src') || img.getAttribute('data-src') || img.getAttribute('data-original');
    const src = img.getAttribute('src');
    const rawSrc = src || originalSrc;
    const resolved = rawSrc && baseUrl ? resolveUrl(rawSrc, baseUrl) : rawSrc;
    const nextSrc =
      (resolved && assetMap.get(resolved)) || (rawSrc ? assetMap.get(rawSrc) : undefined);
    if (nextSrc) {
      img.setAttribute('src', nextSrc);
    }

    const srcset = img.getAttribute('srcset');
    if (srcset) {
      img.setAttribute('srcset', rewriteSrcsetValue(srcset, assetMap, baseUrl));
    }
  }

  for (const source of Array.from(doc.querySelectorAll('picture source, source[srcset]'))) {
    const srcset = source.getAttribute('srcset');
    if (!srcset) {
      continue;
    }

    source.setAttribute('srcset', rewriteSrcsetValue(srcset, assetMap, baseUrl));
  }

  for (const style of Array.from(doc.querySelectorAll('style'))) {
    const cssText = style.textContent;
    if (!cssText) {
      continue;
    }
    style.textContent = rewriteStyleValue(cssText, assetMap, baseUrl);
  }

  for (const element of Array.from(doc.querySelectorAll('[style]'))) {
    const styleValue = element.getAttribute('style');
    if (!styleValue) {
      continue;
    }

    const rewritten = rewriteStyleValue(styleValue, assetMap, baseUrl);
    element.setAttribute('style', rewritten);
  }
}
