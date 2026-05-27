import type { PageCaptureMode } from '../types';

export type WebScrapBookCapturePreset = {
  image: 'placeholder';
  imageBackground: 'placeholder';
  font: 'placeholder';
  mergeCssFiles: true;
  prettyPrint: true;
  removeHidden: true;
  script: 'remove';
  noscript: 'remove';
  contentSecurityPolicy: 'remove';
  preload: 'remove';
  prefetch: 'remove';
  saveResources: false;
  outputStylePath: 'style.css';
};

export type CaptureStyleDraft = {
  path: string;
  content: string;
};

export type CaptureCoreWarning = {
  code: string;
  message: string;
  sourceUrl?: string;
};

export type CaptureCoreArtifact = {
  url: string;
  title: string;
  capturedAt: string;
  mode: PageCaptureMode;
  html: string;
  styles: CaptureStyleDraft[];
  assets: [];
  warnings: CaptureCoreWarning[];
  metadata: {
    originalUrl: string;
    userAgent: string;
    documentTitle: string;
    elementSelectionSummary?: string;
    capturePresetVersion: 'webscrapbook-folder-v1';
  };
};
