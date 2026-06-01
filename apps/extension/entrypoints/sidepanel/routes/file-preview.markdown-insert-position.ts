const SUPPORTED_INSERT_TAGS = new Set([
  'P',
  'H1',
  'H2',
  'H3',
  'H4',
  'H5',
  'H6',
  'LI',
  'TABLE',
  'TBODY',
  'TR',
  'TD',
  'TH',
  'BLOCKQUOTE',
]);
const unsupportedMessage = '当前位置暂不支持插入图片，请点到正文段落、标题、列表或表格单元格中';
const TABLE_INSERT_TAGS = new Set(['TABLE', 'TBODY', 'TR', 'TD', 'TH']);

export type MarkdownInsertTarget =
  | { ok: true; text: string; tagName: string }
  | { ok: false; message: string };

export function findSupportedMarkdownInsertElement(root: HTMLElement, node: Node | null) {
  let current: Node | null = node;
  while (current && current !== root) {
    if (current.nodeType === 1) {
      const element = current as HTMLElement;
      if (element.closest('pre, code, [data-mermaid-root="true"]')) {
        return null;
      }
      if (SUPPORTED_INSERT_TAGS.has(element.tagName)) {
        return element;
      }
    }
    current = current.parentNode;
  }
  return null;
}

export function buildMarkdownInsertTargetFromNode(root: HTMLElement, node: Node): MarkdownInsertTarget {
  const element = findSupportedMarkdownInsertElement(root, node);
  if (!element) {
    return { ok: false, message: unsupportedMessage };
  }
  const blockquoteElement =
    element.tagName === 'P' ? (element.closest('blockquote') as HTMLElement | null) : null;
  const resolvedElement = blockquoteElement || element;
  const text = resolvedElement.textContent?.replace(/\s+/g, ' ').trim() || '';
  if (!text) {
    return { ok: false, message: unsupportedMessage };
  }
  return { ok: true, text, tagName: resolvedElement.tagName };
}

function normalize(value: string) {
  return value.replace(/\s+/g, ' ').trim();
}

function compact(value: string) {
  return normalize(value).replace(/\s+/g, '');
}

function isMarkdownTableSeparator(line: string) {
  const trimmed = line.trim();
  const cells = trimmed
    .replace(/^\|/, '')
    .replace(/\|$/, '')
    .split('|')
    .map((cell) => cell.trim());
  return cells.length > 0 && cells.every((cell) => /^:?-{3,}:?$/.test(cell));
}

function isMarkdownTableRow(line: string) {
  const trimmed = line.trim();
  if (!trimmed || !trimmed.includes('|')) {
    return false;
  }
  return trimmed
    .replace(/^\|/, '')
    .replace(/\|$/, '')
    .split('|')
    .some((cell) => cell.trim().length > 0);
}

function normalizeMarkdownTableText(lines: string[]) {
  return normalize(
    lines
      .filter((line) => !isMarkdownTableSeparator(line))
      .map((line) => line.replace(/\|/g, ' '))
      .join(' ')
  );
}

function findMarkdownTableBlocks(source: string) {
  const lines = source.split('\n');
  const blocks: Array<{ start: number; end: number; normalizedText: string }> = [];
  let offset = 0;

  for (let index = 0; index < lines.length; ) {
    if (!(isMarkdownTableRow(lines[index]) && index + 1 < lines.length && isMarkdownTableSeparator(lines[index + 1]))) {
      offset += lines[index].length + 1;
      index += 1;
      continue;
    }

    const blockStart = offset;
    const blockLines: string[] = [];
    while (index < lines.length && (isMarkdownTableRow(lines[index]) || isMarkdownTableSeparator(lines[index]))) {
      blockLines.push(lines[index]);
      offset += lines[index].length + 1;
      index += 1;
    }

    blocks.push({
      start: blockStart,
      end: Math.min(source.length, offset - 1),
      normalizedText: normalizeMarkdownTableText(blockLines),
    });
  }

  return blocks;
}

function resolveMarkdownTableInsertOffset(source: string, targetText: string) {
  const normalizedTarget = normalize(targetText);
  const compactTarget = compact(targetText);
  const matchedBlocks = findMarkdownTableBlocks(source).filter((block) =>
    block.normalizedText.includes(normalizedTarget) || compact(block.normalizedText).includes(compactTarget)
  );

  if (matchedBlocks.length !== 1) {
    return null;
  }

  return matchedBlocks[0].end;
}

function normalizeMarkdownBlockquoteText(lines: string[]) {
  return normalize(lines.map((line) => line.replace(/^\s*>\s?/, '')).join(' '));
}

function findMarkdownBlockquoteBlocks(source: string) {
  const lines = source.split('\n');
  const blocks: Array<{ end: number; normalizedText: string }> = [];
  let offset = 0;

  for (let index = 0; index < lines.length; ) {
    if (!lines[index].trim().startsWith('>')) {
      offset += lines[index].length + 1;
      index += 1;
      continue;
    }

    const blockLines: string[] = [];
    while (index < lines.length && lines[index].trim().startsWith('>')) {
      blockLines.push(lines[index]);
      offset += lines[index].length + 1;
      index += 1;
    }

    blocks.push({
      end: Math.min(source.length, offset - 1),
      normalizedText: normalizeMarkdownBlockquoteText(blockLines),
    });
  }

  return blocks;
}

function resolveMarkdownBlockquoteInsertOffset(source: string, targetText: string) {
  const normalizedTarget = normalize(targetText);
  const matchedBlocks = findMarkdownBlockquoteBlocks(source).filter(
    (block) => block.normalizedText === normalizedTarget
  );

  if (matchedBlocks.length !== 1) {
    return null;
  }

  return matchedBlocks[0].end;
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function countStandaloneParagraphOccurrences(source: string, text: string) {
  const pattern = new RegExp(`(^|\\n\\n)${escapeRegExp(text)}(?=\\n\\n|$)`, 'g');
  let count = 0;
  while (pattern.exec(source)) {
    count += 1;
  }
  return count;
}

function findStandaloneParagraphEndOffset(source: string, text: string) {
  const pattern = new RegExp(`(^|\\n\\n)(${escapeRegExp(text)})(?=\\n\\n|$)`, 'g');
  const matches = [...source.matchAll(pattern)];
  if (matches.length !== 1) {
    return null;
  }
  const match = matches[0];
  const rawIndex = match.index ?? -1;
  if (rawIndex < 0) {
    return null;
  }
  return rawIndex + match[1].length + match[2].length;
}

function findSourceMatch(source: string, targetText: string) {
  const normalizedSource = normalize(source);
  const normalizedTarget = normalize(targetText);
  const first = normalizedSource.indexOf(normalizedTarget);
  if (first < 0) {
    return null;
  }
  if (normalizedSource.indexOf(normalizedTarget, first + 1) >= 0) {
    return 'duplicate' as const;
  }
  return first;
}

export function resolveMarkdownInsertOffset(source: string, target: MarkdownInsertTarget) {
  if (!target.ok) {
    return target;
  }
  if (target.tagName === 'BLOCKQUOTE') {
    const blockquoteOffset = resolveMarkdownBlockquoteInsertOffset(source, target.text);
    if (blockquoteOffset !== null) {
      return { ok: true as const, offset: blockquoteOffset };
    }
  }
  if (TABLE_INSERT_TAGS.has(target.tagName)) {
    const tableOffset = resolveMarkdownTableInsertOffset(source, target.text);
    if (tableOffset !== null) {
      return { ok: true as const, offset: tableOffset };
    }
  }

  const match = findSourceMatch(source, target.text);
  if (match === 'duplicate') {
    if (target.tagName === 'P' && countStandaloneParagraphOccurrences(source, target.text) === 1) {
      const paragraphEnd = findStandaloneParagraphEndOffset(source, target.text);
      if (paragraphEnd !== null) {
        return { ok: true as const, offset: paragraphEnd };
      }
    }
    return { ok: false as const, message: '当前位置无法唯一定位，请换一个插入位置' };
  }
  if (match === null) {
    return { ok: false as const, message: '当前位置无法映射到 Markdown 源码，请换一个插入位置' };
  }

  const rawIndex = source.indexOf(target.text);
  if (rawIndex >= 0 && source.indexOf(target.text, rawIndex + 1) < 0) {
    return { ok: true as const, offset: rawIndex + target.text.length };
  }

  return { ok: false as const, message: '当前位置无法映射到 Markdown 源码，请换一个插入位置' };
}

export function buildMarkdownFloatingImageInsertTarget(input: {
  root: HTMLElement;
  node: Node;
  source: string;
  viewportWidth: number;
}) {
  const element = findSupportedMarkdownInsertElement(input.root, input.node);
  if (!element) {
    return { ok: false as const, message: unsupportedMessage };
  }
  const insertTarget = buildMarkdownInsertTargetFromNode(input.root, element);
  const resolvedTarget = resolveMarkdownInsertOffset(input.source, insertTarget);
  if (!resolvedTarget.ok) {
    return resolvedTarget;
  }

  const rect = element.getBoundingClientRect();
  return {
    ok: true as const,
    offset: resolvedTarget.offset,
    x: Math.max(8, Math.min(rect.right + 8, input.viewportWidth - 48)),
    y: Math.max(8, rect.top + 8),
  };
}
