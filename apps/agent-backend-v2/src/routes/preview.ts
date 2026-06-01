import type { IncomingMessage, ServerResponse } from 'node:http';
import { readJsonBody, sendJson } from '../http/json.ts';
import { startSse, writeSseData } from '../http/sse.ts';
import { createPreviewService } from '../preview/preview-service.ts';

function decodeAssetPath(value: string) {
  return decodeURIComponent(value).replace(/^\/+/, '');
}

export function createPreviewRoute(service = createPreviewService()) {
  return async function handlePreview(req: IncomingMessage, res: ServerResponse, url: URL) {
    if (url.pathname === '/api/preview/file') {
      if (req.method !== 'GET') {
        sendJson(res, 405, { error: 'Method not allowed' });
        return true;
      }
      const projectPath = url.searchParams.get('projectPath') || '';
      const filePath = url.searchParams.get('filePath') || '';
      const previewId = await service.createPreview(projectPath, filePath);
      res.writeHead(302, { Location: service.getAssetPath(previewId, filePath) });
      res.end();
      return true;
    }

    if (url.pathname.startsWith('/api/preview/assets/')) {
      if (req.method !== 'GET') {
        sendJson(res, 405, { error: 'Method not allowed' });
        return true;
      }
      const match = url.pathname.match(/^\/api\/preview\/assets\/([^/]+)\/(.+)$/);
      if (!match) {
        sendJson(res, 404, { error: 'Preview asset not found' });
        return true;
      }
      const [, previewId, relativePath] = match;
      const asset = await service.readAsset(previewId, decodeAssetPath(relativePath));
      res.writeHead(200, {
        'Content-Type': asset.contentType,
        'Cross-Origin-Resource-Policy': 'cross-origin',
      });
      res.end(asset.body);
      return true;
    }

    if (url.pathname === '/api/preview/resolve') {
      if (req.method !== 'GET') {
        sendJson(res, 405, { error: 'Method not allowed' });
        return true;
      }
      const previewId = url.searchParams.get('previewId') || '';
      const filePath = url.searchParams.get('filePath') || '';
      sendJson(res, 200, service.resolveAsset(previewId, filePath));
      return true;
    }

    if (url.pathname.startsWith('/api/preview/events/')) {
      if (req.method !== 'GET') {
        sendJson(res, 405, { error: 'Method not allowed' });
        return true;
      }
      const previewId = decodeURIComponent(url.pathname.slice('/api/preview/events/'.length));
      startSse(res);
      const unsubscribe = service.subscribe(previewId, (event) => {
        writeSseData(res, event);
      });
      req.on('close', unsubscribe);
      res.on('close', unsubscribe);
      return true;
    }

    if (url.pathname === '/api/preview/live') {
      if (req.method !== 'POST') {
        sendJson(res, 405, { error: 'Method not allowed' });
        return true;
      }
      sendJson(
        res,
        200,
        await service.updateLiveFile(
          await readJsonBody<{
            projectPath: string;
            entryFilePath: string;
            filePath: string;
            content: string;
            operation?: 'write' | 'edit';
            oldString?: string;
            newString?: string;
            replaceAll?: boolean;
            writeId: string;
          }>(req)
        )
      );
      return true;
    }

    if (url.pathname === '/api/preview/live/complete') {
      if (req.method !== 'POST') {
        sendJson(res, 405, { error: 'Method not allowed' });
        return true;
      }
      sendJson(
        res,
        200,
        await service.completeLiveFile(
          await readJsonBody<{
            projectPath: string;
            entryFilePath: string;
            filePath: string;
            writeId: string;
            failed?: boolean;
          }>(req)
        )
      );
      return true;
    }

    return false;
  };
}
