export type PageEditFileWriter = {
  writeFile(input: { projectPath: string; filePath: string; content: string }): Promise<void>;
};

export function fileUrlToLocalPath(pageUrl: string): string {
  const decoded = decodeURIComponent(pageUrl.replace(/^file:\/\//, ''));
  return decoded.replace(/^\/([A-Za-z]:\/)/, '$1');
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
  };
}

export async function savePageEditHtmlToFile(
  client: PageEditFileWriter,
  input: {
    projectPath: string;
    pageUrl: string;
    html: string;
  }
) {
  const filePath = fileUrlToLocalPath(input.pageUrl);

  await client.writeFile({
    projectPath: input.projectPath,
    filePath,
    content: input.html,
  });
}
