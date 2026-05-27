// @vitest-environment node

import { describe, expect, it, vi } from 'vitest';

import type { PickedElementContext } from '@/entrypoints/lib/page-picker';

import {
  createPageAnnotationStore,
  type ElementAnnotation,
  type SelectionTarget,
} from './page-annotations';
import {
  createPageEditPageCaptureMessageListener,
  createPageEditSelectionAnnotateMessageListener,
  createPageEditSelectionCaptureMessageListener,
  createPageEditSelectionMessageListener,
} from './page-edit';

const sampleTarget: SelectionTarget = {
  targetId: 'target-1',
  pageUrl: 'https://example.com/article',
  pageType: 'live-page',
  createdAt: 1_717_000_000_000,
  url: 'https://example.com/article',
  selector: '#card',
  xpath: '//*[@id="card"]',
  tagName: 'section',
  id: 'card',
  classList: ['feature-card'],
  dataAttributes: {
    role: 'hero',
  },
  text: 'Card body',
  rect: { x: 12, y: 24, width: 320, height: 180 },
  outerHTMLSnippet: '<section id="card">Card body</section>',
  ancestors: [{ tagName: 'main', id: null, classList: ['page-main'] }],
  siblings: { previous: 'header', next: 'footer' },
};

const sampleAnnotation: ElementAnnotation = {
  annotationId: 'annotation-1',
  targetId: 'target-1',
  content: '需要重点说明',
  createdAt: 1_717_000_000_000,
  updatedAt: 1_717_000_000_000,
  sourcePageUrl: 'https://example.com/article',
  sourcePageType: 'live-page',
  status: 'draft',
};

const samplePickedTarget: PickedElementContext = {
  url: 'https://example.com/article',
  selector: '#card',
  xpath: '//*[@id="card"]',
  tagName: 'section',
  id: 'card',
  classList: ['feature-card'],
  dataAttributes: {
    role: 'hero',
  },
  text: 'Card body',
  rect: { x: 12, y: 24, width: 320, height: 180 },
  outerHTMLSnippet: '<section id="card">Card body</section>',
  ancestors: [{ tagName: 'main', id: null, classList: ['page-main'] }],
  siblings: { previous: 'header', next: 'footer' },
};

describe('createPageAnnotationStore', () => {
  it('supports writing a target into the same tab', () => {
    const store = createPageAnnotationStore();

    store.upsertTarget(7, sampleTarget);

    expect(store.listTargets(7)).toEqual([sampleTarget]);
  });

  it('supports writing an annotation into the same tab', () => {
    const store = createPageAnnotationStore();

    store.upsertAnnotation(7, sampleAnnotation);

    expect(store.listAnnotations(7)).toEqual([sampleAnnotation]);
  });

  it('returns the expected targets and annotations for a tab', () => {
    const store = createPageAnnotationStore();

    store.upsertTarget(7, sampleTarget);
    store.upsertAnnotation(7, sampleAnnotation);
    store.upsertTarget(8, { ...sampleTarget, targetId: 'target-2' });
    store.upsertAnnotation(8, { ...sampleAnnotation, annotationId: 'annotation-2' });

    expect(store.listTargets(7)).toEqual([sampleTarget]);
    expect(store.listAnnotations(7)).toEqual([sampleAnnotation]);
  });

  it('replaces records on repeated upsert by id', () => {
    const store = createPageAnnotationStore();

    store.upsertTarget(7, sampleTarget);
    store.upsertTarget(7, { ...sampleTarget, text: 'Updated target text' });
    store.upsertAnnotation(7, sampleAnnotation);
    store.upsertAnnotation(7, { ...sampleAnnotation, content: '鏇存柊鍚庣殑澶囨敞' });

    expect(store.listTargets(7)).toEqual([{ ...sampleTarget, text: 'Updated target text' }]);
    expect(store.listAnnotations(7)).toEqual([{ ...sampleAnnotation, content: '鏇存柊鍚庣殑澶囨敞' }]);
  });

  it('clears stored records for a tab', () => {
    const store = createPageAnnotationStore();

    store.upsertTarget(7, sampleTarget);
    store.upsertAnnotation(7, sampleAnnotation);

    store.clearTab(7);

    expect(store.listTargets(7)).toEqual([]);
    expect(store.listAnnotations(7)).toEqual([]);
  });

  it('returns defensive copies instead of mutable internal references', () => {
    const store = createPageAnnotationStore();

    store.upsertTarget(7, sampleTarget);
    store.upsertAnnotation(7, sampleAnnotation);

    const targets = store.listTargets(7);
    const annotations = store.listAnnotations(7);

    targets[0].classList.push('mutated');
    targets[0].rect.width = 999;
    annotations[0].content = 'mutated';

    expect(store.listTargets(7)).toEqual([sampleTarget]);
    expect(store.listAnnotations(7)).toEqual([sampleAnnotation]);
  });
});

describe('createPageEditSelectionAnnotateMessageListener', () => {
  it('writes target and annotation records for the current active tab', async () => {
    const store = createPageAnnotationStore();
    const getActiveTab = vi.fn().mockResolvedValue({
      id: 7,
      windowId: 7,
      url: 'https://example.com/article',
    });
    const getPageEditState = vi.fn().mockReturnValue({
      tabId: 7,
      windowId: 7,
      url: 'https://example.com/article',
      status: 'active',
      pageMode: 'live-page',
      selectionSessionNonce: 'nonce-7',
    });
    const listener = createPageEditSelectionAnnotateMessageListener({
      getActiveTab,
      getPageEditState,
      annotationStore: store,
      createTargetId: () => 'target-1',
      createAnnotationId: () => 'annotation-1',
      now: () => 1_717_000_000_000,
    });

    const result = await listener(
      {
        type: 'page_edit_selection_annotate',
        payload: {
          nonce: 'nonce-7',
          target: samplePickedTarget,
          content: '需要重点说明',
        },
      },
      {
        tab: { id: 7, windowId: 7, url: 'https://example.com/article' },
      } as chrome.runtime.MessageSender
    );

    expect(result).toBe(false);
    expect(getPageEditState).toHaveBeenCalledWith(7);
    expect(getActiveTab).toHaveBeenCalledTimes(1);
    expect(store.listTargets(7)).toEqual([
      {
        ...sampleTarget,
        createdAt: 1_717_000_000_000,
      },
    ]);
    expect(store.listAnnotations(7)).toEqual([
      {
        ...sampleAnnotation,
      },
    ]);
  });

  it('completes store writes before the listener promise resolves', async () => {
    const store = createPageAnnotationStore();
    let resolveActiveTab: ((value: { id: number; windowId: number; url: string }) => void) | null =
      null;
    const getActiveTab = vi.fn().mockImplementation(
      () =>
        new Promise<{ id: number; windowId: number; url: string }>((resolve) => {
          resolveActiveTab = resolve;
        })
    );
    const getPageEditState = vi.fn().mockReturnValue({
      tabId: 7,
      windowId: 7,
      url: 'https://example.com/article',
      status: 'active',
      pageMode: 'live-page',
      selectionSessionNonce: 'nonce-7',
    });
    const listener = createPageEditSelectionAnnotateMessageListener({
      getActiveTab,
      getPageEditState,
      annotationStore: store,
      createTargetId: () => 'target-1',
      createAnnotationId: () => 'annotation-1',
      now: () => 1_717_000_000_000,
    });

    const listenerPromise = listener(
      {
        type: 'page_edit_selection_annotate',
        payload: {
          nonce: 'nonce-7',
          target: samplePickedTarget,
          content: '需要重点说明',
        },
      },
      {
        tab: { id: 7, windowId: 7, url: 'https://example.com/article' },
      } as chrome.runtime.MessageSender
    );

    expect(store.listTargets(7)).toEqual([]);
    expect(store.listAnnotations(7)).toEqual([]);

    resolveActiveTab?.({
      id: 7,
      windowId: 7,
      url: 'https://example.com/article',
    });

    const result = await listenerPromise;

    expect(result).toBe(false);
    expect(store.listTargets(7)).toEqual([
      {
        ...sampleTarget,
        createdAt: 1_717_000_000_000,
      },
    ]);
    expect(store.listAnnotations(7)).toEqual([sampleAnnotation]);
  });

  it('ignores annotate messages when nonce does not match', async () => {
    const store = createPageAnnotationStore();
    const getActiveTab = vi.fn().mockResolvedValue({
      id: 7,
      windowId: 7,
      url: 'https://example.com/article',
    });
    const getPageEditState = vi.fn().mockReturnValue({
      tabId: 7,
      windowId: 7,
      url: 'https://example.com/article',
      status: 'active',
      pageMode: 'live-page',
      selectionSessionNonce: 'nonce-7',
    });
    const listener = createPageEditSelectionAnnotateMessageListener({
      getActiveTab,
      getPageEditState,
      annotationStore: store,
    });

    const result = await listener(
      {
        type: 'page_edit_selection_annotate',
        payload: {
          nonce: 'wrong-nonce',
          target: samplePickedTarget,
          content: '需要重点说明',
        },
      },
      {
        tab: { id: 7, windowId: 7, url: 'https://example.com/article' },
      } as chrome.runtime.MessageSender
    );

    expect(result).toBe(false);
    expect(getActiveTab).not.toHaveBeenCalled();
    expect(store.listTargets(7)).toEqual([]);
    expect(store.listAnnotations(7)).toEqual([]);
  });

  it('ignores annotate messages when page edit is inactive', async () => {
    const store = createPageAnnotationStore();
    const getActiveTab = vi.fn().mockResolvedValue({
      id: 7,
      windowId: 7,
      url: 'https://example.com/article',
    });
    const getPageEditState = vi.fn().mockReturnValue({
      tabId: 7,
      windowId: 7,
      url: 'https://example.com/article',
      status: 'capturing',
      pageMode: 'live-page',
      selectionSessionNonce: 'nonce-7',
    });
    const listener = createPageEditSelectionAnnotateMessageListener({
      getActiveTab,
      getPageEditState,
      annotationStore: store,
    });

    const result = await listener(
      {
        type: 'page_edit_selection_annotate',
        payload: {
          nonce: 'nonce-7',
          target: samplePickedTarget,
          content: '需要重点说明',
        },
      },
      {
        tab: { id: 7, windowId: 7, url: 'https://example.com/article' },
      } as chrome.runtime.MessageSender
    );

    expect(result).toBe(false);
    expect(getActiveTab).not.toHaveBeenCalled();
    expect(store.listTargets(7)).toEqual([]);
    expect(store.listAnnotations(7)).toEqual([]);
  });

  it('ignores annotate messages when active tab no longer matches sender tab', async () => {
    const store = createPageAnnotationStore();
    const getActiveTab = vi.fn().mockResolvedValue({
      id: 8,
      windowId: 7,
      url: 'https://example.com/article',
    });
    const getPageEditState = vi.fn().mockReturnValue({
      tabId: 7,
      windowId: 7,
      url: 'https://example.com/article',
      status: 'active',
      pageMode: 'live-page',
      selectionSessionNonce: 'nonce-7',
    });
    const listener = createPageEditSelectionAnnotateMessageListener({
      getActiveTab,
      getPageEditState,
      annotationStore: store,
    });

    const result = await listener(
      {
        type: 'page_edit_selection_annotate',
        payload: {
          nonce: 'nonce-7',
          target: samplePickedTarget,
          content: '需要重点说明',
        },
      },
      {
        tab: { id: 7, windowId: 7, url: 'https://example.com/article' },
      } as chrome.runtime.MessageSender
    );

    expect(result).toBe(false);
    expect(getActiveTab).toHaveBeenCalledTimes(1);
    expect(store.listTargets(7)).toEqual([]);
    expect(store.listAnnotations(7)).toEqual([]);
  });

  it('ignores annotate messages when urls are inconsistent across the page identity inputs', async () => {
    const store = createPageAnnotationStore();
    const getActiveTab = vi.fn().mockResolvedValue({
      id: 7,
      windowId: 7,
      url: 'https://example.com/renavigated',
    });
    const getPageEditState = vi.fn().mockReturnValue({
      tabId: 7,
      windowId: 7,
      url: 'https://example.com/article',
      status: 'active',
      pageMode: 'live-page',
      selectionSessionNonce: 'nonce-7',
    });
    const listener = createPageEditSelectionAnnotateMessageListener({
      getActiveTab,
      getPageEditState,
      annotationStore: store,
    });

    const result = await listener(
      {
        type: 'page_edit_selection_annotate',
        payload: {
          nonce: 'nonce-7',
          target: { ...samplePickedTarget, url: 'https://example.com/other' },
          content: '需要重点说明',
        },
      },
      {
        tab: { id: 7, windowId: 7, url: 'https://example.com/article' },
      } as chrome.runtime.MessageSender
    );

    expect(result).toBe(false);
    expect(getActiveTab).toHaveBeenCalledTimes(1);
    expect(store.listTargets(7)).toEqual([]);
    expect(store.listAnnotations(7)).toEqual([]);
  });

  it('ignores annotate messages when target structure is incomplete', async () => {
    const store = createPageAnnotationStore();
    const getActiveTab = vi.fn().mockResolvedValue({
      id: 7,
      windowId: 7,
      url: 'https://example.com/article',
    });
    const getPageEditState = vi.fn().mockReturnValue({
      tabId: 7,
      windowId: 7,
      url: 'https://example.com/article',
      status: 'active',
      pageMode: 'live-page',
      selectionSessionNonce: 'nonce-7',
    });
    const listener = createPageEditSelectionAnnotateMessageListener({
      getActiveTab,
      getPageEditState,
      annotationStore: store,
    });

    const result = await listener(
      {
        type: 'page_edit_selection_annotate',
        payload: {
          nonce: 'nonce-7',
          target: {
            ...samplePickedTarget,
            dataAttributes: undefined,
          },
          content: '需要重点说明',
        },
      },
      {
        tab: { id: 7, windowId: 7, url: 'https://example.com/article' },
      } as chrome.runtime.MessageSender
    );

    expect(result).toBe(false);
    expect(getActiveTab).not.toHaveBeenCalled();
    expect(store.listTargets(7)).toEqual([]);
    expect(store.listAnnotations(7)).toEqual([]);
  });

  it('returns false and avoids unhandled rejection when active tab lookup fails', async () => {
    const store = createPageAnnotationStore();
    const getActiveTab = vi.fn().mockRejectedValue(new Error('lookup failed'));
    const getPageEditState = vi.fn().mockReturnValue({
      tabId: 7,
      windowId: 7,
      url: 'https://example.com/article',
      status: 'active',
      pageMode: 'live-page',
      selectionSessionNonce: 'nonce-7',
    });
    const listener = createPageEditSelectionAnnotateMessageListener({
      getActiveTab,
      getPageEditState,
      annotationStore: store,
    });

    const result = await listener(
      {
        type: 'page_edit_selection_annotate',
        payload: {
          nonce: 'nonce-7',
          target: samplePickedTarget,
          content: '需要重点说明',
        },
      },
      {
        tab: { id: 7, windowId: 7, url: 'https://example.com/article' },
      } as chrome.runtime.MessageSender
    );

    expect(result).toBe(false);
    expect(store.listTargets(7)).toEqual([]);
    expect(store.listAnnotations(7)).toEqual([]);
  });
});

describe('page-edit async rejection guards', () => {
  it('page capture listener forwards full-page workbench metadata collected on the current tab', async () => {
    const publishQuickActionFeedback = vi.fn().mockResolvedValue(undefined);
    const openSidePanel = vi.fn().mockResolvedValue(undefined);
    const getActiveTab = vi.fn().mockResolvedValue({
      id: 7,
      windowId: 7,
      url: 'https://example.com/article',
    });
    const getPageEditState = vi.fn().mockReturnValue({
      tabId: 7,
      windowId: 7,
      url: 'https://example.com/article',
      status: 'active',
      pageMode: 'live-page',
      selectionSessionNonce: 'nonce-7',
    });
    const captureToWorkspace = vi.fn().mockResolvedValue({
      entryPath: 'captures/20260517-example-article-page',
    });
    const annotationStore = {
      listTargets: vi.fn().mockReturnValue([sampleTarget]),
      listAnnotations: vi.fn().mockReturnValue([sampleAnnotation]),
    };
    const listener = createPageEditPageCaptureMessageListener({
      getActiveTab,
      getPageEditState,
      captureToWorkspace,
      annotationStore,
      publishQuickActionFeedback,
      openSidePanel,
    });

    const result = listener(
      {
        type: 'page_edit_capture_page',
        payload: {
          nonce: 'nonce-7',
        },
      },
      {
        tab: { id: 7, windowId: 7, url: 'https://example.com/article' },
      } as chrome.runtime.MessageSender
    );

    await Promise.resolve();
    await Promise.resolve();

    expect(result).toBe(false);
    expect(captureToWorkspace).toHaveBeenCalledWith({
      mode: 'page',
      workbench: {
        sourcePageUrl: 'https://example.com/article',
        sourcePageType: 'live-page',
        targets: [sampleTarget],
        annotations: [sampleAnnotation],
      },
    });
    expect(annotationStore.listTargets).toHaveBeenCalledWith(7);
    expect(annotationStore.listAnnotations).toHaveBeenCalledWith(7);
    expect(openSidePanel).toHaveBeenCalledWith(7);
    expect(publishQuickActionFeedback).toHaveBeenCalledWith({
      kind: 'success',
      message: '网页已保存到',
      entryPath: 'captures/20260517-example-article-page',
      source: 'page-edit:capture',
    });
  });

  it('capture listener forwards workbench metadata collected on the current tab', async () => {
    const publishQuickActionFeedback = vi.fn().mockResolvedValue(undefined);
    const openSidePanel = vi.fn().mockResolvedValue(undefined);
    const getActiveTab = vi.fn().mockResolvedValue({
      id: 7,
      windowId: 7,
      url: 'https://example.com/article',
    });
    const getPageEditState = vi.fn().mockReturnValue({
      tabId: 7,
      windowId: 7,
      url: 'https://example.com/article',
      status: 'active',
      pageMode: 'live-page',
      selectionSessionNonce: 'nonce-7',
    });
    const captureToWorkspace = vi.fn().mockResolvedValue({
      entryPath: 'captures/20260517-example-article',
    });
    const annotationStore = {
      listTargets: vi.fn().mockReturnValue([sampleTarget]),
      listAnnotations: vi.fn().mockReturnValue([sampleAnnotation]),
    };
    const listener = createPageEditSelectionCaptureMessageListener({
      getActiveTab,
      getPageEditState,
      captureToWorkspace,
      annotationStore,
      publishQuickActionFeedback,
      openSidePanel,
    });

    const result = listener(
      {
        type: 'page_edit_selection_capture',
        payload: {
          nonce: 'nonce-7',
          target: samplePickedTarget,
        },
      },
      {
        tab: { id: 7, windowId: 7, url: 'https://example.com/article' },
      } as chrome.runtime.MessageSender
    );

    await Promise.resolve();
    await Promise.resolve();

    expect(result).toBe(false);
    expect(captureToWorkspace).toHaveBeenCalledWith({
      mode: 'element',
      target: samplePickedTarget,
      workbench: {
        sourcePageUrl: 'https://example.com/article',
        sourcePageType: 'live-page',
        targets: [sampleTarget],
        annotations: [sampleAnnotation],
      },
    });
    expect(annotationStore.listTargets).toHaveBeenCalledWith(7);
    expect(annotationStore.listAnnotations).toHaveBeenCalledWith(7);
    expect(openSidePanel).toHaveBeenCalledWith(7);
    expect(publishQuickActionFeedback).toHaveBeenCalledWith({
      kind: 'success',
      message: '网页已保存到',
      entryPath: 'captures/20260517-example-article',
      source: 'page-edit:capture',
    });
  });

  it('selection listener swallows active tab lookup rejection', async () => {
    const publishComposerAppend = vi.fn().mockResolvedValue(undefined);
    const openSidePanel = vi.fn().mockResolvedValue(undefined);
    const getActiveTab = vi.fn().mockRejectedValue(new Error('lookup failed'));
    const getPageEditState = vi.fn().mockReturnValue({
      tabId: 7,
      windowId: 7,
      url: 'https://example.com/article',
      status: 'active',
      selectionSessionNonce: 'nonce-7',
    });
    const listener = createPageEditSelectionMessageListener({
      getActiveTab,
      getPageEditState,
      publishComposerAppend,
      openSidePanel,
    });

    const result = listener(
      {
        type: 'page_edit_selection_append',
        payload: {
          nonce: 'nonce-7',
          source: 'file',
          text: '瀹氫綅淇℃伅锛歕n鏂囦欢: /tmp/mock.html',
        },
      },
      { tab: { id: 7, windowId: 7 } } as chrome.runtime.MessageSender
    );

    await Promise.resolve();
    await Promise.resolve();

    expect(result).toBe(false);
    expect(getActiveTab).toHaveBeenCalledTimes(1);
    expect(openSidePanel).not.toHaveBeenCalled();
    expect(publishComposerAppend).not.toHaveBeenCalled();
  });

  it('capture listener swallows rejection from active tab lookup and failure reporting', async () => {
    const publishQuickActionFeedback = vi.fn().mockResolvedValue(undefined);
    const openSidePanel = vi.fn().mockResolvedValue(undefined);
    const getActiveTab = vi.fn().mockRejectedValue(new Error('lookup failed'));
    const getPageEditState = vi.fn().mockReturnValue({
      tabId: 7,
      windowId: 7,
      url: 'https://example.com/article',
      status: 'active',
      pageMode: 'live-page',
      selectionSessionNonce: 'nonce-7',
    });
    const captureToWorkspace = vi.fn();
    const listener = createPageEditSelectionCaptureMessageListener({
      getActiveTab,
      getPageEditState,
      captureToWorkspace,
      publishQuickActionFeedback,
      openSidePanel,
    });

    const result = listener(
      {
        type: 'page_edit_selection_capture',
        payload: {
          nonce: 'nonce-7',
          target: samplePickedTarget,
        },
      },
      {
        tab: { id: 7, windowId: 7, url: 'https://example.com/article' },
      } as chrome.runtime.MessageSender
    );

    await Promise.resolve();
    await Promise.resolve();

    expect(result).toBe(false);
    expect(getActiveTab).toHaveBeenCalledTimes(1);
    expect(captureToWorkspace).not.toHaveBeenCalled();
    expect(openSidePanel).not.toHaveBeenCalled();
    expect(publishQuickActionFeedback).not.toHaveBeenCalled();
  });

  it('capture listener swallows rejection from failure reporting after capture error', async () => {
    const publishQuickActionFeedback = vi.fn().mockRejectedValue(new Error('report failed'));
    const openSidePanel = vi.fn().mockResolvedValue(undefined);
    const getActiveTab = vi.fn().mockResolvedValue({
      id: 7,
      windowId: 7,
      url: 'https://example.com/article',
    });
    const getPageEditState = vi.fn().mockReturnValue({
      tabId: 7,
      windowId: 7,
      url: 'https://example.com/article',
      status: 'active',
      pageMode: 'live-page',
      selectionSessionNonce: 'nonce-7',
    });
    const captureToWorkspace = vi.fn().mockRejectedValue(new Error('capture failed'));
    const listener = createPageEditSelectionCaptureMessageListener({
      getActiveTab,
      getPageEditState,
      captureToWorkspace,
      publishQuickActionFeedback,
      openSidePanel,
    });

    const result = listener(
      {
        type: 'page_edit_selection_capture',
        payload: {
          nonce: 'nonce-7',
          target: samplePickedTarget,
        },
      },
      {
        tab: { id: 7, windowId: 7, url: 'https://example.com/article' },
      } as chrome.runtime.MessageSender
    );

    await Promise.resolve();
    await Promise.resolve();

    expect(result).toBe(false);
    expect(getActiveTab).toHaveBeenCalledTimes(1);
    expect(captureToWorkspace).toHaveBeenCalledWith({
      mode: 'element',
      target: samplePickedTarget,
      workbench: {
        sourcePageUrl: 'https://example.com/article',
        sourcePageType: 'live-page',
        targets: [],
        annotations: [],
      },
    });
    expect(openSidePanel).not.toHaveBeenCalled();
    expect(publishQuickActionFeedback).toHaveBeenCalledWith({
      kind: 'error',
      message: '采集选中内容失败：capture failed',
      source: 'page-edit:capture',
    });
  });
});

