import type { WebScrapBookCapturePreset } from './types';

const WEBSCRAPBOOK_CAPTURE_PRESET: WebScrapBookCapturePreset = Object.freeze({
  image: 'placeholder',
  imageBackground: 'placeholder',
  font: 'placeholder',
  mergeCssFiles: true,
  prettyPrint: true,
  removeHidden: true,
  script: 'remove',
  noscript: 'remove',
  contentSecurityPolicy: 'remove',
  preload: 'remove',
  prefetch: 'remove',
  saveResources: false,
  outputStylePath: 'style.css',
});

export function getWebScrapBookCapturePreset(): WebScrapBookCapturePreset {
  return { ...WEBSCRAPBOOK_CAPTURE_PRESET };
}
