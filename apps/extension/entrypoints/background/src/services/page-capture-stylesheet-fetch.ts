type StylesheetFetchRequest = {
  type: 'page-capture-fetch-stylesheet';
  sourceUrl: string;
};

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

const STYLESHEET_FETCH_PORT_NAME = 'page-capture-stylesheet-fetch';
const STYLESHEET_FETCH_TIMEOUT_MS = 10_000;
let stylesheetFetchSequence = 0;

function isStylesheetFetchRequest(value: unknown): value is StylesheetFetchRequest {
  if (!value || typeof value !== 'object') {
    return false;
  }

  const candidate = value as Record<string, unknown>;
  return (
    candidate.type === 'page-capture-fetch-stylesheet' &&
    typeof candidate.sourceUrl === 'string' &&
    candidate.sourceUrl.length > 0
  );
}

function createTimeoutError(sourceUrl: string, timeoutMs: number): Error {
  return new Error(`Failed to fetch stylesheet ${sourceUrl}: timeout after ${timeoutMs}ms`);
}

async function fetchStylesheet(sourceUrl: string): Promise<string> {
  let response: Response;
  const controller = new AbortController();
  let timeoutError: Error | null = null;
  let timeoutId: ReturnType<typeof setTimeout>;

  try {
    response = await Promise.race([
      fetch(sourceUrl, {
        credentials: 'omit',
        cache: 'default',
        signal: controller.signal,
        headers: {
          Accept: 'text/css,*/*;q=0.1',
        },
      }),
      new Promise<never>((_resolve, reject) => {
        timeoutId = setTimeout(() => {
          timeoutError = createTimeoutError(sourceUrl, STYLESHEET_FETCH_TIMEOUT_MS);
          controller.abort(timeoutError);
          reject(timeoutError);
        }, STYLESHEET_FETCH_TIMEOUT_MS);
      }),
    ]);
  } catch (error) {
    if (timeoutError) {
      throw timeoutError;
    }

    throw new Error(
      `Failed to fetch stylesheet ${sourceUrl}: ${error instanceof Error ? error.message : String(error)}`
    );
  } finally {
    clearTimeout(timeoutId!);
  }

  if (!response.ok) {
    throw new Error(`Failed to fetch stylesheet ${sourceUrl}: HTTP ${response.status}`);
  }

  return response.text();
}

function handleStylesheetFetchRequest(
  message: StylesheetFetchRequest,
  sendResponse: (response: StylesheetFetchResponse) => void
): void {
  const requestId = ++stylesheetFetchSequence;
  console.debug('[page-capture] stylesheet fetch requested', {
    requestId,
    sourceUrl: message.sourceUrl,
  });

  fetchStylesheet(message.sourceUrl)
    .then((content) => {
      console.debug('[page-capture] stylesheet fetch succeeded', {
        requestId,
        sourceUrl: message.sourceUrl,
        bytes: content.length,
      });
      sendResponse({
        type: 'page-capture-fetch-stylesheet-result',
        success: true,
        content,
      });
    })
    .catch((error) => {
      console.warn('[page-capture] stylesheet fetch failed', {
        requestId,
        sourceUrl: message.sourceUrl,
        error: error instanceof Error ? error.message : String(error),
      });
      sendResponse({
        type: 'page-capture-fetch-stylesheet-result',
        success: false,
        error: error instanceof Error ? error.message : String(error),
      });
    });
}

export function initPageCaptureStylesheetFetchListener(): void {
  chrome.runtime.onConnect.addListener((port) => {
    if (port.name !== STYLESHEET_FETCH_PORT_NAME) {
      return;
    }

    const onPortMessage = (message: unknown) => {
      if (!isStylesheetFetchRequest(message)) {
        return;
      }

      handleStylesheetFetchRequest(message, (response) => {
        port.postMessage(response);
        port.disconnect();
      });
    };

    port.onMessage.addListener(onPortMessage);
    port.onDisconnect.addListener(() => {
      port.onMessage.removeListener(onPortMessage);
    });
  });

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (!isStylesheetFetchRequest(message)) {
      return false;
    }

    handleStylesheetFetchRequest(message, sendResponse);

    return true;
  });
}
