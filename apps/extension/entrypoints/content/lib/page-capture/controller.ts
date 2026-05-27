import { summarizeElementText } from './selection';
import { serializeCaptureArtifact } from './serialize';
import type { PageCaptureRequest, PageCaptureResult } from './types';

type StylesheetFetchResponse =
  | {
      type: 'page-capture-fetch-stylesheet-result';
      success: true;
      content: string;
    }
  | {
      type: 'page-capture-fetch-stylesheet-result';
      success: false;
      error: string;
    };

const STYLESHEET_FETCH_MESSAGE_TIMEOUT_MS = 12_000;
const STYLESHEET_FETCH_PORT_NAME = 'page-capture-stylesheet-fetch';

function sendStylesheetFetchMessage(sourceUrl: string): Promise<StylesheetFetchResponse | undefined> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const port = chrome.runtime.connect({ name: STYLESHEET_FETCH_PORT_NAME });

    const cleanup = () => {
      clearTimeout(timeoutId);
      port.onMessage.removeListener(onMessage);
      port.onDisconnect.removeListener(onDisconnect);
    };

    const settle = (
      action: 'resolve' | 'reject',
      value: StylesheetFetchResponse | undefined | Error
    ) => {
      if (settled) {
        return;
      }

      settled = true;
      cleanup();
      if (action === 'resolve') {
        resolve(value as StylesheetFetchResponse | undefined);
        return;
      }

      reject(value);
    };

    const onMessage = (response: StylesheetFetchResponse | undefined) => {
      settle('resolve', response);
    };

    const onDisconnect = () => {
      const runtimeError = chrome.runtime?.lastError?.message;
      settle(
        'reject',
        new Error(
          runtimeError
            ? `请求扩展后台抓取样式表连接断开：${sourceUrl}，${runtimeError}`
            : `请求扩展后台抓取样式表连接断开：${sourceUrl}`
        )
      );
    };

    const timeoutId = setTimeout(() => {
      settle(
        'reject',
        new Error(
          `请求扩展后台抓取样式表超时：${sourceUrl}，timeout after ${STYLESHEET_FETCH_MESSAGE_TIMEOUT_MS}ms`
        )
      );
    }, STYLESHEET_FETCH_MESSAGE_TIMEOUT_MS);

    port.onMessage.addListener(onMessage);
    port.onDisconnect.addListener(onDisconnect);

    try {
      port.postMessage({
        type: 'page-capture-fetch-stylesheet',
        sourceUrl,
      });
    } catch (error) {
      settle(
        'reject',
        new Error(
          `请求扩展后台抓取样式表失败：${sourceUrl}，${
            error instanceof Error ? error.message : String(error)
          }`
        )
      );
    }
  });
}

async function fetchStylesheetThroughBackground(sourceUrl: string): Promise<string> {
  if (typeof chrome === 'undefined' || !chrome.runtime?.connect) {
    throw new Error('扩展后台不可用，无法抓取跨域样式表');
  }

  let response: StylesheetFetchResponse | undefined;
  try {
    response = await sendStylesheetFetchMessage(sourceUrl);
  } catch (error) {
    throw new Error(
      error instanceof Error
        ? error.message
        : `请求扩展后台抓取样式表失败：${sourceUrl}，${String(error)}`
    );
  }

  if (!response) {
    throw new Error(`扩展后台未返回样式表抓取结果：${sourceUrl}`);
  }

  if (response.type !== 'page-capture-fetch-stylesheet-result') {
    throw new Error(`扩展后台返回了未知的样式表抓取结果：${sourceUrl}`);
  }

  if (response.success !== true) {
    throw new Error(
      response.error || `扩展后台抓取样式表失败，但没有返回错误详情：${sourceUrl}`
    );
  }

  return response.content;
}

function resolveTargetElement(request: PageCaptureRequest): Element | null {
  if (request.mode !== 'element') {
    return null;
  }

  const selector = request.target?.selector?.trim();
  if (selector) {
    try {
      const matched = document.querySelector(selector);
      if (matched) {
        return matched;
      }
    } catch {
      // Ignore invalid selector and continue to xpath fallback.
    }
  }

  const xpath = request.target?.xpath?.trim();
  if (xpath) {
    try {
      const matched = document.evaluate(
        xpath,
        document,
        null,
        XPathResult.FIRST_ORDERED_NODE_TYPE,
        null
      ).singleNodeValue;
      if (matched instanceof Element) {
        return matched;
      }
    } catch {
      // Ignore invalid xpath and fall back to not found.
    }
  }

  return null;
}

export async function handlePageCaptureRequest(
  request: PageCaptureRequest
): Promise<PageCaptureResult> {
  try {
    const targetElement = resolveTargetElement(request);
    const elementSelectionSummary =
      request.mode === 'element' && targetElement ? summarizeElementText(targetElement) : undefined;

    if (request.mode === 'element' && !targetElement) {
      throw new Error('当前页面没有可采集的元素');
    }

    const artifact = await serializeCaptureArtifact(document, {
      mode: request.mode,
      baseUrl: window.location.href,
      capturedAt: new Date().toISOString(),
      elementSelectionSummary,
      targetElement,
      fetchStylesheet: fetchStylesheetThroughBackground,
    });

    return {
      type: 'page-capture-result',
      requestId: request.requestId,
      success: true,
      artifact,
    };
  } catch (error) {
    return {
      type: 'page-capture-result',
      requestId: request.requestId,
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}
