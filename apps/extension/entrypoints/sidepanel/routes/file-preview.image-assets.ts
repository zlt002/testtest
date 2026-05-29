const supportedImageMimeTypes = new Map([
  ['image/png', 'png'],
  ['image/jpeg', 'jpg'],
  ['image/webp', 'webp'],
  ['image/gif', 'gif'],
]);

const MAX_MARKDOWN_IMAGE_BYTES = 10 * 1024 * 1024;

export type ImageFileLike = {
  mimeType: string;
  size: number;
};

export function validateMarkdownImageFile(file: ImageFileLike) {
  if (!supportedImageMimeTypes.has(file.mimeType)) {
    return { ok: false as const, message: '仅支持 PNG、JPEG、WEBP、GIF 图片' };
  }
  if (file.size > MAX_MARKDOWN_IMAGE_BYTES) {
    return { ok: false as const, message: '图片不能超过 10MB' };
  }
  return { ok: true as const };
}

export function imageExtensionFromMimeType(mimeType: string) {
  const extension = supportedImageMimeTypes.get(mimeType);
  if (!extension) {
    throw new Error(`Unsupported image mime type: ${mimeType}`);
  }
  return extension;
}

function splitFilePath(filePath: string) {
  const normalized = filePath.replace(/\\/g, '/');
  const slashIndex = normalized.lastIndexOf('/');
  return {
    directory: slashIndex >= 0 ? normalized.slice(0, slashIndex) : '',
    name: slashIndex >= 0 ? normalized.slice(slashIndex + 1) : normalized,
  };
}

function stripMarkdownExtension(fileName: string) {
  return fileName.replace(/\.(md|markdown)$/i, '') || 'image';
}

function formatTimestamp(now: Date) {
  const pad = (value: number) => String(value).padStart(2, '0');
  return [
    now.getFullYear(),
    pad(now.getMonth() + 1),
    pad(now.getDate()),
    '-',
    pad(now.getHours()),
    pad(now.getMinutes()),
    pad(now.getSeconds()),
  ].join('');
}

export function resolveAvailableImageAssetPath(input: {
  markdownFilePath: string;
  mimeType: string;
  now: Date;
  existingRelativePaths: ReadonlySet<string>;
}) {
  const { directory, name } = splitFilePath(input.markdownFilePath);
  const baseName = stripMarkdownExtension(name);
  const extension = imageExtensionFromMimeType(input.mimeType);
  const stem = `${baseName}-${formatTimestamp(input.now)}`;

  let suffix = 1;
  while (true) {
    const markdownPath = `assets/${stem}${suffix === 1 ? '' : `-${suffix}`}.${extension}`;
    if (!input.existingRelativePaths.has(markdownPath)) {
      return {
        filePath: directory ? `${directory}/${markdownPath}` : markdownPath,
        markdownPath,
      };
    }
    suffix += 1;
  }
}

export function buildMarkdownImageSnippet(input: { alt: string; markdownPath: string }) {
  const alt = input.alt.trim() || '图片';
  return `\n\n![${alt.replace(/[\]\n\r]/g, ' ')}](${input.markdownPath})\n\n`;
}

export function insertMarkdownImageSnippet(content: string, offset: number, snippet: string) {
  const safeOffset = Math.max(0, Math.min(offset, content.length));
  return `${content.slice(0, safeOffset)}${snippet}${content.slice(safeOffset)}`;
}

function isExternalImageUrl(value: string) {
  return /^(https?:|data:|blob:|file:|chrome-extension:|extension:)/i.test(value);
}

function joinMarkdownRelativeImagePath(markdownFilePath: string, imageSrc: string) {
  const decodedSrc = (() => {
    try {
      return decodeURI(imageSrc);
    } catch {
      return imageSrc;
    }
  })();
  const cleanSrc = decodedSrc.replace(/\\/g, '/').replace(/^\.\/+/, '');
  if (cleanSrc.startsWith('/')) {
    return cleanSrc.replace(/^\/+/, '');
  }
  const { directory } = splitFilePath(markdownFilePath);
  return directory ? `${directory}/${cleanSrc}` : cleanSrc;
}

export function buildMarkdownPreviewImageUrl(input: {
  backendBaseUrl: string;
  projectPath: string;
  markdownFilePath: string;
  imageSrc?: string;
}) {
  const imageSrc = input.imageSrc?.trim() || '';
  if (!imageSrc || isExternalImageUrl(imageSrc)) {
    return imageSrc;
  }

  const filePath = joinMarkdownRelativeImagePath(input.markdownFilePath, imageSrc);
  const params = new URLSearchParams({
    projectPath: input.projectPath,
    filePath,
  });
  return `${input.backendBaseUrl.replace(/\/+$/, '')}/api/preview/file?${params}`;
}

type MarkdownPreviewImageSourceInput = {
  backendBaseUrl: string;
  projectPath: string;
  markdownFilePath: string;
  imageSrc?: string;
};

type MarkdownPreviewImageSourceResult = {
  src: string;
  revoke: () => void;
};

type MarkdownPreviewImageSourceDeps = {
  fetch?: typeof fetch;
  createObjectURL?: (blob: Blob) => string;
  revokeObjectURL?: (url: string) => void;
};

export async function loadMarkdownPreviewImageSource(
  input: MarkdownPreviewImageSourceInput,
  deps: MarkdownPreviewImageSourceDeps = {}
): Promise<MarkdownPreviewImageSourceResult> {
  const imageSrc = input.imageSrc?.trim() || '';
  if (!imageSrc || isExternalImageUrl(imageSrc)) {
    return {
      src: imageSrc,
      revoke() {},
    };
  }

  const fetchImpl = deps.fetch ?? fetch;
  const createObjectURLImpl = deps.createObjectURL ?? URL.createObjectURL.bind(URL);
  const revokeObjectURLImpl = deps.revokeObjectURL ?? URL.revokeObjectURL.bind(URL);
  const previewUrl = buildMarkdownPreviewImageUrl(input);
  const response = await fetchImpl(previewUrl);
  if (!response.ok) {
    throw new Error(`Failed to load markdown preview image: ${response.status}`);
  }
  const blob = await response.blob();
  const objectUrl = createObjectURLImpl(blob);
  return {
    src: objectUrl,
    revoke() {
      revokeObjectURLImpl(objectUrl);
    },
  };
}

export async function fileToBase64(file: File) {
  const buffer = await file.arrayBuffer();
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary);
}
