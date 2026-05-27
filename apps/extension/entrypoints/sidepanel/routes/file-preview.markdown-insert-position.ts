const SUPPORTED_INSERT_TAGS = new Set([
  'P',
  'H1',
  'H2',
  'H3',
  'H4',
  'H5',
  'H6',
  'LI',
  'TD',
  'TH',
  'BLOCKQUOTE',
]);
const unsupportedMessage = '当前位置暂不支持插入图片，请点到正文段落、标题、列表或表格单元格中';

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
  const text = element.textContent?.replace(/\s+/g, ' ').trim() || '';
  if (!text) {
    return { ok: false, message: unsupportedMessage };
  }
  return { ok: true, text, tagName: element.tagName };
}

function normalize(value: string) {
  return value.replace(/\s+/g, ' ').trim();
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
  const match = findSourceMatch(source, target.text);
  if (match === 'duplicate') {
    return { ok: false as const, message: '当前位置无法唯一定位，请换一个插入位置' };
  }
  if (match === null) {
    return { ok: false as const, message: '当前位置无法映射到 Markdown 源码，请换一个插入位置' };
  }

  const rawIndex = source.indexOf(target.text);
  if (rawIndex >= 0 && source.indexOf(target.text, rawIndex + 1) < 0) {
    if (target.tagName === 'TD' || target.tagName === 'TH') {
      const lineEnd = source.indexOf('\n', rawIndex);
      return { ok: true as const, offset: lineEnd >= 0 ? lineEnd : source.length };
    }
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
