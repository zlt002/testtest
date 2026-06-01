export type PageEditFileWriter = {
  writeFile(input: { projectPath: string; filePath: string; content: string }): Promise<void>;
  resolvePreviewAsset?(input: { previewId: string; filePath: string }): Promise<{
    projectPath: string;
    filePath: string;
  }>;
};

export function fileUrlToLocalPath(pageUrl: string): string {
  const decoded = decodeURIComponent(pageUrl.replace(/^file:\/\//, ''));
  return decoded.replace(/^\/([A-Za-z]:\/)/, '$1');
}

export function parsePreviewAssetUrl(pageUrl: string): { previewId: string; filePath: string } | null {
  try {
    const parsed = new URL(pageUrl);
    if (!/^https?:$/i.test(parsed.protocol)) {
      return null;
    }

    const match = parsed.pathname.match(/^\/api\/preview\/assets\/([^/]+)\/(.+)$/);
    if (!match) {
      return null;
    }

    return {
      previewId: decodeURIComponent(match[1]),
      filePath: decodeURIComponent(match[2]),
    };
  } catch {
    return null;
  }
}

export function createPageEditFileSaveClient(agentBaseUrl: string): PageEditFileWriter {
  return {
    async writeFile(input) {
      const response = await fetch(`${agentBaseUrl}/api/files/content`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(input),
      });

      if (!response.ok) {
        throw new Error(`Failed to write file: ${response.status}`);
      }
    },
    async resolvePreviewAsset(input) {
      const url = new URL('/api/preview/resolve', agentBaseUrl);
      url.searchParams.set('previewId', input.previewId);
      url.searchParams.set('filePath', input.filePath);

      const response = await fetch(url.toString());
      if (!response.ok) {
        throw new Error(`Failed to resolve preview asset: ${response.status}`);
      }

      const payload = (await response.json()) as {
        projectPath?: unknown;
        filePath?: unknown;
      };
      if (typeof payload.projectPath !== 'string' || typeof payload.filePath !== 'string') {
        throw new Error('Failed to resolve preview asset: invalid payload');
      }

      return {
        projectPath: payload.projectPath,
        filePath: payload.filePath,
      };
    },
  };
}

export async function savePageEditHtmlToFile(
  client: PageEditFileWriter,
  input: {
    projectPath?: string;
    pageUrl: string;
    html: string;
  }
) {
  const previewAsset = parsePreviewAssetUrl(input.pageUrl);
  if (previewAsset) {
    if (typeof client.resolvePreviewAsset !== 'function') {
      throw new Error('Failed to resolve preview asset: unsupported client');
    }

    const resolved = await client.resolvePreviewAsset(previewAsset);
    await client.writeFile({
      projectPath: resolved.projectPath,
      filePath: resolved.filePath,
      content: input.html,
    });
    return;
  }

  const filePath = fileUrlToLocalPath(input.pageUrl);
  const inferredProjectPath = filePath.replace(/\/[^/]+$/, '') || '/';
  const projectPath = input.projectPath ?? inferredProjectPath;

  await client.writeFile({
    projectPath,
    filePath,
    content: input.html,
  });
}
