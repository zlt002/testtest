// @vitest-environment node

import { describe, expect, it, vi } from 'vitest';

import { createPageWorkbenchStateBridge } from './page-workbench-state-bridge';

describe('createPageWorkbenchStateBridge', () => {
  it('reads capture.manifest.json and forwards restored workbench state', async () => {
    const sendRuntimeMessage = vi.fn();
    const readManifestText = vi.fn().mockResolvedValue(`{
      "sourcePageUrl": "https://example.com/articles/hello",
      "sourcePageType": "live-page",
      "targets": [
        {
          "targetId": "target-1",
          "pageUrl": "https://example.com/articles/hello",
          "pageType": "live-page",
          "createdAt": 101,
          "url": "https://example.com/articles/hello",
          "selector": "#hero",
          "xpath": "//*[@id=\\"hero\\"]",
          "tagName": "section",
          "id": "hero",
          "classList": ["hero"],
          "dataAttributes": { "section": "hero" },
          "text": "hero",
          "rect": { "x": 1, "y": 2, "width": 3, "height": 4 },
          "outerHTMLSnippet": "<section id=\\"hero\\"></section>",
          "ancestors": [{ "tagName": "body", "id": null, "classList": [] }],
          "siblings": { "previous": null, "next": null }
        }
      ],
      "annotations": [
        {
          "annotationId": "annotation-1",
          "targetId": "target-1",
          "content": "继续处理这里",
          "createdAt": 101,
          "updatedAt": 102,
          "sourcePageUrl": "https://example.com/articles/hello",
          "sourcePageType": "live-page",
          "status": "draft"
        }
      ]
    }`);
    const pageWindow = {
      location: {
        href: 'file:///Users/demo/capture/index.html',
        origin: 'null',
        protocol: 'file:',
      },
    } as unknown as Window & typeof globalThis;
    const pageDocument = {
      documentElement: {
        getAttribute: vi
          .fn()
          .mockReturnValue(
            '{"pageMode":"local-snapshot","selectionSessionNonce":"nonce-7","styleUrl":"chrome-extension://test/style.css"}'
          ),
      },
    } as unknown as Document;
    const bridge = createPageWorkbenchStateBridge(sendRuntimeMessage, {
      readManifestText,
      window: pageWindow,
      document: pageDocument,
    });

    await bridge.syncFromDocumentConfig();

    expect(readManifestText).toHaveBeenCalledWith('file:///Users/demo/capture/capture.manifest.json');
    expect(sendRuntimeMessage).toHaveBeenCalledWith({
      type: 'page_workbench_state_restore',
      payload: {
        nonce: 'nonce-7',
        pageUrl: 'file:///Users/demo/capture/index.html',
        sourcePageUrl: 'https://example.com/articles/hello',
        sourcePageType: 'live-page',
        targets: [
          expect.objectContaining({
            targetId: 'target-1',
            pageUrl: 'https://example.com/articles/hello',
            pageType: 'live-page',
          }),
        ],
        annotations: [
          expect.objectContaining({
            annotationId: 'annotation-1',
            sourcePageUrl: 'https://example.com/articles/hello',
            sourcePageType: 'live-page',
          }),
        ],
      },
    });
  });

  it('degrades to an empty workbench state when manifest is malformed', async () => {
    const sendRuntimeMessage = vi.fn();
    const readManifestText = vi.fn().mockResolvedValue('{bad json');
    const pageWindow = {
      location: {
        href: 'file:///Users/demo/capture/index.html',
        origin: 'null',
        protocol: 'file:',
      },
    } as unknown as Window & typeof globalThis;
    const pageDocument = {
      documentElement: {
        getAttribute: vi
          .fn()
          .mockReturnValue('{"pageMode":"local-snapshot","selectionSessionNonce":"nonce-7"}'),
      },
    } as unknown as Document;
    const bridge = createPageWorkbenchStateBridge(sendRuntimeMessage, {
      readManifestText,
      window: pageWindow,
      document: pageDocument,
    });

    await bridge.syncFromDocumentConfig();

    expect(sendRuntimeMessage).toHaveBeenCalledWith({
      type: 'page_workbench_state_restore',
      payload: {
        nonce: 'nonce-7',
        pageUrl: 'file:///Users/demo/capture/index.html',
        sourcePageUrl: null,
        sourcePageType: null,
        targets: [],
        annotations: [],
      },
    });
  });

  it('skips manifest restore when the current config is not local snapshot mode', async () => {
    const sendRuntimeMessage = vi.fn();
    const readManifestText = vi.fn();
    const pageWindow = {
      location: {
        href: 'https://example.com',
        origin: 'https://example.com',
        protocol: 'https:',
      },
    } as unknown as Window & typeof globalThis;
    const pageDocument = {
      documentElement: {
        getAttribute: vi.fn().mockReturnValue('{"pageMode":"live-page"}'),
      },
    } as unknown as Document;
    const bridge = createPageWorkbenchStateBridge(sendRuntimeMessage, {
      readManifestText,
      window: pageWindow,
      document: pageDocument,
    });

    await bridge.syncFromDocumentConfig();

    expect(readManifestText).not.toHaveBeenCalled();
    expect(sendRuntimeMessage).not.toHaveBeenCalled();
  });

  it('skips manifest restore when local snapshot config is missing the session nonce', async () => {
    const sendRuntimeMessage = vi.fn();
    const readManifestText = vi.fn();
    const pageWindow = {
      location: {
        href: 'file:///Users/demo/capture/index.html',
        origin: 'null',
        protocol: 'file:',
      },
    } as unknown as Window & typeof globalThis;
    const pageDocument = {
      documentElement: {
        getAttribute: vi.fn().mockReturnValue('{"pageMode":"local-snapshot"}'),
      },
    } as unknown as Document;
    const bridge = createPageWorkbenchStateBridge(sendRuntimeMessage, {
      readManifestText,
      window: pageWindow,
      document: pageDocument,
    });

    await bridge.syncFromDocumentConfig();

    expect(readManifestText).not.toHaveBeenCalled();
    expect(sendRuntimeMessage).not.toHaveBeenCalled();
  });
});
