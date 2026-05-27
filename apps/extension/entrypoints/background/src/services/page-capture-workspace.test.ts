// @vitest-environment node

import { describe, expect, it, vi } from 'vitest';
import type { PageCaptureArtifact } from './page-capture-types';
import { saveCaptureToWorkspace } from './page-capture-workspace';

const sampleArtifact: PageCaptureArtifact = {
  url: 'https://example.com',
  title: 'Example Capture',
  capturedAt: '2026-05-12T08:30:45.000Z',
  mode: 'page',
  html: '<html></html>',
  styles: [{ path: 'style.css', content: 'body{color:red;}' }],
  assets: [],
  warnings: [],
  metadata: {
    originalUrl: 'https://example.com',
    userAgent: 'test',
    documentTitle: 'Example Capture',
  },
};

describe('saveCaptureToWorkspace', () => {
  it('writes index html and metadata into the workspace capture directory', async () => {
    const client = {
      createEntry: vi.fn().mockResolvedValue(undefined),
      writeFile: vi.fn().mockResolvedValue(undefined),
    };

    const result = await saveCaptureToWorkspace(client, '/tmp/project', sampleArtifact);

    expect(client.createEntry).toHaveBeenCalledWith(
      expect.objectContaining({
        projectPath: '/tmp/project',
        parentPath: '',
        type: 'directory',
        name: 'captures',
      })
    );
    expect(client.writeFile).toHaveBeenCalledWith(
      expect.objectContaining({
        projectPath: '/tmp/project',
        filePath: expect.stringMatching(/^captures\/.+\/index\.html$/),
        content: '<html></html>',
      })
    );
    expect(client.writeFile).toHaveBeenCalledWith(
      expect.objectContaining({
        projectPath: '/tmp/project',
        filePath: expect.stringMatching(/^captures\/.+\/style\.css$/),
        content: 'body{color:red;}',
      })
    );
    expect(client.writeFile).toHaveBeenCalledWith(
      expect.objectContaining({
        projectPath: '/tmp/project',
        filePath: expect.stringMatching(/^captures\/.+\/capture\.meta\.json$/),
      })
    );
    const manifestWrite = client.writeFile.mock.calls.find(([input]) =>
      input.filePath.endsWith('/capture.manifest.json')
    );
    expect(manifestWrite).toBeDefined();
    expect(JSON.parse(manifestWrite?.[0].content ?? '{}')).toMatchObject({
      captureId: expect.any(String),
      mode: 'page',
      sourcePageUrl: 'https://example.com',
      sourcePageType: null,
      capturedAt: '2026-05-12T08:30:45.000Z',
      entryPath: expect.stringMatching(/^captures\/.+$/),
      parentCaptureId: null,
      targets: [],
      annotations: [],
    });
    expect(client.createEntry).not.toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'directory',
        parentPath: expect.stringMatching(/^captures\/.+$/),
        name: 'assets',
      })
    );
    expect(client.writeFile).not.toHaveBeenCalledWith(
      expect.objectContaining({
        filePath: expect.stringMatching(/^captures\/.+\/assets\//),
      })
    );
    expect(result.entryPath).toContain('captures/');
    expect(result.assetCount).toBe(0);
  });

  it('writes style summaries into capture metadata', async () => {
    const client = {
      createEntry: vi.fn().mockResolvedValue(undefined),
      writeFile: vi.fn().mockResolvedValue(undefined),
    };

    await saveCaptureToWorkspace(client, '/tmp/project', sampleArtifact);

    const metadataWrite = client.writeFile.mock.calls.find(([input]) =>
      input.filePath.endsWith('/capture.meta.json')
    );

    expect(metadataWrite).toBeDefined();
    expect(JSON.parse(metadataWrite?.[0].content ?? '{}')).toMatchObject({
      styles: [{ path: 'style.css', bytes: 16 }],
    });
  });

  it('writes workbench targets and annotations into the snapshot manifest', async () => {
    const client = {
      createEntry: vi.fn().mockResolvedValue(undefined),
      writeFile: vi.fn().mockResolvedValue(undefined),
    };

    await saveCaptureToWorkspace(client, '/tmp/project', sampleArtifact, {
      sourcePageUrl: 'https://example.com/original',
      sourcePageType: 'live-page',
      parentCaptureId: 'capture-root',
      targets: [
        {
          targetId: 'target-1',
          pageUrl: 'https://example.com/original',
          pageType: 'live-page',
          createdAt: 1,
          url: 'https://example.com/original',
          selector: '#hero',
          xpath: '//*[@id="hero"]',
          tagName: 'section',
          id: 'hero',
          classList: ['hero'],
          dataAttributes: {},
          text: 'Hero',
          rect: { x: 0, y: 0, width: 240, height: 90 },
          outerHTMLSnippet: '<section id="hero">Hero</section>',
          ancestors: [{ tagName: 'main', id: null, classList: [] }],
          siblings: { previous: null, next: null },
        },
      ],
      annotations: [
        {
          annotationId: 'annotation-1',
          targetId: 'target-1',
          content: '这里要重点保留',
          createdAt: 1,
          updatedAt: 2,
          sourcePageUrl: 'https://example.com/original',
          sourcePageType: 'live-page',
          status: 'captured',
        },
      ],
    });

    const manifestWrite = client.writeFile.mock.calls.find(([input]) =>
      input.filePath.endsWith('/capture.manifest.json')
    );

    expect(manifestWrite).toBeDefined();
    expect(JSON.parse(manifestWrite?.[0].content ?? '{}')).toMatchObject({
      sourcePageUrl: 'https://example.com/original',
      sourcePageType: 'live-page',
      parentCaptureId: 'capture-root',
      targets: [{ targetId: 'target-1' }],
      annotations: [{ annotationId: 'annotation-1' }],
    });
  });

  it('still writes decodable legacy text assets into the capture asset directory', async () => {
    const client = {
      createEntry: vi.fn().mockResolvedValue(undefined),
      writeFile: vi.fn().mockResolvedValue(undefined),
    };
    const legacyArtifact: PageCaptureArtifact = {
      ...sampleArtifact,
      styles: [],
      assets: [
        {
          id: 'asset-1',
          kind: 'stylesheet',
          sourceUrl: 'https://example.com/app.css',
          mimeType: 'text/css',
          relativePath: 'assets/styles/app.css',
          contentBase64: Buffer.from('body{color:red;}', 'utf8').toString('base64'),
          inlineCandidate: false,
        },
      ],
    };

    const result = await saveCaptureToWorkspace(client, '/tmp/project', legacyArtifact);

    expect(client.createEntry).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'directory',
        parentPath: expect.stringMatching(/^captures\/.+$/),
        name: 'assets',
      })
    );
    expect(client.writeFile).toHaveBeenCalledWith(
      expect.objectContaining({
        filePath: expect.stringMatching(/^captures\/.+\/assets\/styles\/app\.css$/),
        content: 'body{color:red;}',
      })
    );
    expect(result.assetCount).toBe(1);
  });
});
