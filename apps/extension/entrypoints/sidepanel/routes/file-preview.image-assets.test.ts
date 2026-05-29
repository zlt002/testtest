// @vitest-environment node

import { describe, expect, it } from 'vitest';
import {
  buildMarkdownImageSnippet,
  buildMarkdownPreviewImageUrl,
  imageExtensionFromMimeType,
  insertMarkdownImageSnippet,
  loadMarkdownPreviewImageSource,
  resolveAvailableImageAssetPath,
  validateMarkdownImageFile,
} from './file-preview.image-assets';

describe('file preview image assets', () => {
  it('accepts supported image mime types and rejects unsupported files', () => {
    expect(validateMarkdownImageFile({ mimeType: 'image/png', size: 1024 }).ok).toBe(true);
    expect(validateMarkdownImageFile({ mimeType: 'image/jpeg', size: 1024 }).ok).toBe(true);
    expect(validateMarkdownImageFile({ mimeType: 'text/plain', size: 1024 })).toEqual({
      ok: false,
      message: '仅支持 PNG、JPEG、WEBP、GIF 图片',
    });
  });

  it('rejects images larger than 10MB', () => {
    expect(validateMarkdownImageFile({ mimeType: 'image/png', size: 10 * 1024 * 1024 + 1 })).toEqual({
      ok: false,
      message: '图片不能超过 10MB',
    });
  });

  it('maps supported mime types to markdown-safe extensions', () => {
    expect(imageExtensionFromMimeType('image/png')).toBe('png');
    expect(imageExtensionFromMimeType('image/jpeg')).toBe('jpg');
    expect(imageExtensionFromMimeType('image/webp')).toBe('webp');
    expect(imageExtensionFromMimeType('image/gif')).toBe('gif');
  });

  it('creates asset paths beside the current markdown document', () => {
    expect(
      resolveAvailableImageAssetPath({
        markdownFilePath: 'docs/PRD-智能车线规划引擎.md',
        mimeType: 'image/png',
        now: new Date('2026-05-26T14:03:01+08:00'),
        existingRelativePaths: new Set(),
      })
    ).toEqual({
      filePath: 'docs/assets/PRD-智能车线规划引擎-20260526-140301.png',
      markdownPath: 'assets/PRD-智能车线规划引擎-20260526-140301.png',
    });
  });

  it('adds a numeric suffix when the generated asset path already exists', () => {
    expect(
      resolveAvailableImageAssetPath({
        markdownFilePath: 'PRD.md',
        mimeType: 'image/png',
        now: new Date('2026-05-26T14:03:01+08:00'),
        existingRelativePaths: new Set(['assets/PRD-20260526-140301.png']),
      }).markdownPath
    ).toBe('assets/PRD-20260526-140301-2.png');
  });

  it('builds and inserts a spaced markdown image snippet', () => {
    const snippet = buildMarkdownImageSnippet({ alt: '流程图', markdownPath: 'assets/a.png' });
    expect(snippet).toBe('\n\n![流程图](assets/a.png)\n\n');
    expect(insertMarkdownImageSnippet('第一段\n第二段', 3, snippet)).toBe(
      '第一段\n\n![流程图](assets/a.png)\n\n\n第二段'
    );
  });

  it('builds backend preview urls for relative markdown image paths', () => {
    expect(
      buildMarkdownPreviewImageUrl({
        backendBaseUrl: 'http://127.0.0.1:12306/',
        projectPath: '/Users/me/project',
        markdownFilePath: 'docs/PRD.md',
        imageSrc: 'assets/流程图.png',
      })
    ).toBe(
      'http://127.0.0.1:12306/api/preview/file?projectPath=%2FUsers%2Fme%2Fproject&filePath=docs%2Fassets%2F%E6%B5%81%E7%A8%8B%E5%9B%BE.png'
    );
  });

  it('does not double-encode markdown image paths already encoded by the renderer', () => {
    expect(
      buildMarkdownPreviewImageUrl({
        backendBaseUrl: 'http://127.0.0.1:12306',
        projectPath: '/Users/me/project',
        markdownFilePath: 'PRD.md',
        imageSrc:
          'assets/%E5%BF%AB%E9%80%92%E7%AE%A1%E7%90%86%E8%99%9A%E5%81%87%E8%BF%90%E5%8D%95%E6%B8%85%E7%90%86PRD-20260526-220814.png',
      })
    ).toBe(
      'http://127.0.0.1:12306/api/preview/file?projectPath=%2FUsers%2Fme%2Fproject&filePath=assets%2F%E5%BF%AB%E9%80%92%E7%AE%A1%E7%90%86%E8%99%9A%E5%81%87%E8%BF%90%E5%8D%95%E6%B8%85%E7%90%86PRD-20260526-220814.png'
    );
  });

  it('keeps external and data image urls unchanged', () => {
    expect(
      buildMarkdownPreviewImageUrl({
        backendBaseUrl: 'http://127.0.0.1:12306',
        projectPath: '/Users/me/project',
        markdownFilePath: 'docs/PRD.md',
        imageSrc: 'https://example.com/a.png',
      })
    ).toBe('https://example.com/a.png');
    expect(
      buildMarkdownPreviewImageUrl({
        backendBaseUrl: 'http://127.0.0.1:12306',
        projectPath: '/Users/me/project',
        markdownFilePath: 'docs/PRD.md',
        imageSrc: 'data:image/png;base64,abc',
      })
    ).toBe('data:image/png;base64,abc');
  });

  it('loads relative markdown images as blob urls instead of direct backend urls', async () => {
    const fetch = async (input: string | URL) => {
      expect(String(input)).toBe(
        'http://127.0.0.1:12306/api/preview/file?projectPath=%2FUsers%2Fme%2Fproject&filePath=docs%2Fassets%2F%E6%B5%81%E7%A8%8B%E5%9B%BE.png'
      );
      return new Response(new Blob(['png-bytes'], { type: 'image/png' }), {
        status: 200,
      });
    };
    const revokeObjectURL = () => {};

    const result = await loadMarkdownPreviewImageSource(
      {
        backendBaseUrl: 'http://127.0.0.1:12306/',
        projectPath: '/Users/me/project',
        markdownFilePath: 'docs/PRD.md',
        imageSrc: 'assets/流程图.png',
      },
      {
        fetch,
        createObjectURL(blob) {
          expect(blob.type).toBe('image/png');
          return 'blob:chrome-extension://test/preview-image';
        },
        revokeObjectURL,
      }
    );

    expect(result.src).toBe('blob:chrome-extension://test/preview-image');
    result.revoke();
  });
});
