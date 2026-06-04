import type { IncomingMessage, ServerResponse } from 'node:http';
import { readJsonBody, sendJson } from '../http/json.ts';

export function createFilesRoute(fileService: {
  listTree(input: {
    projectPath: string;
    dirPath?: string;
    maxDepth?: number;
    includeMetadata?: boolean;
  }): Promise<unknown>;
  readTextFile(input: { projectPath: string; filePath: string }): Promise<unknown>;
  writeTextFile(input: {
    projectPath: string;
    filePath: string;
    content: string;
  }): Promise<unknown>;
  writeBinaryFile?(input: {
    projectPath: string;
    filePath: string;
    dataBase64: string;
  }): Promise<unknown>;
  createEntry?(input: {
    projectPath: string;
    parentPath?: string;
    type: 'file' | 'directory';
    name: string;
  }): Promise<unknown>;
  renameEntry?(input: {
    projectPath: string;
    entryPath: string;
    newName: string;
  }): Promise<unknown>;
  deleteEntry?(input: { projectPath: string; entryPath: string }): Promise<unknown>;
  openEntry?(input: { projectPath: string; entryPath?: string }): Promise<unknown>;
}) {
  return async function handleFiles(req: IncomingMessage, res: ServerResponse, url: URL) {
    if (req.method === 'GET' && url.pathname === '/api/files/tree') {
      const startedAt = performance.now();
      const projectPath = url.searchParams.get('projectPath') || '';
      const dirPath = url.searchParams.get('dirPath') || undefined;
      const maxDepth = Number(url.searchParams.get('maxDepth') || 0);
      const includeMetadata = url.searchParams.get('includeMetadata') === 'true';
      sendJson(
        res,
        200,
        await fileService.listTree({
          projectPath,
          dirPath,
          maxDepth,
          includeMetadata,
        })
      );
      const totalMs = performance.now() - startedAt;
      if (totalMs >= 250) {
        console.info(
          `[perf][route.files.tree] total=${totalMs.toFixed(1)}ms project=${projectPath} dir=${dirPath || '.'} maxDepth=${maxDepth} includeMetadata=${includeMetadata}`
        );
      }
      return true;
    }

    if (req.method === 'GET' && url.pathname === '/api/files/content') {
      sendJson(
        res,
        200,
        await fileService.readTextFile({
          projectPath: url.searchParams.get('projectPath') || '',
          filePath: url.searchParams.get('filePath') || '',
        })
      );
      return true;
    }

    if (req.method === 'POST' && url.pathname === '/api/files/content') {
      sendJson(res, 200, await fileService.writeTextFile(await readJsonBody(req)));
      return true;
    }

    if (req.method === 'POST' && url.pathname === '/api/files/binary-content') {
      if (!fileService.writeBinaryFile) {
        throw new Error('Binary file service is not configured');
      }
      sendJson(res, 200, await fileService.writeBinaryFile(await readJsonBody(req)));
      return true;
    }

    if (req.method === 'POST' && url.pathname === '/api/files/entries') {
      if (!fileService.createEntry) {
        throw new Error('File entry service is not configured');
      }
      const body = await readJsonBody<{
        projectPath?: string;
        parentPath?: string;
        type?: string;
        name?: string;
      }>(req);
      sendJson(
        res,
        200,
        await fileService.createEntry({
          projectPath: body.projectPath || '',
          parentPath: body.parentPath,
          type: body.type === 'directory' ? 'directory' : 'file',
          name: body.name || '',
        })
      );
      return true;
    }

    if (req.method === 'PATCH' && url.pathname === '/api/files/entries') {
      if (!fileService.renameEntry) {
        throw new Error('File entry service is not configured');
      }
      const body = await readJsonBody<{
        projectPath?: string;
        entryPath?: string;
        newName?: string;
      }>(req);
      sendJson(
        res,
        200,
        await fileService.renameEntry({
          projectPath: body.projectPath || '',
          entryPath: body.entryPath || '',
          newName: body.newName || '',
        })
      );
      return true;
    }

    if (req.method === 'DELETE' && url.pathname === '/api/files/entries') {
      if (!fileService.deleteEntry) {
        throw new Error('File entry service is not configured');
      }
      sendJson(
        res,
        200,
        await fileService.deleteEntry({
          projectPath: url.searchParams.get('projectPath') || '',
          entryPath: url.searchParams.get('entryPath') || '',
        })
      );
      return true;
    }

    if (req.method === 'POST' && url.pathname === '/api/files/open') {
      if (!fileService.openEntry) {
        throw new Error('File entry service is not configured');
      }
      const body = await readJsonBody<{ projectPath?: string; entryPath?: string }>(req);
      sendJson(
        res,
        200,
        await fileService.openEntry({
          projectPath: body.projectPath || '',
          entryPath: body.entryPath,
        })
      );
      return true;
    }

    return false;
  };
}
