import type { CaptureArtifactDraft, PageCaptureMode } from '../types';
import { createPageCaptureArtifact } from './artifact';
import { collectStyleSources } from './css/collect';
import { mergeStyleSources } from './css/merge';
import { cleanupCapturedDocument } from './dom/cleanup';
import { clonePageDocument, SOURCE_INDEX_ATTRIBUTE } from './dom/clone';
import { inlineComputedLayoutStyles } from './dom/computed-styles';
import { replaceResourceElementsWithPlaceholders } from './dom/placeholders';
import { prettyPrintHtml } from './dom/pretty-print';
import type { CaptureCoreWarning } from './types';

function insertMergedStylesheetLink(doc: Document): void {
  const styleLink = doc.createElement('link');
  styleLink.setAttribute('rel', 'stylesheet');
  styleLink.setAttribute('href', 'style.css');

  const firstInlineStyle = doc.head.querySelector('style');
  if (firstInlineStyle?.parentNode) {
    firstInlineStyle.parentNode.insertBefore(styleLink, firstInlineStyle);
    return;
  }

  doc.head.append(styleLink);
}

export async function capturePageDocument(
  doc: Document,
  options: {
    mode: PageCaptureMode;
    baseUrl: string;
    capturedAt?: string;
    elementSelectionSummary?: string;
    targetElement?: Element | null;
    fetchStylesheet?: (sourceUrl: string) => Promise<string>;
  }
): Promise<CaptureArtifactDraft> {
  const baseUrl = new URL(options.baseUrl);
  const warnings: CaptureCoreWarning[] = [];
  const capturedDoc = clonePageDocument(doc, {
    targetElement: options.mode === 'element' ? options.targetElement : null,
  });

  cleanupCapturedDocument(capturedDoc, doc);
  inlineComputedLayoutStyles(capturedDoc, doc);
  const styleSources = await collectStyleSources(capturedDoc, baseUrl, warnings, {
    originalDoc: doc,
    pruneUnused: true,
    fetchStylesheet: options.fetchStylesheet,
    preserveInlineStyleElements: false,
  });
  replaceResourceElementsWithPlaceholders(capturedDoc, doc);

  insertMergedStylesheetLink(capturedDoc);
  for (const element of Array.from(capturedDoc.querySelectorAll(`[${SOURCE_INDEX_ATTRIBUTE}]`))) {
    element.removeAttribute(SOURCE_INDEX_ATTRIBUTE);
  }

  const styleContent = mergeStyleSources(styleSources, warnings);
  const html = prettyPrintHtml(capturedDoc);

  return createPageCaptureArtifact({
    mode: options.mode,
    url: baseUrl.href,
    title: doc.title,
    capturedAt: options.capturedAt || new Date().toISOString(),
    html,
    styleContent,
    warnings,
    userAgent: navigator.userAgent,
    documentTitle: doc.title,
    elementSelectionSummary: options.elementSelectionSummary,
  });
}
