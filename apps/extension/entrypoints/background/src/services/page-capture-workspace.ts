import { buildSnapshotManifest } from './page-workbench-capture';
import type { ElementAnnotation, SelectionTarget, AnnotationPageType } from './page-annotations';
import type { PageCaptureArtifact, PageCaptureAsset } from './page-capture-types';

export type PageCaptureWorkspaceClient = {
  createEntry(input: {
    projectPath: string;
    parentPath?: string;
    type: 'file' | 'directory';
    name: string;
  }): Promise<unknown>;
  writeFile(input: { projectPath: string; filePath: string; content: string }): Promise<void>;
};

export type SavedPageCapture = {
  entryPath: string;
  projectPath: string;
  assetCount: number;
  warningCount: number;
};

export type CaptureWorkbenchMetadata = {
  sourcePageUrl?: string;
  sourcePageType?: AnnotationPageType | null;
  parentCaptureId?: string | null;
  targets?: SelectionTarget[];
  annotations?: ElementAnnotation[];
};

function slugify(value: string): string {
  const normalized = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fa5]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return normalized || 'untitled-capture';
}

function buildCaptureSlug(artifact: PageCaptureArtifact): string {
  const capturedAt = new Date(artifact.capturedAt);
  const timestamp = Number.isNaN(capturedAt.getTime())
    ? 'unknown-time'
    : capturedAt
        .toISOString()
        .replace(/[-:]/g, '')
        .replace(/\.\d{3}Z$/, 'Z');
  return `${timestamp}-${slugify(artifact.title)}`;
}

async function ensureDirectory(
  client: PageCaptureWorkspaceClient,
  input: {
    projectPath: string;
    parentPath?: string;
    name: string;
  }
) {
  try {
    await client.createEntry({
      projectPath: input.projectPath,
      parentPath: input.parentPath,
      type: 'directory',
      name: input.name,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (!message.includes('409') && !message.includes('already exists')) {
      throw error;
    }
  }
}

function isTextLikeAsset(asset: PageCaptureAsset): boolean {
  if (!asset.mimeType) {
    return /\.([cm]?js|css|html?|json|svg|txt|xml)$/i.test(asset.relativePath);
  }

  return (
    asset.mimeType.startsWith('text/') ||
    asset.mimeType.includes('json') ||
    asset.mimeType.includes('xml') ||
    asset.mimeType.includes('javascript') ||
    asset.mimeType.includes('svg')
  );
}

function splitPath(path: string): string[] {
  return path
    .split('/')
    .map((segment) => segment.trim())
    .filter(Boolean);
}

async function ensureRelativeDirectoryTree(
  client: PageCaptureWorkspaceClient,
  input: {
    projectPath: string;
    root: string;
    relativeFilePath: string;
  }
) {
  const segments = splitPath(input.relativeFilePath);
  if (segments.length <= 1) {
    return;
  }

  let parentPath = input.root;
  for (const segment of segments.slice(0, -1)) {
    await ensureDirectory(client, {
      projectPath: input.projectPath,
      parentPath,
      name: segment,
    });
    parentPath = `${parentPath}/${segment}`;
  }
}

function decodeAssetToUtf8(asset: PageCaptureAsset): string | null {
  if (!asset.contentBase64 || !isTextLikeAsset(asset)) {
    return null;
  }

  try {
    if (typeof atob === 'function') {
      const binary = atob(asset.contentBase64);
      const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
      return new TextDecoder().decode(bytes);
    }

    return Buffer.from(asset.contentBase64, 'base64').toString('utf8');
  } catch {
    return null;
  }
}

function getUtf8ByteLength(value: string): number {
  if (typeof Blob === 'function') {
    return new Blob([value]).size;
  }

  return Buffer.from(value, 'utf8').byteLength;
}

export async function saveCaptureToWorkspace(
  agentClient: PageCaptureWorkspaceClient,
  projectPath: string,
  artifact: PageCaptureArtifact,
  workbench?: CaptureWorkbenchMetadata
): Promise<SavedPageCapture> {
  const slug = buildCaptureSlug(artifact);
  const root = `captures/${slug}`;
  const writtenAssets: string[] = [];
  const styles = artifact.styles || [];

  await ensureDirectory(agentClient, { projectPath, parentPath: '', name: 'captures' });
  await ensureDirectory(agentClient, { projectPath, parentPath: 'captures', name: slug });
  if (artifact.assets.length > 0) {
    await ensureDirectory(agentClient, { projectPath, parentPath: root, name: 'assets' });
  }

  await agentClient.writeFile({
    projectPath,
    filePath: `${root}/index.html`,
    content: artifact.html,
  });

  for (const style of styles) {
    const relativeFilePath = style.path.replace(/^\/+/, '');
    await ensureRelativeDirectoryTree(agentClient, {
      projectPath,
      root,
      relativeFilePath,
    });

    await agentClient.writeFile({
      projectPath,
      filePath: `${root}/${relativeFilePath}`,
      content: style.content,
    });
  }

  for (const asset of artifact.assets) {
    const decoded = decodeAssetToUtf8(asset);
    if (decoded === null) {
      continue;
    }

    const relativeFilePath = asset.relativePath.replace(/^\/+/, '');
    await ensureRelativeDirectoryTree(agentClient, {
      projectPath,
      root,
      relativeFilePath,
    });

    await agentClient.writeFile({
      projectPath,
      filePath: `${root}/${relativeFilePath}`,
      content: decoded,
    });
    writtenAssets.push(asset.relativePath);
  }

  await agentClient.writeFile({
    projectPath,
    filePath: `${root}/capture.meta.json`,
    content: JSON.stringify(
      {
        url: artifact.url,
        title: artifact.title,
        capturedAt: artifact.capturedAt,
        mode: artifact.mode,
        metadata: artifact.metadata,
        warnings: artifact.warnings,
        styles: styles.map((style) => ({
          path: style.path,
          bytes: getUtf8ByteLength(style.content),
        })),
        assets: artifact.assets.map((asset) => ({
          id: asset.id,
          kind: asset.kind,
          sourceUrl: asset.sourceUrl,
          mimeType: asset.mimeType,
          relativePath: asset.relativePath,
          inlineCandidate: asset.inlineCandidate,
          warning: asset.warning,
          persisted: writtenAssets.includes(asset.relativePath),
        })),
      },
      null,
      2
    ),
  });

  await agentClient.writeFile({
    projectPath,
    filePath: `${root}/capture.manifest.json`,
    content: JSON.stringify(
      buildSnapshotManifest({
        captureId: slug,
        entryPath: root,
        artifact,
        sourcePageUrl: workbench?.sourcePageUrl,
        sourcePageType: workbench?.sourcePageType,
        parentCaptureId: workbench?.parentCaptureId,
        targets: workbench?.targets,
        annotations: workbench?.annotations,
      }),
      null,
      2
    ),
  });

  return {
    entryPath: root,
    projectPath,
    assetCount: writtenAssets.length,
    warningCount: artifact.warnings.length,
  };
}
