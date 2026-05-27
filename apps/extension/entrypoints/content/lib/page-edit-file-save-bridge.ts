import { isCurrentPageMessageEventOrigin } from './window-message-origin';

type PageEditFileSavePayload = {
  nonce: string;
  pageUrl: string;
  html: string;
};

type PageEditFileSaveMessage = {
  type: 'page_edit_save_file';
  payload: PageEditFileSavePayload;
};

export function createPageEditFileSaveBridge(sendRuntimeMessage: (message: unknown) => boolean) {
  return (event: MessageEvent) => {
    if (event.source !== window) {
      return;
    }

    if (!isCurrentPageMessageEventOrigin(window.location, event.origin)) {
      return;
    }

    const payload = (event.data as PageEditFileSaveMessage | undefined)?.payload;
    if (
      event.data?.type !== 'page_edit_save_file' ||
      !payload ||
      typeof payload.nonce !== 'string' ||
      typeof payload.pageUrl !== 'string' ||
      typeof payload.html !== 'string'
    ) {
      return;
    }

    sendRuntimeMessage({
      type: 'page_edit_save_file',
      payload: {
        nonce: payload.nonce,
        pageUrl: payload.pageUrl,
        html: payload.html,
      },
    });
  };
}
