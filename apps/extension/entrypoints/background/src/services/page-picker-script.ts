import type { PickedElementContext } from '@/entrypoints/lib/page-picker';

const MAX_TEXT_LENGTH = 120;
const MAX_HTML_LENGTH = 400;
const MAX_ANCESTOR_COUNT = 3;
const PAGE_PICKER_OVERLAY_SELECTOR = '[data-webmcp-page-picker-overlay="true"]';
const PAGE_PICKER_CLEANUP_KEY = '__WEBMCP_PAGE_PICKER_CLEANUP__';
const PAGE_PICKER_CANCELLED_MESSAGE = '页面元素拾取已取消';
const PAGE_PICKER_TIMEOUT_MESSAGE = '页面元素拾取超时';

type PagePickerWindow = Window & {
  [PAGE_PICKER_CLEANUP_KEY]?: ((reason?: Error) => void) | undefined;
};

function normalizeText(value: string | null | undefined): string | null {
  const text = value?.replace(/\s+/g, ' ').trim() ?? '';
  return text ? text.slice(0, MAX_TEXT_LENGTH) : null;
}

function escapeSelectorToken(value: string): string {
  return globalThis.CSS?.escape?.(value) ?? value.replace(/[^a-zA-Z0-9_-]/g, (char) => `\\${char}`);
}

function escapeXPathLiteral(value: string): string {
  if (!value.includes('"')) {
    return `"${value}"`;
  }

  if (!value.includes("'")) {
    return `'${value}'`;
  }

  const parts = value.split('"');
  return `concat(${parts.map((part, index) => `${index > 0 ? ", '\"', " : ''}"${part}"`).join('')})`;
}

function buildXPath(element: Element): string {
  const htmlElement = element as HTMLElement;
  if (htmlElement.id) {
    return `//*[@id=${escapeXPathLiteral(htmlElement.id)}]`;
  }

  const parent = element.parentElement;
  if (!parent) {
    return `/${element.tagName.toLowerCase()}`;
  }

  const sameTagSiblings = Array.from(parent.children).filter(
    (child) => child.tagName === element.tagName
  );
  const index = sameTagSiblings.indexOf(element) + 1;

  return `${buildXPath(parent)}/${element.tagName.toLowerCase()}[${index}]`;
}

function buildSelector(element: Element): string | null {
  const htmlElement = element as HTMLElement;

  if (htmlElement.id) {
    return `#${escapeSelectorToken(htmlElement.id)}`;
  }

  const tagName = htmlElement.tagName.toLowerCase();
  const classSelector = Array.from(htmlElement.classList)
    .slice(0, 3)
    .map((token) => `.${escapeSelectorToken(token)}`)
    .join('');
  const parent = htmlElement.parentElement;

  if (!parent) {
    return `${tagName}${classSelector}`;
  }

  const sameTagSiblings = Array.from(parent.children).filter(
    (child) => child.tagName === htmlElement.tagName
  );
  const nthOfType = sameTagSiblings.indexOf(htmlElement) + 1;
  const parentSelector = parent.id ? `#${escapeSelectorToken(parent.id)} ` : '';

  return `${parentSelector}${tagName}${classSelector}:nth-of-type(${nthOfType})`;
}

function collectAncestors(element: HTMLElement): PickedElementContext['ancestors'] {
  const ancestors: PickedElementContext['ancestors'] = [];
  let current = element.parentElement;

  while (current && ancestors.length < MAX_ANCESTOR_COUNT) {
    ancestors.push({
      tagName: current.tagName.toLowerCase(),
      id: current.id || null,
      classList: Array.from(current.classList).slice(0, 3),
    });
    current = current.parentElement;
  }

  return ancestors;
}

function collectDataAttributes(element: HTMLElement): Record<string, string> {
  return Object.fromEntries(
    Array.from(element.attributes)
      .filter((attribute) => attribute.name.startsWith('data-'))
      .map((attribute) => [attribute.name.slice(5), attribute.value])
  );
}

export function extractPickedElementContext(element: HTMLElement): PickedElementContext {
  const rect = element.getBoundingClientRect();

  return {
    url: window.location.href,
    selector: buildSelector(element),
    xpath: buildXPath(element),
    tagName: element.tagName.toLowerCase(),
    id: element.id || null,
    classList: Array.from(element.classList),
    dataAttributes: collectDataAttributes(element),
    text: normalizeText(element.innerText || element.textContent),
    rect: {
      x: rect.x,
      y: rect.y,
      width: rect.width,
      height: rect.height,
    },
    outerHTMLSnippet: element.outerHTML.slice(0, MAX_HTML_LENGTH),
    ancestors: collectAncestors(element),
    siblings: {
      previous: normalizeText(element.previousElementSibling?.textContent),
      next: normalizeText(element.nextElementSibling?.textContent),
    },
  };
}

export async function runPagePickerInPage(timeoutMs = 30_000): Promise<PickedElementContext> {
  return new Promise<PickedElementContext>((resolve, reject) => {
    const maxTextLength = 120;
    const maxHtmlLength = 400;
    const maxAncestorCount = 3;
    const pagePickerOverlaySelector = '[data-webmcp-page-picker-overlay="true"]';
    const pagePickerCleanupKey = '__WEBMCP_PAGE_PICKER_CLEANUP__';
    const pagePickerCancelledMessage = '页面元素拾取已取消';
    const pagePickerTimeoutMessage = '页面元素拾取超时';
    const escapeSelectorTokenInPage = (value: string): string =>
      globalThis.CSS?.escape?.(value) ?? value.replace(/[^a-zA-Z0-9_-]/g, (char) => `\\${char}`);
    const escapeXPathLiteralInPage = (value: string): string => {
      if (!value.includes('"')) {
        return `"${value}"`;
      }

      if (!value.includes("'")) {
        return `'${value}'`;
      }

      const parts = value.split('"');
      return `concat(${parts.map((part, index) => `${index > 0 ? ", '\"', " : ''}"${part}"`).join('')})`;
    };
    const normalizeTextInPage = (value: string | null | undefined): string | null => {
      const text = value?.replace(/\s+/g, ' ').trim() ?? '';
      return text ? text.slice(0, maxTextLength) : null;
    };

    const collectDataAttributesInPage = (element: HTMLElement): Record<string, string> =>
      Object.fromEntries(
        Array.from(element.attributes)
          .filter((attribute) => attribute.name.startsWith('data-'))
          .map((attribute) => [attribute.name.slice(5), attribute.value])
      );

    const collectAncestorsInPage = (element: HTMLElement): PickedElementContext['ancestors'] => {
      const ancestors: PickedElementContext['ancestors'] = [];
      let current = element.parentElement;

      while (current && ancestors.length < maxAncestorCount) {
        ancestors.push({
          tagName: current.tagName.toLowerCase(),
          id: current.id || null,
          classList: Array.from(current.classList).slice(0, 3),
        });
        current = current.parentElement;
      }

      return ancestors;
    };

    const buildXPathInPage = (element: Element): string => {
      const htmlElement = element as HTMLElement;
      if (htmlElement.id) {
        return `//*[@id=${escapeXPathLiteralInPage(htmlElement.id)}]`;
      }

      const parent = element.parentElement;
      if (!parent) {
        return `/${element.tagName.toLowerCase()}`;
      }

      const sameTagSiblings = Array.from(parent.children).filter(
        (child) => child.tagName === element.tagName
      );
      const index = sameTagSiblings.indexOf(element) + 1;

      return `${buildXPathInPage(parent)}/${element.tagName.toLowerCase()}[${index}]`;
    };

    const buildSelectorInPage = (element: Element): string | null => {
      const htmlElement = element as HTMLElement;

      if (htmlElement.id) {
        return `#${escapeSelectorTokenInPage(htmlElement.id)}`;
      }

      const tagName = htmlElement.tagName.toLowerCase();
      const classSelector = Array.from(htmlElement.classList)
        .slice(0, 3)
        .map((token) => `.${escapeSelectorTokenInPage(token)}`)
        .join('');
      const parent = htmlElement.parentElement;

      if (!parent) {
        return `${tagName}${classSelector}`;
      }

      const sameTagSiblings = Array.from(parent.children).filter(
        (child) => child.tagName === htmlElement.tagName
      );
      const nthOfType = sameTagSiblings.indexOf(htmlElement) + 1;
      const parentSelector = parent.id ? `#${escapeSelectorTokenInPage(parent.id)} ` : '';

      return `${parentSelector}${tagName}${classSelector}:nth-of-type(${nthOfType})`;
    };

    const extractPickedElementContextInPage = (element: HTMLElement): PickedElementContext => {
      const rect = element.getBoundingClientRect();

      return {
        url: window.location.href,
        selector: buildSelectorInPage(element),
        xpath: buildXPathInPage(element),
        tagName: element.tagName.toLowerCase(),
        id: element.id || null,
        classList: Array.from(element.classList),
        dataAttributes: collectDataAttributesInPage(element),
        text: normalizeTextInPage(element.innerText || element.textContent),
        rect: {
          x: rect.x,
          y: rect.y,
          width: rect.width,
          height: rect.height,
        },
        outerHTMLSnippet: element.outerHTML.slice(0, maxHtmlLength),
        ancestors: collectAncestorsInPage(element),
        siblings: {
          previous: normalizeTextInPage(element.previousElementSibling?.textContent),
          next: normalizeTextInPage(element.nextElementSibling?.textContent),
        },
      };
    };

    const pickerWindow = window as PagePickerWindow;
    pickerWindow[pagePickerCleanupKey]?.(new Error(pagePickerCancelledMessage));
    document.querySelector(pagePickerOverlaySelector)?.remove();

    const overlay = document.createElement('div');
    overlay.setAttribute('data-webmcp-page-picker-overlay', 'true');
    overlay.style.position = 'fixed';
    overlay.style.pointerEvents = 'none';
    overlay.style.border = '2px solid #ef4444';
    overlay.style.background = 'rgba(239, 68, 68, 0.08)';
    overlay.style.boxSizing = 'border-box';
    overlay.style.zIndex = '2147483647';
    document.documentElement.appendChild(overlay);

    let isCleanedUp = false;
    let isSettled = false;
    const timer = globalThis.setTimeout(() => {
      cancel(new Error(pagePickerTimeoutMessage));
    }, timeoutMs);

    const cleanup = (reason?: Error) => {
      if (isCleanedUp) {
        return;
      }
      isCleanedUp = true;
      globalThis.clearTimeout(timer);
      overlay.remove();
      document.removeEventListener('mousemove', handleMove, true);
      document.removeEventListener('click', handleClick, true);
      if (pickerWindow[pagePickerCleanupKey] === cleanup) {
        delete pickerWindow[pagePickerCleanupKey];
      }
      if (reason && !isSettled) {
        isSettled = true;
        reject(reason);
      }
    };

    const complete = (value: PickedElementContext) => {
      if (isSettled) {
        return;
      }
      isSettled = true;
      cleanup();
      resolve(value);
    };

    const cancel = (reason: Error) => {
      if (isSettled) {
        return;
      }
      cleanup(reason);
    };

    const updateOverlay = (target: HTMLElement) => {
      const rect = target.getBoundingClientRect();
      overlay.style.left = `${rect.left}px`;
      overlay.style.top = `${rect.top}px`;
      overlay.style.width = `${rect.width}px`;
      overlay.style.height = `${rect.height}px`;
    };

    const handleMove = (event: MouseEvent) => {
      if (!(event.target instanceof HTMLElement)) {
        return;
      }

      updateOverlay(event.target);
    };

    const handleClick = (event: MouseEvent) => {
      if (!(event.target instanceof HTMLElement)) {
        return;
      }

      event.preventDefault();
      event.stopPropagation();
      complete(extractPickedElementContextInPage(event.target));
    };

    document.addEventListener('mousemove', handleMove, true);
    document.addEventListener('click', handleClick, true);
    pickerWindow[pagePickerCleanupKey] = cleanup;
  });
}
