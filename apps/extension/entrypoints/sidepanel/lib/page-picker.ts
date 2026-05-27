import type { PickedElementContext } from '@/entrypoints/lib/page-picker';

export type { PickedElementContext } from '@/entrypoints/lib/page-picker';

function summarizeAncestor(ancestor: PickedElementContext['ancestors'][number]): string {
  const idPart = ancestor.id ? `#${ancestor.id}` : '';
  const classPart = ancestor.classList.length ? `.${ancestor.classList.join('.')}` : '';

  return `${ancestor.tagName}${idPart}${classPart}`;
}

function formatClassList(classList: string[]): string {
  return classList.length ? classList.join(' ') : '(none)';
}

function formatDataAttributes(dataAttributes: PickedElementContext['dataAttributes']): string[] {
  const entries = Object.entries(dataAttributes).sort(([left], [right]) =>
    left.localeCompare(right)
  );

  if (!entries.length) {
    return ['- (none)'];
  }

  return entries.map(([key, value]) => `- data-${key}="${value}"`);
}

export function formatPickedElementContext(context: PickedElementContext): string {
  const lines = [
    '[页面元素定位]',
    `url: ${context.url}`,
    `selector: ${context.selector ?? '(unavailable)'}`,
    `xpath: ${context.xpath ?? '(unavailable)'}`,
    `tag: ${context.tagName}`,
    `id: ${context.id ?? '(none)'}`,
    `classList: ${formatClassList(context.classList)}`,
    'dataAttributes:',
    ...formatDataAttributes(context.dataAttributes),
    `text: ${context.text?.trim() || '(empty)'}`,
    `rect: x=${Math.round(context.rect.x)},y=${Math.round(context.rect.y)},w=${Math.round(context.rect.width)},h=${Math.round(context.rect.height)}`,
    `outerHTML: ${context.outerHTMLSnippet ?? '(unavailable)'}`,
    'ancestors:',
    ...(context.ancestors.length
      ? context.ancestors.map((ancestor) => `- ${summarizeAncestor(ancestor)}`)
      : ['- (none)']),
    'siblings:',
    `- prev: ${context.siblings.previous ?? '(none)'}`,
    `- next: ${context.siblings.next ?? '(none)'}`,
    '[/页面元素定位]',
  ];

  return lines.join('\n');
}

export function insertPickedElementBlock(
  currentValue: string,
  context: PickedElementContext
): string {
  const block = formatPickedElementContext(context);

  if (!currentValue.trim()) {
    return block;
  }

  return `${currentValue.trimEnd()}\n\n${block}`;
}
