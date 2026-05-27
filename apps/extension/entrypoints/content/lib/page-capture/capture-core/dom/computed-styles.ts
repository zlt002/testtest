import { SOURCE_INDEX_ATTRIBUTE } from './clone';

const FLEX_DISPLAY_VALUES = new Set(['flex', 'inline-flex']);
const GRID_DISPLAY_VALUES = new Set(['grid', 'inline-grid']);

const FLEX_CONTAINER_PROPERTIES = [
  'display',
  'gap',
  'row-gap',
  'column-gap',
  'flex-direction',
  'flex-wrap',
  'justify-content',
  'align-items',
  'align-content',
] as const;

const GRID_CONTAINER_PROPERTIES = [
  'display',
  'gap',
  'row-gap',
  'column-gap',
  'grid-template-columns',
  'grid-template-rows',
  'grid-auto-flow',
  'grid-auto-columns',
  'grid-auto-rows',
  'justify-items',
  'align-items',
  'place-items',
] as const;

const POSITION_PROPERTIES = [
  'position',
  'top',
  'right',
  'bottom',
  'left',
  'z-index',
] as const;

const OVERFLOW_PROPERTIES = ['overflow-x', 'overflow-y'] as const;

type ComputedProperty =
  | (typeof FLEX_CONTAINER_PROPERTIES)[number]
  | (typeof GRID_CONTAINER_PROPERTIES)[number]
  | (typeof POSITION_PROPERTIES)[number]
  | (typeof OVERFLOW_PROPERTIES)[number];

function readSourceIndex(element: Element): number | null {
  const value = element.getAttribute(SOURCE_INDEX_ATTRIBUTE);
  if (value === null || value.trim() === '') {
    return null;
  }

  const sourceIndex = Number(value);
  return Number.isInteger(sourceIndex) && sourceIndex >= 0 ? sourceIndex : null;
}

function getInlineStyleDeclaration(element: Element): CSSStyleDeclaration | null {
  if (!('style' in element)) {
    return null;
  }

  const style = (element as Element & { style?: unknown }).style;
  return style instanceof CSSStyleDeclaration ? style : null;
}

function shouldKeepProperty(property: ComputedProperty, value: string): boolean {
  const normalized = value.trim().toLowerCase();
  if (!normalized) {
    return false;
  }

  switch (property) {
    case 'display':
      return FLEX_DISPLAY_VALUES.has(normalized) || GRID_DISPLAY_VALUES.has(normalized);
    case 'gap':
    case 'row-gap':
    case 'column-gap':
      return normalized !== 'normal' && normalized !== '0px' && normalized !== '0';
    case 'flex-direction':
      return normalized !== 'row';
    case 'flex-wrap':
      return normalized !== 'nowrap';
    case 'justify-content':
      return normalized !== 'normal' && normalized !== 'flex-start';
    case 'align-items':
    case 'align-content':
    case 'justify-items':
    case 'place-items':
      return normalized !== 'normal' && normalized !== 'stretch';
    case 'grid-template-columns':
    case 'grid-template-rows':
    case 'grid-auto-columns':
    case 'grid-auto-rows':
      return normalized !== 'none' && normalized !== 'auto';
    case 'grid-auto-flow':
      return normalized !== 'row';
    case 'position':
      return normalized === 'sticky' || normalized === 'fixed' || normalized === 'absolute';
    case 'top':
    case 'right':
    case 'bottom':
    case 'left':
      return normalized !== 'auto';
    case 'z-index':
      return normalized !== 'auto';
    case 'overflow-x':
    case 'overflow-y':
      return normalized !== 'visible';
    default:
      return false;
  }
}

function copyComputedProperties(
  target: Element,
  source: Element,
  properties: readonly ComputedProperty[]
): void {
  const view = source.ownerDocument.defaultView;
  const targetStyle = getInlineStyleDeclaration(target);
  if (!view || !targetStyle) {
    return;
  }

  const computedStyle = view.getComputedStyle(source);
  for (const property of properties) {
    if (targetStyle.getPropertyValue(property)) {
      continue;
    }

    const value = computedStyle.getPropertyValue(property);
    if (!shouldKeepProperty(property, value)) {
      continue;
    }

    targetStyle.setProperty(property, value);
  }
}

function applyMinimalComputedLayoutStyle(target: Element, source: Element): void {
  const view = source.ownerDocument.defaultView;
  if (!view) {
    return;
  }

  const computedStyle = view.getComputedStyle(source);
  const display = computedStyle.getPropertyValue('display').trim().toLowerCase();
  const position = computedStyle.getPropertyValue('position').trim().toLowerCase();
  const overflowX = computedStyle.getPropertyValue('overflow-x').trim().toLowerCase();
  const overflowY = computedStyle.getPropertyValue('overflow-y').trim().toLowerCase();

  if (FLEX_DISPLAY_VALUES.has(display)) {
    copyComputedProperties(target, source, FLEX_CONTAINER_PROPERTIES);
  }

  if (GRID_DISPLAY_VALUES.has(display)) {
    copyComputedProperties(target, source, GRID_CONTAINER_PROPERTIES);
  }

  if (position === 'sticky' || position === 'fixed' || position === 'absolute') {
    copyComputedProperties(target, source, POSITION_PROPERTIES);
  }

  if (overflowX !== 'visible' || overflowY !== 'visible') {
    copyComputedProperties(target, source, OVERFLOW_PROPERTIES);
  }
}

export function inlineComputedLayoutStyles(capturedDoc: Document, originalDoc: Document): void {
  const originalElements = Array.from(originalDoc.body.querySelectorAll('*'));
  for (const element of Array.from(capturedDoc.body.querySelectorAll('*'))) {
    const sourceIndex = readSourceIndex(element);
    if (sourceIndex === null) {
      continue;
    }

    const originalElement = originalElements[sourceIndex];
    if (!originalElement) {
      continue;
    }

    applyMinimalComputedLayoutStyle(element, originalElement);
  }
}
