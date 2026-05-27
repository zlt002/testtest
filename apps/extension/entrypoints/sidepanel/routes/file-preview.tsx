import { css } from '@codemirror/lang-css';
import { html } from '@codemirror/lang-html';
import { javascript } from '@codemirror/lang-javascript';
import { json } from '@codemirror/lang-json';
import { markdown } from '@codemirror/lang-markdown';
import { python } from '@codemirror/lang-python';
import { oneDark } from '@codemirror/theme-one-dark';
import type { EditorView } from '@codemirror/view';
import { EditorView as CodeMirrorEditorView } from '@codemirror/view';
import { createFileRoute } from '@tanstack/react-router';
import CodeMirror from '@uiw/react-codemirror';
import {
  AlertCircleIcon,
  Code2Icon,
  CopyIcon,
  DownloadIcon,
  EyeIcon,
  FileTextIcon,
  ImagePlusIcon,
  MessageSquarePlusIcon,
  PencilIcon,
  RefreshCwIcon,
  SaveIcon,
  SendHorizontalIcon,
  Trash2Icon,
} from 'lucide-react';
import {
  Children,
  type ChangeEvent,
  isValidElement,
  memo,
  type ReactNode,
  type PointerEvent as ReactPointerEvent,
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from 'react';
import { createPortal } from 'react-dom';
import ReactMarkdown from 'react-markdown';
import rehypeKatex from 'rehype-katex';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import type { PluggableList } from 'unified';
import 'katex/dist/katex.min.css';
import { Button } from '@/entrypoints/sidepanel/components/ui/button';
import { createAgentV2Client } from '../lib/agent-v2/client';
import {
  isLiveWritePreviewMessage,
  type LiveWritePreviewPayload,
  liveWritePreviewPayloadVersion,
  readLiveWritePreview,
} from '../lib/agent-v2/live-write-preview';
import { publishAgentV2ComposerAppend } from '../lib/agent-v2/session-selection';
import { config } from '../lib/config';
import {
  buildDocxDownloadPayload,
  buildMarkdownDownloadPayload,
  triggerBrowserDownload,
} from '../lib/file-download-export';
import {
  buildFileBrowserPreviewUrl,
  buildHtmlBrowserPreviewUrl,
  openHtmlBrowserPreview,
  reloadHtmlBrowserPreview,
} from '../lib/file-preview-browser';
import {
  buildAnnotationDraftFromPendingSelection,
  buildPendingAnnotationSelection,
  type PendingAnnotationSelection,
  type TextRangeAnchor,
} from './file-preview.annotation-action';
import { type AnnotationHitTarget, findAnnotationIdAtPoint } from './file-preview.annotation-hit';
import { syncPendingAnnotationHighlight } from './file-preview.pending-highlight';
import {
  countActiveAnnotations,
  type FileAnnotationStatus,
  formatAnnotationCountLabel,
  resolveAnnotationStatuses,
} from './file-preview.annotation-status';
import {
  type FilePreviewKind,
  filePreviewDefaultViewMode,
  filePreviewSupportsRenderedPreview,
} from './file-preview.mode';
import {
  buildMarkdownImageSnippet,
  buildMarkdownPreviewImageUrl,
  fileToBase64,
  insertMarkdownImageSnippet,
  resolveAvailableImageAssetPath,
  validateMarkdownImageFile,
} from './file-preview.image-assets';
import {
  buildMarkdownFloatingImageInsertTarget,
  buildMarkdownInsertTargetFromNode,
  resolveMarkdownInsertOffset,
} from './file-preview.markdown-insert-position';

type FileAnnotation = {
  id: string;
  selectedText: string;
  anchor?: TextRangeAnchor;
  note: string;
  createdAt: string;
  updatedAt: string;
};

type ResolvedFileAnnotation = FileAnnotation & {
  status: FileAnnotationStatus;
};

type ActiveAnnotationPreview = {
  annotation: ResolvedFileAnnotation;
  x: number;
  y: number;
};

type AnnotationDraft = {
  id?: string;
  selectedText: string;
  range: Range | null;
  anchor: TextRangeAnchor | null;
  note: string;
  x: number;
  y: number;
};

type MarkdownImageInsertTarget =
  | { ok: true; offset: number }
  | { ok: false; message: string };

type MarkdownFloatingImageInsertTarget = {
  offset: number;
  x: number;
  y: number;
};

type MarkdownImageInsertDraft = {
  file: File;
  offset: number;
  alt: string;
};

function readPreviewParams() {
  const params = new URL(window.location.href).searchParams;
  return {
    projectPath: params.get('projectPath') || '',
    filePath: params.get('filePath') || '',
    liveWrite: params.get('liveWrite') === '1',
  };
}

function fileNameFromPath(path: string) {
  return path.split('/').filter(Boolean).at(-1) || path || '文件预览';
}

function fileExtension(path: string) {
  const name = fileNameFromPath(path).toLowerCase();
  const index = name.lastIndexOf('.');
  return index >= 0 ? name.slice(index + 1) : '';
}

function previewKind(path: string) {
  const ext = fileExtension(path);
  if (ext === 'html' || ext === 'htm') {
    return 'html' as const;
  }
  if (ext === 'md' || ext === 'markdown') {
    return 'markdown' as const;
  }
  return 'text' as const;
}

function codeMirrorExtensions(path: string) {
  const ext = fileExtension(path);
  switch (ext) {
    case 'js':
    case 'jsx':
    case 'mjs':
    case 'cjs':
      return [javascript({ jsx: true })];
    case 'ts':
    case 'tsx':
      return [javascript({ jsx: ext === 'tsx', typescript: true })];
    case 'json':
      return [json()];
    case 'html':
    case 'htm':
      return [html()];
    case 'css':
    case 'scss':
    case 'less':
      return [css()];
    case 'md':
    case 'markdown':
      return [markdown()];
    case 'py':
      return [python()];
    default:
      return [];
  }
}

function preserveMarkdownHref(value: string) {
  if (!value) {
    return '';
  }
  const trimmed = value.trim();
  if (/^(javascript|vbscript|data):/i.test(trimmed)) {
    return '';
  }
  return value;
}

function parseCodeLanguage(className?: string) {
  const languageMatch = /language-([\w-]+)/.exec(className || '');
  return languageMatch ? languageMatch[1].toLowerCase() : 'text';
}

function looksLikeMermaidChart(value: string) {
  const firstLine = value.trimStart().split(/\r?\n/, 1)[0]?.trim().toLowerCase();

  return Boolean(
    firstLine &&
      /^(flowchart|graph|sequencediagram|classdiagram|statediagram|erdiagram|journey|gantt|pie|gitgraph|mindmap|timeline|quadrantchart|requirementdiagram|c4context|c4container|c4component|c4dynamic)\b/.test(
        firstLine
      )
  );
}

function annotationStorageKey(projectPath: string, filePath: string) {
  return `agentV2.fileAnnotations:${projectPath}:${filePath}`;
}

function truncateText(value: string, length = 64) {
  const normalized = value.replace(/\s+/g, ' ').trim();
  return normalized.length <= length ? normalized : `${normalized.slice(0, length - 1)}...`;
}

function formatAnnotationForChat(input: { filePath: string; annotations: FileAnnotation[] }) {
  const lines = [`当前文件标注：${input.filePath}`];
  input.annotations.forEach((annotation, index) => {
    lines.push(
      '',
      `${index + 1}. 选中文本：`,
      `> ${annotation.selectedText.replace(/\n/g, '\n> ')}`,
      '',
      `标注：${annotation.note}`
    );
  });
  return lines.join('\n');
}

function isTextRangeAnchor(value: unknown): value is TextRangeAnchor {
  return Boolean(
    value &&
      typeof value === 'object' &&
      typeof (value as TextRangeAnchor).start === 'number' &&
      typeof (value as TextRangeAnchor).end === 'number' &&
      typeof (value as TextRangeAnchor).prefix === 'string' &&
      typeof (value as TextRangeAnchor).suffix === 'string' &&
      typeof (value as TextRangeAnchor).occurrenceIndex === 'number' &&
      ((value as TextRangeAnchor).startPath === undefined ||
        Array.isArray((value as TextRangeAnchor).startPath)) &&
      ((value as TextRangeAnchor).endPath === undefined ||
        Array.isArray((value as TextRangeAnchor).endPath)) &&
      ((value as TextRangeAnchor).startTextOffset === undefined ||
        typeof (value as TextRangeAnchor).startTextOffset === 'number') &&
      ((value as TextRangeAnchor).endTextOffset === undefined ||
        typeof (value as TextRangeAnchor).endTextOffset === 'number')
  );
}

async function readFileAnnotations(
  projectPath: string,
  filePath: string
): Promise<FileAnnotation[]> {
  const key = annotationStorageKey(projectPath, filePath);
  const stored = await chrome.storage.local.get(key);
  const value = stored[key];
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter(
    (item): item is FileAnnotation =>
      typeof item === 'object' &&
      item !== null &&
      typeof item.id === 'string' &&
      typeof item.selectedText === 'string' &&
      typeof item.note === 'string' &&
      typeof item.createdAt === 'string' &&
      typeof item.updatedAt === 'string' &&
      ((item as { anchor?: unknown }).anchor === undefined ||
        isTextRangeAnchor((item as { anchor?: unknown }).anchor))
  );
}

async function writeFileAnnotations(
  projectPath: string,
  filePath: string,
  annotations: FileAnnotation[]
) {
  await chrome.storage.local.set({
    [annotationStorageKey(projectPath, filePath)]: annotations,
  });
}

const ANNOTATION_ANCHOR_CONTEXT_LENGTH = 32;

type TextIndex = {
  textNodes: Text[];
  fullText: string;
  normalizedFullText: string;
  normalizedToRawRanges: Array<{ start: number; end: number }>;
};

type TextRangeOffsets = {
  rawStart: number;
  rawEnd: number;
};

type HighlightRect = {
  left: number;
  top: number;
  width: number;
  height: number;
};

type RenderedFlowSegment =
  | {
      kind: 'text';
      node: Text;
      start: number;
      end: number;
    }
  | {
      kind: 'separator';
      start: number;
      end: number;
    };

type RenderedFlowIndex = {
  flowText: string;
  segments: RenderedFlowSegment[];
  normalizedFlowText: string;
  normalizedToFlowRanges: Array<{ start: number; end: number }>;
};

const TEXT_NODE = 3;
const BLOCK_LIKE_TAG_NAMES = new Set([
  'P',
  'DIV',
  'H1',
  'H2',
  'H3',
  'H4',
  'H5',
  'H6',
  'LI',
  'BLOCKQUOTE',
  'PRE',
  'TD',
  'TH',
  'TR',
  'TABLE',
  'SECTION',
  'ARTICLE',
  'UL',
  'OL',
]);

export const annotationHighlightStyles =
  '::highlight(webmcp-file-annotation) { background-color: rgba(250, 204, 21, 0.45); color: inherit; } ::highlight(webmcp-file-annotation-pending) { background-color: rgba(96, 165, 250, 0.30); color: inherit; }';

export function clearWindowSelection() {
  window.getSelection()?.removeAllRanges();
}

export function collectHighlightRects(root: HTMLElement, ranges: Range[]): HighlightRect[] {
  const rootRect = root.getBoundingClientRect();
  return ranges.flatMap((range) =>
    Array.from(range.getClientRects())
      .filter((rect) => rect.width > 0 && rect.height > 0)
      .map((rect) => ({
        left: rect.left - rootRect.left,
        top: rect.top - rootRect.top,
        width: rect.width,
        height: rect.height,
      }))
  );
}

export function collectViewportHighlightRects(ranges: Range[]): HighlightRect[] {
  return ranges.flatMap((range) =>
    Array.from(range.getClientRects())
      .filter((rect) => rect.width > 0 && rect.height > 0)
      .map((rect) => ({
        left: rect.left,
        top: rect.top,
        width: rect.width,
        height: rect.height,
      }))
  );
}

export function shouldRenderHighlightOverlayFallback(
  cssHighlights: unknown,
  HighlightCtor: unknown
) {
  return !(cssHighlights && HighlightCtor);
}

function normalizeAnnotationSearchText(value: string) {
  return value.replace(/\s+/g, ' ').trim();
}

function collectTextIndex(root: HTMLElement): TextIndex {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const textNodes: Text[] = [];
  let fullText = '';
  let node: Node | null = walker.nextNode();
  while (node) {
    const textNode = node as Text;
    textNodes.push(textNode);
    fullText += textNode.data;
    node = walker.nextNode();
  }

  const normalizedChars: string[] = [];
  const normalizedToRawRanges: Array<{ start: number; end: number }> = [];
  for (let index = 0; index < fullText.length; index += 1) {
    const char = fullText[index];
    if (!/\s/.test(char)) {
      normalizedChars.push(char);
      normalizedToRawRanges.push({ start: index, end: index + 1 });
      continue;
    }

    const whitespaceStart = index;
    while (index + 1 < fullText.length && /\s/.test(fullText[index + 1])) {
      index += 1;
    }
    normalizedChars.push(' ');
    normalizedToRawRanges.push({ start: whitespaceStart, end: index + 1 });
  }

  return {
    textNodes,
    fullText,
    normalizedFullText: normalizedChars.join(''),
    normalizedToRawRanges,
  };
}

function buildNormalizedIndex(value: string) {
  const normalizedChars: string[] = [];
  const normalizedRanges: Array<{ start: number; end: number }> = [];
  for (let index = 0; index < value.length; index += 1) {
    const char = value[index];
    if (!/\s/.test(char)) {
      normalizedChars.push(char);
      normalizedRanges.push({ start: index, end: index + 1 });
      continue;
    }

    const whitespaceStart = index;
    while (index + 1 < value.length && /\s/.test(value[index + 1])) {
      index += 1;
    }
    normalizedChars.push(' ');
    normalizedRanges.push({ start: whitespaceStart, end: index + 1 });
  }

  return {
    normalizedText: normalizedChars.join(''),
    normalizedRanges,
  };
}

function findNearestBlockLikeAncestor(root: HTMLElement, node: Node) {
  let current: Node | null = node.parentNode;
  while (current && current !== root) {
    if (
      current.nodeType === 1 &&
      'tagName' in current &&
      typeof (current as { tagName?: unknown }).tagName === 'string' &&
      BLOCK_LIKE_TAG_NAMES.has((current as { tagName: string }).tagName)
    ) {
      return current;
    }
    current = current.parentNode;
  }
  return root;
}

function readRenderedSeparatorText(previousNode: Text, nextNode: Text) {
  const separatorRange = document.createRange();
  separatorRange.setStart(previousNode, previousNode.data.length);
  separatorRange.setEnd(nextNode, 0);
  return separatorRange.toString();
}

function collectRenderedFlowIndex(root: HTMLElement): RenderedFlowIndex {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const textNodes: Text[] = [];
  let current = walker.nextNode();
  while (current) {
    textNodes.push(current as Text);
    current = walker.nextNode();
  }

  const segments: RenderedFlowSegment[] = [];
  let flowText = '';
  for (const [index, textNode] of textNodes.entries()) {
    if (index > 0) {
      const previousNode = textNodes[index - 1]!;
      const separatorText = readRenderedSeparatorText(previousNode, textNode);
      const blockBoundarySeparator =
        separatorText ||
        (findNearestBlockLikeAncestor(root, previousNode) !==
        findNearestBlockLikeAncestor(root, textNode)
          ? ' '
          : '');
      if (separatorText) {
        const start = flowText.length;
        flowText += separatorText;
        segments.push({
          kind: 'separator',
          start,
          end: flowText.length,
        });
      } else if (blockBoundarySeparator) {
        const start = flowText.length;
        flowText += blockBoundarySeparator;
        segments.push({
          kind: 'separator',
          start,
          end: flowText.length,
        });
      }
    }

    const start = flowText.length;
    flowText += textNode.data;
    segments.push({
      kind: 'text',
      node: textNode,
      start,
      end: flowText.length,
    });
  }

  const normalized = buildNormalizedIndex(flowText);
  return {
    flowText,
    segments,
    normalizedFlowText: normalized.normalizedText,
    normalizedToFlowRanges: normalized.normalizedRanges,
  };
}

function rawOffsetFromRangeStart(root: HTMLElement, range: Range) {
  const prefixRange = document.createRange();
  prefixRange.selectNodeContents(root);
  prefixRange.setEnd(range.startContainer, range.startOffset);
  return prefixRange.toString().length;
}

function countRawOccurrencesBefore(fullText: string, query: string, rawStart: number) {
  if (!query) {
    return 0;
  }
  let count = 0;
  let offset = 0;
  while (offset >= 0) {
    const next = fullText.indexOf(query, offset);
    if (next < 0 || next >= rawStart) {
      return count;
    }
    count += 1;
    offset = next + 1;
  }
  return count;
}

function getNodePath(root: Node, target: Node) {
  const path: number[] = [];
  let current: Node | null = target;
  while (current && current !== root) {
    const parent: Node | null = current.parentNode;
    if (!parent) {
      return null;
    }
    const childIndex = Array.prototype.indexOf.call(parent.childNodes, current);
    if (childIndex < 0) {
      return null;
    }
    path.unshift(childIndex);
    current = parent;
  }
  return current === root ? path : null;
}

function getNodeByPath(root: Node, path: number[]) {
  let current: Node | null = root;
  for (const index of path) {
    current = current?.childNodes.item(index) ?? null;
    if (!current) {
      return null;
    }
  }
  return current;
}

function createRangeFromAnchorPositions(
  root: HTMLElement,
  query: string,
  anchor?: TextRangeAnchor | null
) {
  const validAnchor = isTextRangeAnchor(anchor) ? anchor : null;
  if (
    !validAnchor?.startPath ||
    !validAnchor?.endPath ||
    validAnchor.startTextOffset === undefined ||
    validAnchor.endTextOffset === undefined
  ) {
    return null;
  }

  const startNode = getNodeByPath(root, validAnchor.startPath);
  const endNode = getNodeByPath(root, validAnchor.endPath);
  if (
    startNode?.nodeType !== TEXT_NODE ||
    endNode?.nodeType !== TEXT_NODE
  ) {
    return null;
  }

  const resolvedStartNode = startNode as Text;
  const resolvedEndNode = endNode as Text;
  if (
    validAnchor.startTextOffset < 0 ||
    validAnchor.startTextOffset > resolvedStartNode.data.length ||
    validAnchor.endTextOffset < 0 ||
    validAnchor.endTextOffset > resolvedEndNode.data.length
  ) {
    return null;
  }

  const range = document.createRange();
  range.setStart(resolvedStartNode, validAnchor.startTextOffset);
  range.setEnd(resolvedEndNode, validAnchor.endTextOffset);
  return normalizeAnnotationSearchText(range.toString()) ===
    normalizeAnnotationSearchText(query)
    ? range
    : null;
}

function createRangeFromOffsets(index: TextIndex, rawStart: number, rawEnd: number) {
  let offset = 0;
  let startNode: Text | null = null;
  let endNode: Text | null = null;
  let startOffset = 0;
  let endOffset = 0;
  for (const textNode of index.textNodes) {
    const nextOffset = offset + textNode.data.length;
    if (
      !startNode &&
      rawStart >= offset &&
      (rawStart < nextOffset || rawStart === index.fullText.length)
    ) {
      startNode = textNode;
      startOffset = rawStart - offset;
    }
    if (!endNode && rawEnd >= offset && rawEnd <= nextOffset) {
      endNode = textNode;
      endOffset = rawEnd - offset;
      break;
    }
    offset = nextOffset;
  }

  if (!startNode || !endNode) {
    return null;
  }
  const range = document.createRange();
  range.setStart(startNode, startOffset);
  range.setEnd(endNode, endOffset);
  return range;
}

function createTextNodeRangesFromOffsets(index: TextIndex, rawStart: number, rawEnd: number) {
  const ranges: Range[] = [];
  let offset = 0;
  for (const textNode of index.textNodes) {
    const nextOffset = offset + textNode.data.length;
    const segmentStart = Math.max(rawStart, offset);
    const segmentEnd = Math.min(rawEnd, nextOffset);
    if (segmentStart < segmentEnd) {
      const range = document.createRange();
      range.setStart(textNode, segmentStart - offset);
      range.setEnd(textNode, segmentEnd - offset);
      ranges.push(range);
    }
    offset = nextOffset;
  }
  return ranges;
}

function createTextNodeRangesFromRange(root: HTMLElement, range: Range) {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const ranges: Range[] = [];
  let node = walker.nextNode();
  while (node) {
    if (node.nodeType === TEXT_NODE && range.intersectsNode(node)) {
      const textNode = node as Text;
      const textRange = document.createRange();
      const startOffset = textNode === range.startContainer ? range.startOffset : 0;
      const endOffset =
        textNode === range.endContainer ? range.endOffset : textNode.data.length;
      if (startOffset < endOffset) {
        textRange.setStart(textNode, startOffset);
        textRange.setEnd(textNode, endOffset);
        ranges.push(textRange);
      }
    }
    node = walker.nextNode();
  }
  return ranges;
}

function offsetsFromNormalizedMatch(index: TextIndex, start: number, length: number) {
  const end = start + length - 1;
  const rawStart = index.normalizedToRawRanges[start]?.start;
  const rawEnd = index.normalizedToRawRanges[end]?.end;
  if (rawStart === undefined || rawEnd === undefined) {
    return null;
  }
  return { rawStart, rawEnd };
}

function flowOffsetsFromNormalizedMatch(index: RenderedFlowIndex, start: number, length: number) {
  const end = start + length - 1;
  const flowStart = index.normalizedToFlowRanges[start]?.start;
  const flowEnd = index.normalizedToFlowRanges[end]?.end;
  if (flowStart === undefined || flowEnd === undefined) {
    return null;
  }
  return { flowStart, flowEnd };
}

function findNormalizedMatches(index: TextIndex, normalizedQuery: string) {
  const matches: TextRangeOffsets[] = [];
  let searchStart = 0;
  while (searchStart <= index.normalizedFullText.length) {
    const start = index.normalizedFullText.indexOf(normalizedQuery, searchStart);
    if (start < 0) {
      break;
    }
    const offsets = offsetsFromNormalizedMatch(index, start, normalizedQuery.length);
    if (offsets) {
      matches.push(offsets);
    }
    searchStart = start + 1;
  }
  return matches;
}

function findRenderedFlowMatches(index: RenderedFlowIndex, normalizedQuery: string) {
  const matches: Array<{ flowStart: number; flowEnd: number }> = [];
  let searchStart = 0;
  while (searchStart <= index.normalizedFlowText.length) {
    const start = index.normalizedFlowText.indexOf(normalizedQuery, searchStart);
    if (start < 0) {
      break;
    }
    const offsets = flowOffsetsFromNormalizedMatch(index, start, normalizedQuery.length);
    if (offsets) {
      matches.push(offsets);
    }
    searchStart = start + 1;
  }
  return matches;
}

function resolveRenderedFlowPosition(
  index: RenderedFlowIndex,
  offset: number,
  side: 'start' | 'end'
) {
  if (side === 'start') {
    for (const segment of index.segments) {
      if (segment.kind !== 'text') {
        continue;
      }
      if (offset <= segment.start) {
        return { node: segment.node, offset: 0 };
      }
      if (offset > segment.start && offset < segment.end) {
        return { node: segment.node, offset: offset - segment.start };
      }
      if (offset === segment.end) {
        continue;
      }
    }
    const lastTextSegment = [...index.segments]
      .reverse()
      .find((segment): segment is Extract<RenderedFlowSegment, { kind: 'text' }> => segment.kind === 'text');
    return lastTextSegment
      ? { node: lastTextSegment.node, offset: lastTextSegment.node.data.length }
      : null;
  }

  for (let segmentIndex = index.segments.length - 1; segmentIndex >= 0; segmentIndex -= 1) {
    const segment = index.segments[segmentIndex]!;
    if (segment.kind !== 'text') {
      continue;
    }
    if (offset >= segment.end) {
      return { node: segment.node, offset: segment.node.data.length };
    }
    if (offset > segment.start && offset < segment.end) {
      return { node: segment.node, offset: offset - segment.start };
    }
    if (offset === segment.start) {
      continue;
    }
  }

  const firstTextSegment = index.segments.find(
    (segment): segment is Extract<RenderedFlowSegment, { kind: 'text' }> => segment.kind === 'text'
  );
  return firstTextSegment ? { node: firstTextSegment.node, offset: 0 } : null;
}

function createRangeFromRenderedFlow(
  root: HTMLElement,
  query: string
) {
  const normalizedQuery = normalizeAnnotationSearchText(query);
  if (!normalizedQuery) {
    return null;
  }

  const index = collectRenderedFlowIndex(root);
  const match = findRenderedFlowMatches(index, normalizedQuery)[0];
  if (!match) {
    return null;
  }

  const startPosition = resolveRenderedFlowPosition(index, match.flowStart, 'start');
  const endPosition = resolveRenderedFlowPosition(index, match.flowEnd, 'end');
  if (!startPosition || !endPosition) {
    return null;
  }

  const range = document.createRange();
  range.setStart(startPosition.node, startPosition.offset);
  range.setEnd(endPosition.node, endPosition.offset);
  return range;
}

function scoreAnchorMatch(index: TextIndex, match: TextRangeOffsets, anchor: TextRangeAnchor) {
  let score = Math.max(0, 10_000 - Math.abs(match.rawStart - anchor.start));
  const prefix = index.fullText.slice(
    Math.max(0, match.rawStart - anchor.prefix.length),
    match.rawStart
  );
  const suffix = index.fullText.slice(match.rawEnd, match.rawEnd + anchor.suffix.length);
  if (prefix === anchor.prefix) {
    score += 20_000;
  }
  if (suffix === anchor.suffix) {
    score += 20_000;
  }
  return score;
}

function resolveTextRangeOffsets(
  index: TextIndex,
  query: string,
  anchor?: TextRangeAnchor | null
) {
  const normalizedQuery = normalizeAnnotationSearchText(query);
  const validAnchor = isTextRangeAnchor(anchor) ? anchor : null;
  if (!normalizedQuery) {
    return null;
  }

  if (
    validAnchor &&
    validAnchor.start >= 0 &&
    validAnchor.end > validAnchor.start &&
    validAnchor.end <= index.fullText.length &&
    normalizeAnnotationSearchText(index.fullText.slice(validAnchor.start, validAnchor.end)) ===
      normalizedQuery
  ) {
    return { rawStart: validAnchor.start, rawEnd: validAnchor.end };
  }

  const matches = findNormalizedMatches(index, normalizedQuery);
  if (matches.length === 0) {
    return null;
  }

  if (validAnchor) {
    return matches.reduce((best, match) =>
      scoreAnchorMatch(index, match, validAnchor) > scoreAnchorMatch(index, best, validAnchor)
        ? match
        : best
    );
  }

  return matches[0] ?? null;
}

export function buildTextRangeAnchor(
  root: HTMLElement,
  range: Range,
  selectedText = range.toString().trim()
): TextRangeAnchor | null {
  const index = collectTextIndex(root);
  if (!selectedText) {
    return null;
  }
  const rawRangeText = range.toString();
  const selectionStartInRange = rawRangeText.indexOf(selectedText);
  const rawStart =
    rawOffsetFromRangeStart(root, range) + Math.max(0, selectionStartInRange);
  const rawEnd = rawStart + selectedText.length;
  if (
    rawStart < 0 ||
    rawEnd > index.fullText.length ||
    normalizeAnnotationSearchText(index.fullText.slice(rawStart, rawEnd)) !==
      normalizeAnnotationSearchText(selectedText)
  ) {
    return null;
  }

  const startPath =
    range.startContainer.nodeType === TEXT_NODE
      ? getNodePath(root, range.startContainer)
      : null;
  const endPath =
    range.endContainer.nodeType === TEXT_NODE
      ? getNodePath(root, range.endContainer)
      : null;

  return {
    start: rawStart,
    end: rawEnd,
    prefix: index.fullText.slice(
      Math.max(0, rawStart - ANNOTATION_ANCHOR_CONTEXT_LENGTH),
      rawStart
    ),
    suffix: index.fullText.slice(rawEnd, rawEnd + ANNOTATION_ANCHOR_CONTEXT_LENGTH),
    occurrenceIndex: countRawOccurrencesBefore(index.fullText, selectedText, rawStart),
    startPath: startPath ?? undefined,
    startTextOffset: startPath ? range.startOffset : undefined,
    endPath: endPath ?? undefined,
    endTextOffset: endPath ? range.endOffset : undefined,
  };
}

export function findTextRange(
  root: HTMLElement,
  query: string,
  anchor?: TextRangeAnchor | null
) {
  const directRange = createRangeFromAnchorPositions(root, query, anchor);
  if (directRange) {
    return directRange;
  }
  const index = collectTextIndex(root);
  const offsets = resolveTextRangeOffsets(index, query, anchor);
  if (offsets) {
    return createRangeFromOffsets(index, offsets.rawStart, offsets.rawEnd);
  }
  return createRangeFromRenderedFlow(root, query);
}

export function findTextHighlightRanges(
  root: HTMLElement,
  query: string,
  anchor?: TextRangeAnchor | null
) {
  const directRange = createRangeFromAnchorPositions(root, query, anchor);
  if (directRange) {
    return createTextNodeRangesFromRange(root, directRange);
  }
  const index = collectTextIndex(root);
  const offsets = resolveTextRangeOffsets(index, query, anchor);
  if (offsets) {
    return createTextNodeRangesFromOffsets(index, offsets.rawStart, offsets.rawEnd);
  }
  const renderedFlowRange = createRangeFromRenderedFlow(root, query);
  return renderedFlowRange ? createTextNodeRangesFromRange(root, renderedFlowRange) : [];
}

let mermaidInitialized = false;
const markdownPreviewComponentsCache = new Map<boolean, ReturnType<typeof createMarkdownPreviewComponents>>();
const mermaidSvgCache = new Map<string, string>();
const MERMAID_SVG_CACHE_LIMIT = 24;

function rememberMermaidSvg(chart: string, svg: string) {
  if (mermaidSvgCache.has(chart)) {
    mermaidSvgCache.delete(chart);
  }
  mermaidSvgCache.set(chart, svg);
  if (mermaidSvgCache.size > MERMAID_SVG_CACHE_LIMIT) {
    const oldestKey = mermaidSvgCache.keys().next().value;
    if (oldestKey) {
      mermaidSvgCache.delete(oldestKey);
    }
  }
}

function isMermaidDebugEnabled() {
  if (typeof window === 'undefined') {
    return false;
  }

  const debugFlag = (window as typeof window & {
    __WEBMCP_DEBUG_MERMAID__?: boolean;
  }).__WEBMCP_DEBUG_MERMAID__;
  return debugFlag === true;
}

function logMermaidDebug(event: string, detail: Record<string, unknown>) {
  if (!isMermaidDebugEnabled()) {
    return;
  }

  console.debug('[file-preview][mermaid]', event, detail);
}

const MIN_MERMAID_SCALE = 0.2;
const MAX_MERMAID_SCALE = 3;

type MermaidViewport = {
  scale: number;
  x: number;
  y: number;
};

type MermaidMeasurement = {
  containerWidth: number;
  containerHeight: number;
  contentWidth: number;
  contentHeight: number;
};

function clampMermaidScale(scale: number) {
  return Math.min(MAX_MERMAID_SCALE, Math.max(MIN_MERMAID_SCALE, scale));
}

function computeCenteredMermaidViewport(input: {
  containerWidth: number;
  containerHeight: number;
  contentWidth: number;
  contentHeight: number;
  scale: number;
}): MermaidViewport {
  const scale = clampMermaidScale(input.scale);
  return {
    scale,
    x: (input.containerWidth - input.contentWidth * scale) / 2,
    y: (input.containerHeight - input.contentHeight * scale) / 2,
  };
}

function computeFitMermaidViewport(input: {
  containerWidth: number;
  containerHeight: number;
  contentWidth: number;
  contentHeight: number;
  padding: number;
}): MermaidViewport {
  const usableWidth = Math.max(input.containerWidth - input.padding * 2, 1);
  const usableHeight = Math.max(input.containerHeight - input.padding * 2, 1);
  const widthScale = usableWidth / Math.max(input.contentWidth, 1);
  const heightScale = usableHeight / Math.max(input.contentHeight, 1);

  return computeCenteredMermaidViewport({
    containerWidth: input.containerWidth,
    containerHeight: input.containerHeight,
    contentWidth: input.contentWidth,
    contentHeight: input.contentHeight,
    scale: Math.min(widthScale, heightScale, 1),
  });
}

function computeFitWidthTopMermaidViewport(input: {
  containerWidth: number;
  contentWidth: number;
  padding: number;
}): MermaidViewport {
  const usableWidth = Math.max(input.containerWidth - input.padding * 2, 1);
  const scale = clampMermaidScale(usableWidth / Math.max(input.contentWidth, 1));

  return {
    scale,
    x: (input.containerWidth - input.contentWidth * scale) / 2,
    y: input.padding,
  };
}

function normalizeMermaidSvgElement(svgElement: SVGSVGElement | null) {
  if (!svgElement) {
    return null;
  }

  const viewBox = svgElement.viewBox?.baseVal;
  const rect = svgElement.getBoundingClientRect();
  const contentWidth = viewBox?.width || rect.width || 0;
  const contentHeight = viewBox?.height || rect.height || 0;

  if (!contentWidth || !contentHeight) {
    return null;
  }

  svgElement.style.width = `${contentWidth}px`;
  svgElement.style.height = `${contentHeight}px`;
  svgElement.style.maxWidth = 'none';
  svgElement.style.display = 'block';

  return { contentWidth, contentHeight };
}

function MermaidBlock({ chart }: { chart: string }) {
  const [svg, setSvg] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [viewport, setViewport] = useState<MermaidViewport>({ scale: 1, x: 0, y: 0 });
  const [contentSize, setContentSize] = useState<{ width: number; height: number } | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const renderId = `webmcp-mermaid-${useId().replace(/[^a-zA-Z0-9_-]/g, '')}`;
  const containerRef = useRef<HTMLDivElement | null>(null);
  const dragStateRef = useRef<{
    pointerId: number;
    startX: number;
    startY: number;
    originX: number;
    originY: number;
  } | null>(null);

  useEffect(() => {
    logMermaidDebug('mount', {
      renderId,
      chartLength: chart.length,
      cached: mermaidSvgCache.has(chart),
    });
    return () => {
      logMermaidDebug('unmount', {
        renderId,
        chartLength: chart.length,
      });
    };
  }, [chart, renderId]);

  const getDiagramMeasurement = useCallback((): MermaidMeasurement | null => {
    const container = containerRef.current;
    const svgElement = container?.querySelector('svg') ?? null;
    const normalizedSvg = normalizeMermaidSvgElement(svgElement);

    if (!container || !normalizedSvg) {
      return null;
    }

    const measurement = {
      containerWidth: container.clientWidth,
      containerHeight: container.clientHeight,
      contentWidth: normalizedSvg.contentWidth,
      contentHeight: normalizedSvg.contentHeight,
    };
    setContentSize({ width: measurement.contentWidth, height: measurement.contentHeight });
    return measurement;
  }, []);

  const resetViewport = useCallback(() => {
    const measurement = getDiagramMeasurement();
    if (!measurement) {
      return;
    }

    setViewport(
      computeFitMermaidViewport({
        containerWidth: measurement.containerWidth,
        containerHeight: measurement.containerHeight,
        contentWidth: measurement.contentWidth,
        contentHeight: measurement.contentHeight,
        padding: 24,
      })
    );
  }, [getDiagramMeasurement]);

  const handleFitWidth = () => {
    const measurement = getDiagramMeasurement();
    if (!measurement) {
      return;
    }

    setViewport(
      computeFitWidthTopMermaidViewport({
        containerWidth: measurement.containerWidth,
        contentWidth: measurement.contentWidth,
        padding: 24,
      })
    );
  };

  useEffect(() => {
    let cancelled = false;

    const render = async () => {
      try {
        const cachedSvg = mermaidSvgCache.get(chart);
        if (cachedSvg) {
          logMermaidDebug('cache-hit', {
            renderId,
            chartLength: chart.length,
          });
          if (!cancelled) {
            setSvg(cachedSvg);
            setError(null);
            setContentSize(null);
          }
          return;
        }

        logMermaidDebug('render-start', {
          renderId,
          chartLength: chart.length,
        });
        const mermaidModule = await import('mermaid');
        const mermaid = mermaidModule.default;
        if (!mermaidInitialized) {
          mermaid.initialize({
            startOnLoad: false,
            securityLevel: 'loose',
            theme: 'default',
            htmlLabels: false,
          });
          mermaidInitialized = true;
        }
        const result = await mermaid.render(renderId, chart);
        rememberMermaidSvg(chart, result.svg);
        if (!cancelled) {
          setSvg(result.svg);
          setError(null);
          setContentSize(null);
        }
        logMermaidDebug('render-done', {
          renderId,
          chartLength: chart.length,
        });
      } catch (renderError) {
        logMermaidDebug('render-error', {
          renderId,
          chartLength: chart.length,
          error: renderError instanceof Error ? renderError.message : String(renderError),
        });
        if (!cancelled) {
          setSvg('');
          setError(renderError instanceof Error ? renderError.message : String(renderError));
          setContentSize(null);
        }
      }
    };

    void render();

    return () => {
      cancelled = true;
    };
  }, [chart, renderId]);

  useEffect(() => {
    if (!svg || error) {
      return;
    }

    const animationFrame = window.requestAnimationFrame(resetViewport);
    const handleResize = () => resetViewport();
    window.addEventListener('resize', handleResize);
    return () => {
      window.cancelAnimationFrame(animationFrame);
      window.removeEventListener('resize', handleResize);
    };
  }, [error, resetViewport, svg]);

  const handlePointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!svg) {
      return;
    }

    dragStateRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      originX: viewport.x,
      originY: viewport.y,
    };
    setIsDragging(true);
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const handlePointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const dragState = dragStateRef.current;
    if (!dragState || dragState.pointerId !== event.pointerId) {
      return;
    }

    setViewport((current) => ({
      ...current,
      x: dragState.originX + (event.clientX - dragState.startX),
      y: dragState.originY + (event.clientY - dragState.startY),
    }));
  };

  const endDragging = (event: ReactPointerEvent<HTMLDivElement>) => {
    const dragState = dragStateRef.current;
    if (!dragState || dragState.pointerId !== event.pointerId) {
      return;
    }

    dragStateRef.current = null;
    setIsDragging(false);
    event.currentTarget.releasePointerCapture(event.pointerId);
  };

  const handleZoom = (factor: number) => {
    setViewport((current) => ({
      ...current,
      scale: clampMermaidScale(current.scale * factor),
    }));
  };

  const handleActualSize = () => {
    const measurement = getDiagramMeasurement();
    if (!measurement) {
      return;
    }

    setViewport(
      computeCenteredMermaidViewport({
        ...measurement,
        scale: 1,
      })
    );
  };

  if (error) {
    return (
      <pre className="my-4 overflow-auto rounded-md border border-destructive/30 bg-destructive/8 p-4 text-xs text-destructive">
        {error}
      </pre>
    );
  }

  return (
    <div className="my-4 rounded-lg border bg-slate-950 p-3 text-slate-100">
      <div className="mb-2 flex items-center justify-between gap-2 text-xs text-slate-300">
        <span>拖拽平移，按钮缩放</span>
        <div className="flex items-center gap-1">
          <button
            type="button"
            className="rounded border border-slate-700 px-2 py-1 hover:bg-slate-800"
            onClick={handleFitWidth}
          >
            适配宽度
          </button>
          <button
            type="button"
            className="rounded border border-slate-700 px-2 py-1 hover:bg-slate-800"
            onClick={handleActualSize}
          >
            100%
          </button>
          <button
            type="button"
            className="rounded border border-slate-700 px-2 py-1 hover:bg-slate-800"
            onClick={() => handleZoom(0.9)}
          >
            -
          </button>
          <button
            type="button"
            className="rounded border border-slate-700 px-2 py-1 hover:bg-slate-800"
            onClick={resetViewport}
          >
            重置
          </button>
          <button
            type="button"
            className="rounded border border-slate-700 px-2 py-1 hover:bg-slate-800"
            onClick={() => handleZoom(1.1)}
          >
            +
          </button>
        </div>
      </div>
      <div
        ref={containerRef}
        role="application"
        aria-label="Mermaid 流程图画布"
        className={`relative h-[70vh] min-h-[420px] overflow-hidden rounded bg-slate-50 ${isDragging ? 'cursor-grabbing' : 'cursor-grab'}`}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={endDragging}
        onPointerCancel={endDragging}
        onDoubleClick={resetViewport}
      >
        {svg ? (
          <div
            className="absolute left-0 top-0 origin-top-left select-none text-slate-950"
            style={{
              width: contentSize ? `${contentSize.width}px` : undefined,
              height: contentSize ? `${contentSize.height}px` : undefined,
              transform: `translate(${viewport.x}px, ${viewport.y}px) scale(${viewport.scale})`,
            }}
            // biome-ignore lint/security/noDangerouslySetInnerHtml: Mermaid returns sanitized SVG markup for diagram rendering.
            dangerouslySetInnerHTML={{ __html: svg }}
          />
        ) : (
          <div className="flex h-full items-center justify-center text-sm text-slate-500">
            正在渲染 Mermaid...
          </div>
        )}
      </div>
    </div>
  );
}

function CodeBlock({
  className,
  children,
  renderMermaid = true,
}: {
  className?: string;
  children?: ReactNode;
  renderMermaid?: boolean;
}) {
  const [copied, setCopied] = useState(false);
  const raw = String(children ?? '').replace(/\n$/, '');
  const language = parseCodeLanguage(className);

  if (renderMermaid && (language === 'mermaid' || looksLikeMermaidChart(raw))) {
    return <MermaidBlock chart={raw.trim()} />;
  }

  return (
    <div className="group relative my-4">
      {language !== 'text' ? (
        <div className="absolute left-3 top-2 z-10 text-xs font-medium uppercase text-slate-400">
          {language}
        </div>
      ) : null}
      <button
        type="button"
        className="absolute right-2 top-2 z-10 inline-flex items-center gap-1 rounded border border-slate-600 bg-slate-700/80 px-2 py-1 text-xs text-white opacity-0 transition-opacity hover:bg-slate-700 group-hover:opacity-100"
        onClick={() => {
          void navigator.clipboard.writeText(raw).then(() => {
            setCopied(true);
            window.setTimeout(() => setCopied(false), 1600);
          });
        }}
      >
        <CopyIcon className="h-3.5 w-3.5" />
        {copied ? '已复制' : '复制'}
      </button>
      <pre className="overflow-x-auto rounded-lg bg-[#282c34] p-4 pt-8 text-sm leading-6 text-slate-100">
        <code>{raw}</code>
      </pre>
    </div>
  );
}

function MarkdownPreBlock({
  children,
  renderMermaid = true,
}: {
  children?: ReactNode;
  renderMermaid?: boolean;
}) {
  const firstChild = Children.toArray(children)[0];

  if (
    isValidElement<{
      className?: string;
      children?: ReactNode;
    }>(firstChild)
  ) {
    return (
      <CodeBlock className={firstChild.props.className} renderMermaid={renderMermaid}>
        {firstChild.props.children}
      </CodeBlock>
    );
  }

  return (
    <pre className="overflow-x-auto rounded-lg bg-[#282c34] p-4 text-sm leading-6 text-slate-100">
      {children}
    </pre>
  );
}

function MarkdownCode({ className, children }: { className?: string; children?: ReactNode }) {
  const raw = String(children ?? '');
  if (className || /[\r\n]/.test(raw)) {
    return <code className={className}>{children}</code>;
  }

  return <code className="rounded bg-muted px-1.5 py-0.5 text-[0.9em]">{children}</code>;
}

function createMarkdownPreviewComponents(renderMermaid: boolean) {
  return {
    pre: ({ children }: { children?: ReactNode }) => (
      <MarkdownPreBlock renderMermaid={renderMermaid}>{children}</MarkdownPreBlock>
    ),
    code: ({ className, children }: { className?: string; children?: ReactNode }) => (
      <MarkdownCode className={className}>{children}</MarkdownCode>
    ),
    h1: ({ children }: { children?: ReactNode }) => (
      <h1 className="mb-5 mt-8 text-3xl font-bold">{children}</h1>
    ),
    h2: ({ children }: { children?: ReactNode }) => (
      <h2 className="mb-4 mt-8 text-2xl font-bold">{children}</h2>
    ),
    h3: ({ children }: { children?: ReactNode }) => (
      <h3 className="mb-3 mt-6 text-xl font-semibold">{children}</h3>
    ),
    p: ({ children }: { children?: ReactNode }) => (
      <div className="my-3 whitespace-pre-wrap">{children}</div>
    ),
    blockquote: ({ children }: { children?: ReactNode }) => (
      <blockquote className="my-3 border-l-4 border-border pl-4 text-muted-foreground">
        {children}
      </blockquote>
    ),
    a: ({ href, children }: { href?: string; children?: ReactNode }) => (
      <a
        href={href}
        target="_blank"
        rel="noreferrer"
        className="text-primary underline underline-offset-2"
      >
        {children}
      </a>
    ),
    table: ({ children }: { children?: ReactNode }) => (
      <table className="my-4 w-full select-text border-collapse border border-border">
        {children}
      </table>
    ),
    thead: ({ children }: { children?: ReactNode }) => (
      <thead className="bg-muted/50">{children}</thead>
    ),
    th: ({ children }: { children?: ReactNode }) => (
      <th className="select-text break-words border border-border px-3 py-2 text-left text-sm font-semibold [overflow-wrap:anywhere]">
        {children}
      </th>
    ),
    td: ({ children }: { children?: ReactNode }) => (
      <td className="select-text break-words border border-border px-3 py-2 align-top text-sm [overflow-wrap:anywhere]">
        {children}
      </td>
    ),
  };
}

export function markdownPreviewComponents(renderMermaid: boolean) {
  const cached = markdownPreviewComponentsCache.get(renderMermaid);
  if (cached) {
    return cached;
  }

  const created = createMarkdownPreviewComponents(renderMermaid);
  markdownPreviewComponentsCache.set(renderMermaid, created);
  return created;
}

export function findActiveAnnotationById(
  annotations: FileAnnotation[],
  matchedAnnotationIds: ReadonlySet<string>,
  annotationId: string
): ResolvedFileAnnotation | null {
  const annotation = annotations.find((item) => item.id === annotationId);
  if (!annotation || !matchedAnnotationIds.has(annotationId)) {
    return null;
  }
  return {
    ...annotation,
    status: 'active',
  };
}

const MarkdownPreview = memo(function MarkdownPreview({
  content,
  annotations,
  matchedAnnotationIds,
  projectPath,
  filePath,
  activeAnnotationPreviewRef,
  pendingHighlightRange,
  onPendingSelectionChange,
  onAnnotationPreviewClose,
  onAnnotationPreviewOpen,
  onImageInsertTargetChange,
  onImageInsertRequest,
  onResolvedAnnotationIdsChange,
  renderMermaid = true,
}: {
  content: string;
  annotations: FileAnnotation[];
  matchedAnnotationIds: ReadonlySet<string>;
  projectPath: string;
  filePath: string;
  activeAnnotationPreviewRef: { current: ActiveAnnotationPreview | null };
  pendingHighlightRange: Range | null;
  onPendingSelectionChange: (selection: PendingAnnotationSelection | null) => void;
  onAnnotationPreviewClose: () => void;
  onAnnotationPreviewOpen: (preview: ActiveAnnotationPreview) => void;
  onImageInsertTargetChange: (target: MarkdownImageInsertTarget) => void;
  onImageInsertRequest: (offset: number) => void;
  onResolvedAnnotationIdsChange: (annotationIds: Set<string>) => void;
  renderMermaid?: boolean;
}) {
  const articleRef = useRef<HTMLElement | null>(null);
  const annotationTargetsRef = useRef<AnnotationHitTarget[]>([]);
  const annotationHighlightRangesRef = useRef<Range[]>([]);
  const pendingHighlightRangeRef = useRef<Range | null>(null);
  const [annotationHighlightRects, setAnnotationHighlightRects] = useState<HighlightRect[]>([]);
  const [pendingHighlightRects, setPendingHighlightRects] = useState<HighlightRect[]>([]);
  const [isCtrlPressed, setIsCtrlPressed] = useState(false);
  const [floatingImageInsertTarget, setFloatingImageInsertTarget] =
    useState<MarkdownFloatingImageInsertTarget | null>(null);
  const remarkPlugins = useMemo<PluggableList>(() => [remarkGfm, remarkMath], []);
  const rehypePlugins = useMemo<PluggableList>(() => [rehypeKatex], []);

  const refreshOverlayRects = useCallback(() => {
    setAnnotationHighlightRects(
      collectViewportHighlightRects(annotationHighlightRangesRef.current)
    );
    setPendingHighlightRects(
      pendingHighlightRangeRef.current
        ? collectViewportHighlightRects([pendingHighlightRangeRef.current])
        : []
    );
  }, []);

  useEffect(() => {
    if (!articleRef.current) {
      return;
    }
    const cssHighlights = (
      CSS as unknown as {
        highlights?: {
          set: (name: string, highlight: unknown) => void;
          delete: (name: string) => void;
        };
      }
    ).highlights;
    const HighlightCtor = (
      globalThis as unknown as { Highlight?: new (...ranges: Range[]) => unknown }
    ).Highlight;

    const matchedAnnotationIds = new Set<string>();
    const ranges: Range[] = [];
    const targets: AnnotationHitTarget[] = [];
    const shouldRenderOverlayFallback = shouldRenderHighlightOverlayFallback(
      cssHighlights,
      HighlightCtor
    );
    annotations.forEach((annotation) => {
      const article = articleRef.current as HTMLElement;
      const range = findTextRange(article, annotation.selectedText, annotation.anchor);
      if (!range) {
        return;
      }

      matchedAnnotationIds.add(annotation.id);
      const highlightRanges = findTextHighlightRanges(
        article,
        annotation.selectedText,
        annotation.anchor
      );
      const resolvedRanges = highlightRanges.length > 0 ? highlightRanges : [range];
      ranges.push(...resolvedRanges);
      const hitRanges = resolvedRanges;
      const hasVisibleRect = hitRanges.some(
        (highlightRange) => Array.from(highlightRange.getClientRects()).length > 0
      );
      if (hasVisibleRect) {
        targets.push({
          annotationId: annotation.id,
          ranges: hitRanges,
        });
      }
    });

    onResolvedAnnotationIdsChange(matchedAnnotationIds);
    annotationTargetsRef.current = targets;
    annotationHighlightRangesRef.current = shouldRenderOverlayFallback ? ranges : [];
    if (shouldRenderOverlayFallback) {
      refreshOverlayRects();
    } else {
      setAnnotationHighlightRects([]);
    }
    if (cssHighlights && HighlightCtor) {
      cssHighlights.set('webmcp-file-annotation', new HighlightCtor(...ranges));
    }
    return () => {
      onResolvedAnnotationIdsChange(new Set());
      annotationTargetsRef.current = [];
      annotationHighlightRangesRef.current = [];
      setAnnotationHighlightRects([]);
      cssHighlights?.delete('webmcp-file-annotation');
    };
  }, [annotations, content, onResolvedAnnotationIdsChange, refreshOverlayRects, renderMermaid]);

  useEffect(() => {
    syncPendingAnnotationHighlight(pendingHighlightRange);
    pendingHighlightRangeRef.current = pendingHighlightRange;
    refreshOverlayRects();
    return () => {
      syncPendingAnnotationHighlight(null);
      pendingHighlightRangeRef.current = null;
      setPendingHighlightRects([]);
    };
  }, [pendingHighlightRange, refreshOverlayRects]);

  useEffect(() => {
    const article = articleRef.current;
    if (!article) {
      return;
    }

    let frame = 0;
    const scheduleRefresh = () => {
      if (frame !== 0) {
        return;
      }
      frame = window.requestAnimationFrame(() => {
        frame = 0;
        refreshOverlayRects();
      });
    };

    const resizeObserver =
      typeof ResizeObserver !== 'undefined'
        ? new ResizeObserver(() => scheduleRefresh())
        : null;
    resizeObserver?.observe(article);
    window.addEventListener('resize', scheduleRefresh);
    window.addEventListener('scroll', scheduleRefresh, true);

    return () => {
      if (frame !== 0) {
        window.cancelAnimationFrame(frame);
      }
      resizeObserver?.disconnect();
      window.removeEventListener('resize', scheduleRefresh);
      window.removeEventListener('scroll', scheduleRefresh, true);
    };
  }, [refreshOverlayRects]);

  useEffect(() => {
    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (!(target instanceof HTMLElement)) {
        return;
      }
      if (target.closest('[data-markdown-annotation-action="true"]')) {
        return;
      }
      onPendingSelectionChange(null);
    };

    window.addEventListener('pointerdown', handlePointerDown);
    return () => window.removeEventListener('pointerdown', handlePointerDown);
  }, [onPendingSelectionChange]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Control') {
        setIsCtrlPressed(true);
      }
    };
    const handleKeyUp = (event: KeyboardEvent) => {
      if (event.key === 'Control') {
        setIsCtrlPressed(false);
        setFloatingImageInsertTarget(null);
      }
    };
    const handleBlur = () => {
      setIsCtrlPressed(false);
      setFloatingImageInsertTarget(null);
    };

    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    window.addEventListener('blur', handleBlur);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
      window.removeEventListener('blur', handleBlur);
    };
  }, []);

  const handleMouseUp = useCallback(() => {
    const selection = window.getSelection();
    if (!articleRef.current || !selection || selection.rangeCount === 0) {
      return;
    }
    const range = selection.getRangeAt(0);
    const selectedText = range.toString().trim();
    if (!selectedText) {
      return;
    }
    if (!articleRef.current.contains(range.commonAncestorContainer)) {
      return;
    }
    const insertTarget = buildMarkdownInsertTargetFromNode(
      articleRef.current,
      range.commonAncestorContainer
    );
    onImageInsertTargetChange(resolveMarkdownInsertOffset(content, insertTarget));
    const anchor = buildTextRangeAnchor(articleRef.current, range, selectedText);
    const rect = range.getBoundingClientRect();
    const pendingSelection = buildPendingAnnotationSelection({
      selectedText,
      range,
      anchor,
      rect: {
        left: rect.left,
        width: rect.width,
        bottom: rect.bottom,
      },
      viewport: {
        width: window.innerWidth,
        height: window.innerHeight,
      },
    });
    onPendingSelectionChange(pendingSelection);
  }, [content, onImageInsertTargetChange, onPendingSelectionChange]);

  const handlePointerUp = useCallback(
    (event: ReactPointerEvent<HTMLElement>) => {
      const target = event.target;
      if (!(target instanceof HTMLElement)) {
        return;
      }
      if (
        target.closest('[data-markdown-annotation-overlay="true"]') ||
        target.closest('[data-markdown-annotation-action="true"]') ||
        window.getSelection()?.toString().trim()
      ) {
        return;
      }

      if (articleRef.current) {
        const insertTarget = buildMarkdownInsertTargetFromNode(articleRef.current, target);
        const resolvedTarget = resolveMarkdownInsertOffset(content, insertTarget);
        onImageInsertTargetChange(resolvedTarget);
      }

      const annotationId = findAnnotationIdAtPoint(annotationTargetsRef.current, {
        x: event.clientX,
        y: event.clientY,
      });
      if (!annotationId) {
        onAnnotationPreviewClose();
        onPendingSelectionChange(null);
        return;
      }

      const annotation = findActiveAnnotationById(
        annotations,
        matchedAnnotationIds,
        annotationId
      );
      if (!annotation) {
        onAnnotationPreviewClose();
        onPendingSelectionChange(null);
        return;
      }

      const position = {
        x: Math.min(event.clientX + 12, Math.max(window.innerWidth - 420, 24)),
        y: Math.min(event.clientY + 12, Math.max(window.innerHeight - 240, 24)),
      };
      const activeAnnotationPreview = activeAnnotationPreviewRef.current;
      if (
        activeAnnotationPreview?.annotation.id === annotation.id &&
        Math.abs(activeAnnotationPreview.x - position.x) < 2 &&
        Math.abs(activeAnnotationPreview.y - position.y) < 2
      ) {
        onAnnotationPreviewClose();
        onPendingSelectionChange(null);
        return;
      }

      onPendingSelectionChange(null);
      onAnnotationPreviewOpen({
        annotation,
        x: position.x,
        y: position.y,
      });
    },
    [
      activeAnnotationPreviewRef,
      annotations,
      matchedAnnotationIds,
      content,
      onPendingSelectionChange,
      onAnnotationPreviewClose,
      onAnnotationPreviewOpen,
      onImageInsertTargetChange,
    ]
  );

  const handlePointerMove = useCallback(
    (event: ReactPointerEvent<HTMLElement>) => {
      const target = event.target;
      const article = articleRef.current;
      if (!article || !(target instanceof Node)) {
        return;
      }
      if (!event.ctrlKey && !isCtrlPressed) {
        setFloatingImageInsertTarget(null);
        return;
      }

      const floatingTarget = buildMarkdownFloatingImageInsertTarget({
        root: article,
        node: target,
        source: content,
        viewportWidth: window.innerWidth,
      });
      if (!floatingTarget.ok) {
        return;
      }

      onImageInsertTargetChange({ ok: true, offset: floatingTarget.offset });
      setFloatingImageInsertTarget({
        offset: floatingTarget.offset,
        x: floatingTarget.x,
        y: floatingTarget.y,
      });
    },
    [content, isCtrlPressed, onImageInsertTargetChange]
  );

  return (
    <MarkdownPreviewBody
      articleRef={articleRef}
      annotationHighlightRects={annotationHighlightRects}
      content={content}
      filePath={filePath}
      floatingImageInsertTarget={floatingImageInsertTarget}
      onMouseUp={handleMouseUp}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onImageInsertRequest={onImageInsertRequest}
      pendingHighlightRects={pendingHighlightRects}
      projectPath={projectPath}
      rehypePlugins={rehypePlugins}
      remarkPlugins={remarkPlugins}
      renderMermaid={renderMermaid}
    />
  );
});

const MarkdownPreviewBody = memo(function MarkdownPreviewBody({
  articleRef,
  annotationHighlightRects,
  content,
  filePath,
  floatingImageInsertTarget,
  onMouseUp,
  onPointerMove,
  onPointerUp,
  onImageInsertRequest,
  pendingHighlightRects,
  projectPath,
  rehypePlugins,
  remarkPlugins,
  renderMermaid,
}: {
  articleRef: { current: HTMLElement | null };
  annotationHighlightRects: HighlightRect[];
  content: string;
  filePath: string;
  floatingImageInsertTarget: MarkdownFloatingImageInsertTarget | null;
  onMouseUp: () => void;
  onPointerMove: (event: ReactPointerEvent<HTMLElement>) => void;
  onPointerUp: (event: ReactPointerEvent<HTMLElement>) => void;
  onImageInsertRequest: (offset: number) => void;
  pendingHighlightRects: HighlightRect[];
  projectPath: string;
  rehypePlugins: PluggableList;
  remarkPlugins: PluggableList;
  renderMermaid: boolean;
}) {
  const markdownComponents = useMemo(
    () => ({
      ...markdownPreviewComponents(renderMermaid),
      img: ({ src, alt }: { src?: string; alt?: string }) => (
        <img
          src={buildMarkdownPreviewImageUrl({
            backendBaseUrl: config.api.agentV2BaseUrl,
            projectPath,
            markdownFilePath: filePath,
            imageSrc: src,
          })}
          alt={alt || ''}
          className="my-4 max-w-full rounded-md border"
        />
      ),
    }),
    [filePath, projectPath, renderMermaid]
  );

  return (
    <article
      ref={articleRef}
      className="relative mx-auto max-w-5xl px-8 py-8 text-sm leading-7"
      onMouseUp={onMouseUp}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
    >
      {typeof document !== 'undefined'
        ? createPortal(
            <div className="pointer-events-none fixed inset-0 z-40">
              {annotationHighlightRects.map((rect, index) => (
                <div
                  key={`annotation-${rect.left}-${rect.top}-${index}`}
                  className="absolute rounded-[3px] bg-yellow-300/55"
                  style={{
                    left: rect.left,
                    top: rect.top,
                    width: rect.width,
                    height: rect.height,
                  }}
                />
              ))}
              {pendingHighlightRects.map((rect, index) => (
                <div
                  key={`pending-${rect.left}-${rect.top}-${index}`}
                  className="absolute rounded-[3px] bg-blue-300/45"
                  style={{
                    left: rect.left,
                    top: rect.top,
                    width: rect.width,
                    height: rect.height,
                  }}
                />
              ))}
            </div>,
            document.body
          )
        : null}
      {floatingImageInsertTarget && typeof document !== 'undefined'
        ? createPortal(
            <button
              type="button"
              className="fixed z-50 flex h-9 w-9 items-center justify-center rounded-full border bg-background text-foreground shadow-lg transition-colors hover:border-primary hover:bg-primary hover:text-primary-foreground"
              style={{
                left: floatingImageInsertTarget.x,
                top: floatingImageInsertTarget.y,
              }}
              title="在此处插入图片"
              aria-label="在此处插入图片"
              onMouseDown={(event) => {
                event.preventDefault();
                event.stopPropagation();
              }}
              onClick={(event) => {
                event.preventDefault();
                event.stopPropagation();
                onImageInsertRequest(floatingImageInsertTarget.offset);
              }}
            >
              <ImagePlusIcon className="h-4 w-4" />
            </button>,
            document.body
          )
        : null}
      <div className="relative z-10">
        <ReactMarkdown
          remarkPlugins={remarkPlugins}
          rehypePlugins={rehypePlugins}
          urlTransform={preserveMarkdownHref}
          components={markdownComponents}
        >
          {content}
        </ReactMarkdown>
      </div>
    </article>
  );
});

function AnnotationComposer({
  draft,
  saving,
  onNoteChange,
  onClose,
  onSave,
  onSend,
}: {
  draft: AnnotationDraft;
  saving: boolean;
  onNoteChange: (value: string) => void;
  onClose: () => void;
  onSave: () => void;
  onSend: () => void;
}) {
  return (
    <div
      data-markdown-annotation-overlay="true"
      className="fixed z-50 w-[360px] rounded-xl border bg-background p-3 shadow-xl"
      style={{ left: draft.x, top: draft.y }}
    >
      <div className="mb-2 rounded-md bg-muted px-3 py-2 text-xs leading-5 text-muted-foreground">
        {truncateText(draft.selectedText, 120)}
      </div>
      <textarea
        value={draft.note}
        onChange={(event) => onNoteChange(event.target.value)}
        className="h-28 w-full resize-none rounded-md border bg-background px-3 py-2 text-sm outline-none focus:border-primary"
        placeholder="输入标注内容..."
      />
      <div className="mt-3 flex items-center justify-end gap-2">
        <Button variant="outline" size="sm" onClick={onClose}>
          取消
        </Button>
        <Button variant="outline" size="sm" onClick={onSend} disabled={!draft.note.trim()}>
          发送到对话
        </Button>
        <Button size="sm" onClick={onSave} disabled={saving || !draft.note.trim()}>
          {saving ? '保存中' : '保存'}
        </Button>
      </div>
    </div>
  );
}

export function MarkdownImageInsertOverlay({
  draft,
  saving,
  onAltChange,
  onCancel,
  onConfirm,
}: {
  draft: MarkdownImageInsertDraft | null;
  saving: boolean;
  onAltChange: (alt: string) => void;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  if (!draft) {
    return null;
  }

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/60 backdrop-blur-sm">
      <div className="w-[min(420px,calc(100vw-32px))] rounded-lg border bg-background p-4 shadow-xl">
        <div className="mb-3 flex items-center gap-2">
          <ImagePlusIcon className="h-4 w-4 text-primary" />
          <h2 className="text-sm font-semibold">插入图片</h2>
        </div>
        <label className="block text-xs font-medium text-muted-foreground" htmlFor="markdown-image-alt">
          图片说明
        </label>
        <input
          id="markdown-image-alt"
          className="mt-1 w-full rounded-md border bg-background px-3 py-2 text-sm outline-none focus:border-primary"
          value={draft.alt}
          onChange={(event) => onAltChange(event.target.value)}
          autoFocus
        />
        <div className="mt-4 flex justify-end gap-2">
          <Button variant="outline" size="sm" onClick={onCancel} disabled={saving}>
            取消
          </Button>
          <Button size="sm" onClick={onConfirm} disabled={saving}>
            {saving ? '插入中' : '插入'}
          </Button>
        </div>
      </div>
    </div>,
    document.body
  );
}

function AnnotationPreviewCard({
  preview,
  onClose,
  onEdit,
}: {
  preview: ActiveAnnotationPreview;
  onClose: () => void;
  onEdit: () => void;
}) {
  return (
    <div
      data-markdown-annotation-overlay="true"
      className="fixed z-50 w-[360px] rounded-xl border bg-background p-3 shadow-xl"
      style={{ left: preview.x, top: preview.y }}
    >
      <div className="mb-2 rounded-md bg-muted px-3 py-2 text-xs leading-5 text-muted-foreground">
        {truncateText(preview.annotation.selectedText, 120)}
      </div>
      <div className="max-h-48 overflow-auto whitespace-pre-wrap break-words rounded-md border bg-background px-3 py-2 text-sm leading-6 text-foreground">
        {preview.annotation.note}
      </div>
      <div className="mt-3 flex items-center justify-end gap-2">
        <Button variant="outline" size="sm" onClick={onClose}>
          关闭
        </Button>
        <Button size="sm" onClick={onEdit}>
          编辑
        </Button>
      </div>
    </div>
  );
}

function AnnotationActionButton({
  selection,
  onCreate,
}: {
  selection: PendingAnnotationSelection;
  onCreate: () => void;
}) {
  return (
    <div
      data-markdown-annotation-action="true"
      className="fixed z-50"
      style={{ left: selection.x, top: selection.y }}
    >
      <Button
        size="sm"
        className="h-8 rounded-full px-3 shadow-lg"
        onPointerDown={(event) => event.preventDefault()}
        onMouseDown={(event) => event.preventDefault()}
        onClick={onCreate}
      >
        <MessageSquarePlusIcon className="mr-1 h-4 w-4" />
        <span>批注</span>
      </Button>
    </div>
  );
}

function AnnotationOverlayLayer({
  pendingSelection,
  activeAnnotationPreview,
  annotationDraft,
  annotationSaving,
  onCreateAnnotation,
  onCloseAnnotationPreview,
  onEditAnnotationPreview,
  onAnnotationDraftChange,
  onCloseAnnotationDraft,
  onSaveAnnotationDraft,
  onSendAnnotationDraft,
}: {
  pendingSelection: PendingAnnotationSelection | null;
  activeAnnotationPreview: ActiveAnnotationPreview | null;
  annotationDraft: AnnotationDraft | null;
  annotationSaving: boolean;
  onCreateAnnotation: () => void;
  onCloseAnnotationPreview: () => void;
  onEditAnnotationPreview: () => void;
  onAnnotationDraftChange: (note: string) => void;
  onCloseAnnotationDraft: () => void;
  onSaveAnnotationDraft: () => void;
  onSendAnnotationDraft: () => void;
}) {
  if (typeof document === 'undefined') {
    return null;
  }

  return createPortal(
    <>
      {pendingSelection && !activeAnnotationPreview && !annotationDraft ? (
        <AnnotationActionButton selection={pendingSelection} onCreate={onCreateAnnotation} />
      ) : null}
      {activeAnnotationPreview ? (
        <AnnotationPreviewCard
          preview={activeAnnotationPreview}
          onClose={onCloseAnnotationPreview}
          onEdit={onEditAnnotationPreview}
        />
      ) : null}
      {annotationDraft ? (
        <AnnotationComposer
          draft={annotationDraft}
          saving={annotationSaving}
          onNoteChange={onAnnotationDraftChange}
          onClose={onCloseAnnotationDraft}
          onSave={onSaveAnnotationDraft}
          onSend={onSendAnnotationDraft}
        />
      ) : null}
    </>,
    document.body
  );
}

function AnnotationMenu({
  annotations,
  onEdit,
  onDelete,
  onSend,
  onSendAll,
}: {
  annotations: ResolvedFileAnnotation[];
  onEdit: (annotation: ResolvedFileAnnotation) => void;
  onDelete: (annotationId: string) => void;
  onSend: (annotation: ResolvedFileAnnotation) => void;
  onSendAll: () => void;
}) {
  const activeAnnotationCount = countActiveAnnotations(annotations);
  const annotationCountLabel = formatAnnotationCountLabel(
    activeAnnotationCount,
    annotations.length
  );

  return (
    <div className="absolute right-0 top-full z-40 mt-2 w-[360px] rounded-xl border bg-background p-2 shadow-xl">
      <div className="mb-2 flex items-center justify-between gap-2 px-2 py-1">
        <div>
          <p className="text-sm font-medium">当前文件标注</p>
          <p className="text-[11px] text-muted-foreground">有效 {annotationCountLabel}</p>
        </div>
        <Button
          variant="outline"
          size="sm"
          className="h-8 px-2"
          onClick={onSendAll}
          disabled={activeAnnotationCount === 0}
        >
          <MessageSquarePlusIcon className="h-3.5 w-3.5" />
          全部发送
        </Button>
      </div>
      {annotations.length === 0 ? (
        <div className="rounded-lg border border-dashed px-3 py-6 text-center text-xs text-muted-foreground">
          还没有保存的标注
        </div>
      ) : (
        <div className="max-h-[360px] space-y-2 overflow-y-auto pr-1">
          {annotations.map((annotation) => (
            <div
              key={annotation.id}
              className={`group relative rounded-lg border p-3 pr-24 transition-colors hover:border-primary/40 hover:bg-muted/30 ${annotation.status === 'invalid' ? 'border-dashed bg-muted/20 opacity-70' : ''}`}
            >
              <div className="flex items-center gap-2 pr-2">
                <p
                  className="min-w-0 flex-1 truncate text-sm font-medium"
                  title={annotation.selectedText}
                >
                  {truncateText(annotation.selectedText, 48)}
                </p>
                {annotation.status === 'invalid' ? (
                  <span className="shrink-0 rounded-full border border-amber-300 bg-amber-50 px-1.5 py-0.5 text-[10px] font-medium leading-none text-amber-700">
                    已作废
                  </span>
                ) : null}
              </div>
              <p
                className="mt-1 line-clamp-2 text-xs text-muted-foreground"
                title={annotation.note}
              >
                {annotation.note}
              </p>
              {annotation.status === 'invalid' ? (
                <p className="mt-2 text-[11px] text-amber-700">
                  原文已变更，当前预览里找不到这段选中文本。
                </p>
              ) : null}
              <div className="absolute right-3 top-3 flex items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100">
                <button
                  type="button"
                  className="rounded-md p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground"
                  title="编辑该标注"
                  onClick={() => onEdit(annotation)}
                >
                  <PencilIcon className="h-3.5 w-3.5" />
                </button>
                <button
                  type="button"
                  className="rounded-md p-1.5 text-red-600 hover:bg-red-50 hover:text-red-700"
                  title="删除该标注"
                  onClick={() => onDelete(annotation.id)}
                >
                  <Trash2Icon className="h-3.5 w-3.5" />
                </button>
                <button
                  type="button"
                  className="rounded-md p-1.5 text-blue-600 hover:bg-blue-50 hover:text-blue-700 disabled:cursor-not-allowed disabled:opacity-40"
                  title="将该标注追加到聊天输入框"
                  disabled={annotation.status === 'invalid'}
                  onClick={() => onSend(annotation)}
                >
                  <SendHorizontalIcon className="h-3.5 w-3.5" />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function SourceEditor({
  filePath,
  content,
  onChange,
  scrollToOffset,
}: {
  filePath: string;
  content: string;
  onChange: (value: string) => void;
  scrollToOffset?: number | null;
}) {
  const extensions = useMemo(() => codeMirrorExtensions(filePath), [filePath]);
  const viewRef = useRef<EditorView | null>(null);

  useEffect(() => {
    const view = viewRef.current;
    if (!view || scrollToOffset === null || scrollToOffset === undefined) {
      return;
    }
    const position = Math.max(0, Math.min(scrollToOffset, view.state.doc.length));
    view.dispatch({
      selection: { anchor: position },
      effects: CodeMirrorEditorView.scrollIntoView(position, { y: 'center' }),
    });
  }, [scrollToOffset]);

  return (
    <div className="min-h-0 flex-1 bg-[#1f2430] [&_.cm-editor]:h-full [&_.cm-gutters]:border-r-[#2f3542] [&_.cm-scroller]:font-mono">
      <CodeMirror
        value={content}
        onChange={onChange}
        onCreateEditor={(view) => {
          viewRef.current = view;
        }}
        extensions={extensions}
        theme={oneDark}
        height="100%"
        style={{
          height: '100%',
          width: '100%',
          fontSize: '14px',
        }}
        basicSetup={{
          lineNumbers: true,
          foldGutter: true,
          dropCursor: false,
          allowMultipleSelections: false,
          indentOnInput: true,
          bracketMatching: true,
          closeBrackets: true,
          autocompletion: true,
          highlightSelectionMatches: true,
          searchKeymap: true,
        }}
      />
    </div>
  );
}

function FilePreviewPage() {
  const params = useMemo(readPreviewParams, []);
  const agentClient = useMemo(
    () =>
      createAgentV2Client({
        baseUrl: config.api.agentV2BaseUrl,
        endpoint: config.api.agentV2Endpoint,
      }),
    []
  );
  const [content, setContent] = useState('');
  const [draftContent, setDraftContent] = useState('');
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const [error, setError] = useState<string | null>(null);
  const [annotations, setAnnotations] = useState<FileAnnotation[]>([]);
  const [activeAnnotationPreview, setActiveAnnotationPreview] =
    useState<ActiveAnnotationPreview | null>(null);
  const [annotationDraft, setAnnotationDraft] = useState<AnnotationDraft | null>(null);
  const [pendingAnnotationSelection, setPendingAnnotationSelection] =
    useState<PendingAnnotationSelection | null>(null);
  const [matchedAnnotationIds, setMatchedAnnotationIds] = useState<Set<string>>(new Set());
  const [isAnnotationMenuOpen, setIsAnnotationMenuOpen] = useState(false);
  const [isDownloadMenuOpen, setIsDownloadMenuOpen] = useState(false);
  const [downloadStatus, setDownloadStatus] = useState<'idle' | 'exporting'>('idle');
  const [annotationSaving, setAnnotationSaving] = useState(false);
  const [imageInsertDraft, setImageInsertDraft] = useState<MarkdownImageInsertDraft | null>(null);
  const [imageInsertSaving, setImageInsertSaving] = useState(false);
  const [liveWrite, setLiveWrite] = useState<LiveWritePreviewPayload | null>(null);
  const [isSyncingLiveWrite, setIsSyncingLiveWrite] = useState(false);
  const [liveScrollOffset, setLiveScrollOffset] = useState<number | null>(null);
  const activeAnnotationPreviewRef = useRef<ActiveAnnotationPreview | null>(null);
  const pendingAnnotationSelectionRef = useRef<PendingAnnotationSelection | null>(null);
  const imageFileInputRef = useRef<HTMLInputElement | null>(null);
  const imageInsertTargetRef = useRef<MarkdownImageInsertTarget | null>(null);
  const liveAnimationRef = useRef<number | null>(null);
  const liveApplyRef = useRef<(payload: LiveWritePreviewPayload) => void>(() => undefined);
  const liveBaseContentRef = useRef<string>('');
  const livePayloadVersionRef = useRef<string | null>(null);
  const liveWriteIdRef = useRef<string | null>(null);
  const liveShownLengthRef = useRef<number>(0);
  const kind = previewKind(params.filePath) as FilePreviewKind;
  const [viewMode, setViewMode] = useState<'preview' | 'source'>(() =>
    filePreviewDefaultViewMode(kind)
  );
  const hasPreviewMode = filePreviewSupportsRenderedPreview(kind);
  const isSourceMode = !hasPreviewMode || viewMode === 'source';
  const hasUnsavedChanges = draftContent !== content;
  const htmlBrowserPreviewMode: 'file' | 'live-preview' =
    kind === 'html' && liveWrite ? 'live-preview' : 'file';
  const browserPreviewUrl = useMemo(
    () =>
      kind === 'html'
        ? buildHtmlBrowserPreviewUrl({
            ...params,
            backendBaseUrl: config.api.agentV2BaseUrl,
            mode: htmlBrowserPreviewMode,
          })
        : null,
    [config.api.agentV2BaseUrl, htmlBrowserPreviewMode, kind, params]
  );
  const resolvedAnnotations = useMemo(
    () => resolveAnnotationStatuses(annotations, matchedAnnotationIds),
    [annotations, matchedAnnotationIds]
  );
  const activeAnnotationCount = useMemo(
    () => countActiveAnnotations(resolvedAnnotations),
    [resolvedAnnotations]
  );
  const pendingHighlightRange = pendingAnnotationSelection?.range ?? annotationDraft?.range ?? null;
  const annotationCountLabel = useMemo(
    () => formatAnnotationCountLabel(activeAnnotationCount, resolvedAnnotations.length),
    [activeAnnotationCount, resolvedAnnotations.length]
  );

  const load = useCallback(async () => {
    setStatus('loading');
    setError(null);
    setSaveStatus('idle');
    try {
      const nextContent = await agentClient.readFile(params);
      setContent(nextContent);
      setDraftContent(nextContent);
      setStatus('ready');
    } catch (loadError) {
      setStatus('error');
      setError(loadError instanceof Error ? loadError.message : String(loadError));
    }
  }, [agentClient, params]);

  const openBrowserPreview = useCallback(() => {
    if (!browserPreviewUrl) {
      return;
    }
    void openHtmlBrowserPreview(browserPreviewUrl, {
      fallbackUrl: buildFileBrowserPreviewUrl(params),
    });
  }, [browserPreviewUrl, params]);

  const save = useCallback(async () => {
    setSaveStatus('saving');
    setError(null);
    try {
      await agentClient.writeFile({
        ...params,
        content: draftContent,
      });
      setContent(draftContent);
      if (kind === 'html' && browserPreviewUrl) {
        void reloadHtmlBrowserPreview(browserPreviewUrl);
      }
      setSaveStatus('saved');
      window.setTimeout(() => setSaveStatus('idle'), 1800);
    } catch (saveError) {
      setSaveStatus('error');
      setError(saveError instanceof Error ? saveError.message : String(saveError));
    }
  }, [agentClient, browserPreviewUrl, draftContent, kind, params]);

  const applyLiveWrite = useCallback(
    (payload: LiveWritePreviewPayload) => {
      if (payload.projectPath !== params.projectPath || payload.filePath !== params.filePath) {
        return;
      }

      const payloadVersion = liveWritePreviewPayloadVersion(payload);
      if (payloadVersion === livePayloadVersionRef.current) {
        return;
      }
      livePayloadVersionRef.current = payloadVersion;

      if (liveAnimationRef.current !== null) {
        window.clearInterval(liveAnimationRef.current);
        liveAnimationRef.current = null;
      }

      if (payload.id !== liveWriteIdRef.current) {
        liveShownLengthRef.current = 0;
        liveBaseContentRef.current = content || draftContent;
        liveWriteIdRef.current = payload.id;
      }
      setLiveWrite(payload);
      setStatus('ready');
      setError(null);

      const baseContent = liveBaseContentRef.current;
      const editStart =
        payload.operation === 'edit' && payload.oldString
          ? baseContent.indexOf(payload.oldString)
          : -1;
      const projectedContent =
        payload.operation === 'edit' && payload.oldString && editStart >= 0
          ? payload.replaceAll
            ? baseContent.split(payload.oldString).join(payload.newString ?? payload.content)
            : `${baseContent.slice(0, editStart)}${payload.newString ?? payload.content}${baseContent.slice(
                editStart + payload.oldString.length
              )}`
          : payload.content;
      const targetStart = payload.targetOffset ?? (editStart >= 0 ? editStart : 0);
      const animatedContent =
        payload.operation === 'edit' ? (payload.newString ?? payload.content) : payload.content;
      const chunkSize = Math.max(1, Math.ceil(animatedContent.length / 900));
      let index =
        payload.operation === 'edit'
          ? 0
          : Math.min(liveShownLengthRef.current, animatedContent.length);
      if (payload.operation !== 'edit' && index === 0) {
        setDraftContent('');
      }

      liveAnimationRef.current = window.setInterval(() => {
        index = Math.min(animatedContent.length, index + chunkSize);
        liveShownLengthRef.current = index;
        if (payload.operation === 'edit' && payload.oldString && editStart >= 0) {
          const currentNewString = animatedContent.slice(0, index);
          const nextContent = payload.replaceAll
            ? baseContent.split(payload.oldString).join(currentNewString)
            : `${baseContent.slice(0, editStart)}${currentNewString}${baseContent.slice(
                editStart + payload.oldString.length
              )}`;
          setDraftContent(nextContent);
          setLiveScrollOffset(targetStart + currentNewString.length);
        } else {
          setDraftContent(animatedContent.slice(0, index));
          setLiveScrollOffset(index);
        }
        if (index >= animatedContent.length) {
          if (liveAnimationRef.current !== null) {
            window.clearInterval(liveAnimationRef.current);
            liveAnimationRef.current = null;
          }
          if (payload.status === 'completed') {
            setContent(projectedContent);
            setDraftContent(projectedContent);
            setIsSyncingLiveWrite(true);
            window.setTimeout(() => {
              agentClient
                .readFile(params)
                .then((nextContent) => {
                  setContent(nextContent);
                  setDraftContent(nextContent);
                  setLiveWrite(null);
                  setLiveScrollOffset(null);
                  liveBaseContentRef.current = '';
                  livePayloadVersionRef.current = null;
                  liveWriteIdRef.current = null;
                  liveShownLengthRef.current = 0;
                  if (kind === 'html' && browserPreviewUrl) {
                    void reloadHtmlBrowserPreview(browserPreviewUrl);
                  }
                })
                .catch((syncError) => {
                  console.debug('[file-preview] failed to sync completed live write:', syncError);
                })
                .finally(() => {
                  setIsSyncingLiveWrite(false);
                });
            }, 600);
          }
        }
      }, 16);
    },
    [agentClient, browserPreviewUrl, content, draftContent, kind, params]
  );

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    setViewMode(filePreviewDefaultViewMode(kind));
  }, [kind]);

  useEffect(() => {
    liveApplyRef.current = applyLiveWrite;
  }, [applyLiveWrite]);

  useEffect(() => {
    if (!params.liveWrite) {
      return;
    }
    let cancelled = false;
    readLiveWritePreview(params.projectPath, params.filePath)
      .then((payload) => {
        if (!cancelled && payload && payload.status !== 'completed') {
          liveApplyRef.current(payload);
        }
      })
      .catch((liveWriteError) => {
        console.debug('[file-preview] failed to read live write preview:', liveWriteError);
      });
    return () => {
      cancelled = true;
    };
  }, [params.filePath, params.liveWrite, params.projectPath]);

  useEffect(() => {
    if (!params.liveWrite) {
      return;
    }
    const handleMessage = (message: unknown) => {
      if (isLiveWritePreviewMessage(message)) {
        liveApplyRef.current(message.payload);
      }
    };
    chrome.runtime.onMessage.addListener(handleMessage);
    return () => {
      chrome.runtime.onMessage.removeListener(handleMessage);
      if (liveAnimationRef.current !== null) {
        window.clearInterval(liveAnimationRef.current);
        liveAnimationRef.current = null;
      }
    };
  }, [params.liveWrite]);

  useEffect(() => {
    readFileAnnotations(params.projectPath, params.filePath)
      .then(setAnnotations)
      .catch((annotationError) => {
        console.debug('[file-preview] failed to load annotations:', annotationError);
        setAnnotations([]);
      });
  }, [params.filePath, params.projectPath]);

  useEffect(() => {
    if (!activeAnnotationPreview) {
      return;
    }

    const stillExists = annotations.find(
      (annotation) => annotation.id === activeAnnotationPreview.annotation.id
    );
    if (!stillExists) {
      setActiveAnnotationPreview(null);
    }
  }, [activeAnnotationPreview, annotations]);

  useEffect(() => {
    activeAnnotationPreviewRef.current = activeAnnotationPreview;
  }, [activeAnnotationPreview]);

  useEffect(() => {
    pendingAnnotationSelectionRef.current = pendingAnnotationSelection;
  }, [pendingAnnotationSelection]);

  const handleCloseAnnotationPreview = useCallback(() => {
    setActiveAnnotationPreview(null);
  }, []);

  const handleOpenAnnotationPreview = useCallback((preview: ActiveAnnotationPreview) => {
    setPendingAnnotationSelection(null);
    setActiveAnnotationPreview(preview);
  }, []);

  const handlePendingAnnotationSelectionChange = useCallback(
    (selection: PendingAnnotationSelection | null) => {
      setPendingAnnotationSelection(selection);
    },
    []
  );

  const handleImageInsertTargetChange = useCallback((target: MarkdownImageInsertTarget) => {
    imageInsertTargetRef.current = target;
  }, []);

  const handleImageInsertRequest = useCallback((offset: number) => {
    imageInsertTargetRef.current = { ok: true, offset };
    setError(null);
    imageFileInputRef.current?.click();
  }, []);

  const resolveCurrentSelectionImageInsertTarget = useCallback(() => {
    const selection = window.getSelection();
    if (!selection || selection.rangeCount === 0 || !selection.toString().trim()) {
      return imageInsertTargetRef.current;
    }
    const range = selection.getRangeAt(0);
    const root =
      range.commonAncestorContainer.nodeType === 1
        ? (range.commonAncestorContainer as Element).closest('article')
        : range.commonAncestorContainer.parentElement?.closest('article');
    if (!(root instanceof HTMLElement)) {
      return imageInsertTargetRef.current;
    }
    const insertTarget = buildMarkdownInsertTargetFromNode(root, range.commonAncestorContainer);
    const resolvedTarget = resolveMarkdownInsertOffset(draftContent, insertTarget);
    imageInsertTargetRef.current = resolvedTarget;
    return resolvedTarget;
  }, [draftContent]);

  const startMarkdownImageInsert = useCallback(
    (file: File) => {
      const validation = validateMarkdownImageFile({
        mimeType: file.type,
        size: file.size,
      });
      if (!validation.ok) {
        setError(validation.message);
        return;
      }

      const target = resolveCurrentSelectionImageInsertTarget();
      if (!target?.ok) {
        setError(target?.message || '请先在预览正文中点击要插入图片的位置');
        return;
      }

      setError(null);
      setImageInsertDraft({
        file,
        offset: target.offset,
        alt: '图片',
      });
    },
    [resolveCurrentSelectionImageInsertTarget]
  );

  const handleImageFileInputChange = useCallback(
    (event: ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0];
      event.target.value = '';
      if (file) {
        startMarkdownImageInsert(file);
      }
    },
    [startMarkdownImageInsert]
  );

  const confirmMarkdownImageInsert = useCallback(async () => {
    if (!imageInsertDraft) {
      return;
    }
    setImageInsertSaving(true);
    setError(null);
    try {
      const assetPath = resolveAvailableImageAssetPath({
        markdownFilePath: params.filePath,
        mimeType: imageInsertDraft.file.type,
        now: new Date(),
        existingRelativePaths: new Set(),
      });
      const dataBase64 = await fileToBase64(imageInsertDraft.file);
      await agentClient.writeBinaryFile({
        projectPath: params.projectPath,
        filePath: assetPath.filePath,
        dataBase64,
      });
      const snippet = buildMarkdownImageSnippet({
        alt: imageInsertDraft.alt,
        markdownPath: assetPath.markdownPath,
      });
      const nextContent = insertMarkdownImageSnippet(
        draftContent,
        imageInsertDraft.offset,
        snippet
      );
      await agentClient.writeFile({
        ...params,
        content: nextContent,
      });
      setContent(nextContent);
      setDraftContent(nextContent);
      setImageInsertDraft(null);
      imageInsertTargetRef.current = {
        ok: true,
        offset: Math.min(nextContent.length, imageInsertDraft.offset + snippet.length),
      };
      setSaveStatus('saved');
      window.setTimeout(() => setSaveStatus('idle'), 1800);
    } catch (insertError) {
      setError(insertError instanceof Error ? insertError.message : String(insertError));
    } finally {
      setImageInsertSaving(false);
    }
  }, [agentClient, draftContent, imageInsertDraft, params]);

  const handleCreateAnnotation = useCallback(() => {
    const nextSelection = pendingAnnotationSelectionRef.current;
    if (!nextSelection) {
      return;
    }
    clearWindowSelection();
    setPendingAnnotationSelection(null);
    window.requestAnimationFrame(() => {
      setActiveAnnotationPreview(null);
      setAnnotationDraft(buildAnnotationDraftFromPendingSelection(nextSelection));
    });
  }, []);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 's') {
        event.preventDefault();
        if (isSourceMode && hasUnsavedChanges && saveStatus !== 'saving') {
          void save();
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [hasUnsavedChanges, isSourceMode, save, saveStatus]);

  useEffect(() => {
    if (kind !== 'markdown' || viewMode !== 'preview') {
      return;
    }

    const handlePaste = (event: ClipboardEvent) => {
      const items = Array.from(event.clipboardData?.items || []);
      const imageItem = items.find((item) => item.kind === 'file' && item.type.startsWith('image/'));
      const file = imageItem?.getAsFile();
      if (!file) {
        return;
      }
      event.preventDefault();
      startMarkdownImageInsert(file);
    };

    window.addEventListener('paste', handlePaste);
    return () => window.removeEventListener('paste', handlePaste);
  }, [kind, startMarkdownImageInsert, viewMode]);

  const downloadFile = () => {
    triggerBrowserDownload({
      fileName: fileNameFromPath(params.filePath),
      mimeType: kind === 'html' ? 'text/html;charset=utf-8' : 'text/plain;charset=utf-8',
      parts: [draftContent],
    });
  };

  const downloadMarkdown = () => {
    triggerBrowserDownload(
      buildMarkdownDownloadPayload({
        content: draftContent,
        fileName: fileNameFromPath(params.filePath),
      })
    );
  };

  const downloadDocx = async () => {
    setDownloadStatus('exporting');
    setError(null);
    try {
      const payload = await buildDocxDownloadPayload({
        content: draftContent,
        fileName: fileNameFromPath(params.filePath),
      });
      triggerBrowserDownload(payload);
    } catch (downloadError) {
      setError(downloadError instanceof Error ? downloadError.message : String(downloadError));
    } finally {
      setDownloadStatus('idle');
    }
  };

  const persistAnnotations = useCallback(
    async (nextAnnotations: FileAnnotation[]) => {
      setAnnotationSaving(true);
      try {
        await writeFileAnnotations(params.projectPath, params.filePath, nextAnnotations);
        setAnnotations(nextAnnotations);
      } finally {
        setAnnotationSaving(false);
      }
    },
    [params.filePath, params.projectPath]
  );

  const saveAnnotationDraft = useCallback(async () => {
    if (!annotationDraft?.note.trim()) {
      return null;
    }
    const now = new Date().toISOString();
    const existingAnnotation = annotations.find((item) => item.id === annotationDraft.id);
    const anchor = annotationDraft.anchor ?? existingAnnotation?.anchor;
    const annotation: FileAnnotation = {
      id: annotationDraft.id ?? crypto.randomUUID(),
      selectedText: annotationDraft.selectedText,
      note: annotationDraft.note.trim(),
      createdAt: existingAnnotation?.createdAt ?? now,
      updatedAt: now,
    };
    if (anchor) {
      annotation.anchor = anchor;
    }
    const nextAnnotations = [
      ...annotations.filter((item) => item.id !== annotation.id),
      annotation,
    ];
    await persistAnnotations(nextAnnotations);
    clearWindowSelection();
    setAnnotationDraft(null);
    return annotation;
  }, [annotationDraft, annotations, persistAnnotations]);

  const sendAnnotationsToChat = useCallback(
    async (items: FileAnnotation[]) => {
      if (items.length === 0) {
        return;
      }
      await publishAgentV2ComposerAppend({
        source: params.filePath,
        text: formatAnnotationForChat({
          filePath: params.filePath,
          annotations: items,
        }),
      });
    },
    [params.filePath]
  );

  return (
    <div className="flex h-full flex-col bg-background">
      <style>{annotationHighlightStyles}</style>
      <div className="flex items-center justify-between gap-3 border-b px-4 py-3">
        <div className="min-w-0">
          <div className="flex min-w-0 items-center gap-2">
            <FileTextIcon className="h-4 w-4 shrink-0 text-muted-foreground" />
            <h1 className="truncate text-base font-semibold">
              {fileNameFromPath(params.filePath)}
            </h1>
          </div>
          <div className="mt-1 truncate text-xs text-muted-foreground">{params.filePath}</div>
        </div>
        <div className="flex items-center gap-2">
          <input
            ref={imageFileInputRef}
            type="file"
            accept="image/png,image/jpeg,image/webp,image/gif"
            className="hidden"
            onChange={handleImageFileInputChange}
          />
          {hasPreviewMode ? (
            <Button
              variant="outline"
              size="sm"
              onClick={() =>
                setViewMode((current) => (current === 'preview' ? 'source' : 'preview'))
              }
              title={
                viewMode === 'preview'
                  ? '查看源码'
                  : kind === 'html'
                    ? '可视化预览 HTML'
                    : '预览 Markdown'
              }
            >
              {viewMode === 'preview' ? (
                <Code2Icon className="h-4 w-4" />
              ) : (
                <EyeIcon className="h-4 w-4" />
              )}
              <span>
                {viewMode === 'preview' ? '源码' : kind === 'html' ? '可视化预览' : '预览'}
              </span>
            </Button>
          ) : null}
          {kind === 'html' && browserPreviewUrl ? (
            <Button
              variant="outline"
              size="sm"
              onClick={openBrowserPreview}
              title="使用浏览器直接打开 file:// 预览"
            >
              <EyeIcon className="h-4 w-4" />
              <span>浏览器预览</span>
            </Button>
          ) : null}
          {kind === 'markdown' && viewMode === 'preview' ? (
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                const resolvedTarget = resolveCurrentSelectionImageInsertTarget();
                if (!resolvedTarget?.ok) {
                  setError(resolvedTarget?.message || '请先在预览正文中点击要插入图片的位置');
                  return;
                }
                imageFileInputRef.current?.click();
              }}
              title="在当前位置插入图片"
            >
              <ImagePlusIcon className="h-4 w-4" />
              <span>图片</span>
            </Button>
          ) : null}
          {kind === 'markdown' && viewMode === 'preview' ? (
            <div className="relative">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setIsAnnotationMenuOpen((value) => !value)}
                title="当前文件标注"
              >
                <MessageSquarePlusIcon className="h-4 w-4" />
                {resolvedAnnotations.length > 0 ? (
                  <span
                    className="-ml-1 rounded-full bg-primary px-1.5 text-[10px] leading-4 text-primary-foreground"
                    title={`有效标注/总标注：${annotationCountLabel}`}
                  >
                    {annotationCountLabel}
                  </span>
                ) : null}
              </Button>
              {isAnnotationMenuOpen ? (
                <AnnotationMenu
                  annotations={resolvedAnnotations}
                  onEdit={(annotation) => {
                    setAnnotationDraft({
                      id: annotation.id,
                      selectedText: annotation.selectedText,
                      range: null,
                      anchor: annotation.anchor ?? null,
                      note: annotation.note,
                      x: Math.max(window.innerWidth - 420, 24),
                      y: 96,
                    });
                    setIsAnnotationMenuOpen(false);
                  }}
                  onDelete={(annotationId) => {
                    void persistAnnotations(annotations.filter((item) => item.id !== annotationId));
                  }}
                  onSend={(annotation) => {
                    void sendAnnotationsToChat([annotation]);
                    setIsAnnotationMenuOpen(false);
                  }}
                  onSendAll={() => {
                    void sendAnnotationsToChat(
                      resolvedAnnotations.filter((annotation) => annotation.status === 'active')
                    );
                    setIsAnnotationMenuOpen(false);
                  }}
                />
              ) : null}
            </div>
          ) : null}
          {isSourceMode ? (
            <Button
              variant="outline"
              size="sm"
              onClick={() => void save()}
              disabled={!hasUnsavedChanges || saveStatus === 'saving'}
              title="保存文件，快捷键 Ctrl/Cmd+S"
            >
              <SaveIcon className="h-4 w-4" />
              <span>
                {saveStatus === 'saving' ? '保存中' : saveStatus === 'saved' ? '已保存' : '保存'}
              </span>
            </Button>
          ) : null}
          {kind === 'markdown' && viewMode === 'preview' ? (
            <div className="relative">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setIsDownloadMenuOpen((value) => !value)}
                disabled={!draftContent || downloadStatus === 'exporting'}
                title="下载文件"
                aria-expanded={isDownloadMenuOpen}
                aria-haspopup="menu"
              >
                <DownloadIcon className="h-4 w-4" />
                <span>{downloadStatus === 'exporting' ? '导出中' : '下载'}</span>
              </Button>
              {isDownloadMenuOpen ? (
                <div className="absolute right-0 top-full z-30 mt-1 min-w-40 rounded-md border bg-background p-1 shadow-lg">
                  <button
                    type="button"
                    className="flex w-full rounded px-2 py-1.5 text-left text-xs text-foreground hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50"
                    disabled={!draftContent || downloadStatus === 'exporting'}
                    onClick={() => {
                      downloadMarkdown();
                      setIsDownloadMenuOpen(false);
                    }}
                  >
                    下载 Markdown
                  </button>
                  <button
                    type="button"
                    className="flex w-full rounded px-2 py-1.5 text-left text-xs text-foreground hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50"
                    disabled={!draftContent || downloadStatus === 'exporting'}
                    onClick={() => {
                      setIsDownloadMenuOpen(false);
                      void downloadDocx();
                    }}
                  >
                    下载 Word 文档
                  </button>
                </div>
              ) : null}
            </div>
          ) : (
            <Button variant="outline" size="sm" onClick={downloadFile} disabled={!draftContent}>
              <DownloadIcon className="h-4 w-4" />
              <span>下载</span>
            </Button>
          )}
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              void load();
              if (kind === 'html' && browserPreviewUrl) {
                void reloadHtmlBrowserPreview(browserPreviewUrl);
              }
            }}
          >
            <RefreshCwIcon className={`h-4 w-4 ${status === 'loading' ? 'animate-spin' : ''}`} />
            <span>刷新</span>
          </Button>
        </div>
      </div>

      {error ? (
        <div className="m-4 flex items-center gap-2 rounded-md border border-destructive/30 bg-destructive/8 px-3 py-2 text-sm text-destructive">
          <AlertCircleIcon className="h-4 w-4" />
          <span>{error}</span>
        </div>
      ) : null}

      {liveWrite ? (
        <div className="mx-4 mt-3 flex items-center justify-between gap-3 rounded-md border bg-muted/35 px-3 py-2 text-xs text-muted-foreground">
          <span>
            {liveWrite.status === 'failed'
              ? 'AI 写入失败，当前显示最后一次写入预览'
              : liveWrite.status === 'completed'
                ? isSyncingLiveWrite
                  ? 'AI 写入完成，正在同步磁盘内容，预览内容已保留'
                  : 'AI 写入完成，当前保留最后一次写入内容'
                : 'AI 正在写入，内容会逐字更新'}
          </span>
          <span className="shrink-0 tabular-nums">{draftContent.length} 字符</span>
        </div>
      ) : null}

      <main className="min-h-0 flex-1 overflow-auto">
        {status === 'loading' ? (
          <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
            正在加载文件...
          </div>
        ) : kind === 'markdown' && viewMode === 'preview' ? (
          <MarkdownPreview
            content={draftContent}
            annotations={annotations}
            matchedAnnotationIds={matchedAnnotationIds}
            projectPath={params.projectPath}
            filePath={params.filePath}
            activeAnnotationPreviewRef={activeAnnotationPreviewRef}
            pendingHighlightRange={pendingHighlightRange}
            onPendingSelectionChange={handlePendingAnnotationSelectionChange}
            onAnnotationPreviewClose={handleCloseAnnotationPreview}
            onAnnotationPreviewOpen={handleOpenAnnotationPreview}
            onImageInsertTargetChange={handleImageInsertTargetChange}
            onImageInsertRequest={handleImageInsertRequest}
            onResolvedAnnotationIdsChange={setMatchedAnnotationIds}
            renderMermaid={liveWrite?.status !== 'writing'}
          />
        ) : (
          <div className="flex h-full min-h-0 flex-col">
            <SourceEditor
              key={params.filePath}
              filePath={params.filePath}
              content={draftContent}
              scrollToOffset={liveScrollOffset}
              onChange={(value) => {
                setDraftContent(value);
                if (saveStatus !== 'saving') {
                  setSaveStatus('idle');
                }
              }}
            />
            <div className="flex items-center justify-between border-t bg-muted/30 px-3 py-1.5 text-[11px] text-muted-foreground">
              <span>
                行数：{draftContent.split('\n').length}　字符数：{draftContent.length}
              </span>
              <span>
                {hasUnsavedChanges
                  ? '有未保存修改'
                  : saveStatus === 'saved'
                    ? '已保存'
                    : 'Ctrl/Cmd+S 保存'}
              </span>
            </div>
          </div>
        )}
      </main>
      <AnnotationOverlayLayer
        pendingSelection={pendingAnnotationSelection}
        activeAnnotationPreview={activeAnnotationPreview}
        annotationDraft={annotationDraft}
        annotationSaving={annotationSaving}
        onCreateAnnotation={handleCreateAnnotation}
        onCloseAnnotationPreview={handleCloseAnnotationPreview}
        onEditAnnotationPreview={() => {
          if (!activeAnnotationPreview) {
            return;
          }
          setAnnotationDraft({
            id: activeAnnotationPreview.annotation.id,
            selectedText: activeAnnotationPreview.annotation.selectedText,
            range: null,
            anchor: activeAnnotationPreview.annotation.anchor ?? null,
            note: activeAnnotationPreview.annotation.note,
            x: Math.max(window.innerWidth - 420, 24),
            y: 96,
          });
          setActiveAnnotationPreview(null);
        }}
        onAnnotationDraftChange={(note) =>
          setAnnotationDraft((current) => (current ? { ...current, note } : current))
        }
        onCloseAnnotationDraft={() => setAnnotationDraft(null)}
        onSaveAnnotationDraft={() => {
          void saveAnnotationDraft();
        }}
        onSendAnnotationDraft={() => {
          void saveAnnotationDraft().then((annotation) => {
            if (annotation) {
              void sendAnnotationsToChat([annotation]);
            }
          });
        }}
      />
      <MarkdownImageInsertOverlay
        draft={imageInsertDraft}
        saving={imageInsertSaving}
        onAltChange={(alt) =>
          setImageInsertDraft((current) => (current ? { ...current, alt } : current))
        }
        onCancel={() => setImageInsertDraft(null)}
        onConfirm={() => {
          void confirmMarkdownImageInsert();
        }}
      />
    </div>
  );
}

export const Route = createFileRoute('/file-preview')({
  component: FilePreviewPage,
});
