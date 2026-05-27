import { isCurrentPageMessageEventOrigin } from './window-message-origin';

type PageEditSelectionAppendPayload = {
  nonce: string;
  source: 'file' | 'live-page';
  text: string;
};

type PageEditSelectionAppendMessage = {
  type: 'page_edit_selection_append';
  payload: PageEditSelectionAppendPayload;
};

type PageEditSelectionCapturePayload = {
  nonce: string;
  target: unknown;
};

type PageEditSelectionCaptureMessage = {
  type: 'page_edit_selection_capture';
  payload: PageEditSelectionCapturePayload;
};

type PageEditSelectionAnalyzePayload = {
  nonce: string;
  target: unknown;
};

type PageEditSelectionAnalyzeMessage = {
  type: 'page_edit_selection_analyze';
  payload: PageEditSelectionAnalyzePayload;
};

type PageEditPageCapturePayload = {
  nonce: string;
};

type PageEditPageCaptureMessage = {
  type: 'page_edit_capture_page';
  payload: PageEditPageCapturePayload;
};

type PageEditSelectionAnnotatePayload = {
  nonce: string;
  target: unknown;
  content: string;
};

type PageEditSelectionAnnotateMessage = {
  type: 'page_edit_selection_annotate';
  payload: PageEditSelectionAnnotatePayload;
};

export function createPageEditSelectionBridge(sendRuntimeMessage: (message: unknown) => boolean) {
  return (event: MessageEvent) => {
    if (event.source !== window) {
      return;
    }

    if (!isCurrentPageMessageEventOrigin(window.location, event.origin)) {
      return;
    }

    const appendPayload = (event.data as PageEditSelectionAppendMessage | undefined)?.payload;
    if (
      event.data?.type === 'page_edit_selection_append' &&
      appendPayload &&
      typeof appendPayload.nonce === 'string' &&
      typeof appendPayload.text === 'string' &&
      (appendPayload.source === 'file' || appendPayload.source === 'live-page')
    ) {
      sendRuntimeMessage({
        type: 'page_edit_selection_append',
        payload: {
          nonce: appendPayload.nonce,
          source: appendPayload.source,
          text: appendPayload.text,
        },
      });
      return;
    }

    const capturePayload = (event.data as PageEditSelectionCaptureMessage | undefined)?.payload;
    if (
      event.data?.type === 'page_edit_selection_capture' &&
      capturePayload &&
      typeof capturePayload.nonce === 'string' &&
      capturePayload.target
    ) {
      sendRuntimeMessage({
        type: 'page_edit_selection_capture',
        payload: {
          nonce: capturePayload.nonce,
          target: capturePayload.target,
        },
      });
      return;
    }

    const analyzePayload = (event.data as PageEditSelectionAnalyzeMessage | undefined)?.payload;
    if (
      event.data?.type === 'page_edit_selection_analyze' &&
      analyzePayload &&
      typeof analyzePayload.nonce === 'string' &&
      analyzePayload.target
    ) {
      sendRuntimeMessage({
        type: 'page_edit_selection_analyze',
        payload: {
          nonce: analyzePayload.nonce,
          target: analyzePayload.target,
        },
      });
      return;
    }

    const pageCapturePayload = (event.data as PageEditPageCaptureMessage | undefined)?.payload;
    if (
      event.data?.type === 'page_edit_capture_page' &&
      pageCapturePayload &&
      typeof pageCapturePayload.nonce === 'string'
    ) {
      sendRuntimeMessage({
        type: 'page_edit_capture_page',
        payload: {
          nonce: pageCapturePayload.nonce,
        },
      });
      return;
    }

    const annotatePayload = (event.data as PageEditSelectionAnnotateMessage | undefined)?.payload;
    if (
      event.data?.type === 'page_edit_selection_annotate' &&
      annotatePayload &&
      typeof annotatePayload.nonce === 'string' &&
      typeof annotatePayload.content === 'string' &&
      annotatePayload.target
    ) {
      sendRuntimeMessage({
        type: 'page_edit_selection_annotate',
        payload: {
          nonce: annotatePayload.nonce,
          target: annotatePayload.target,
          content: annotatePayload.content,
        },
      });
    }
  };
}
