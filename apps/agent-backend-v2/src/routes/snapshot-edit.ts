import type { IncomingMessage, ServerResponse } from 'node:http';
import { readJsonBody, sendJson } from '../http/json.ts';
import type { createSnapshotEditService } from '../snapshot-edit/snapshot-edit-service.ts';

type SnapshotEditService = ReturnType<typeof createSnapshotEditService>;

export function createSnapshotEditRoute(service: SnapshotEditService) {
  return async function handleSnapshotEdit(req: IncomingMessage, res: ServerResponse, url: URL) {
    if (req.method !== 'POST' || !url.pathname.startsWith('/api/agent-v2/snapshot-edit/')) {
      return false;
    }

    if (url.pathname === '/api/agent-v2/snapshot-edit/locate-dom') {
      sendJson(
        res,
        200,
        await service.locateDom(
          await readJsonBody<{
            filePath: string;
            line: number;
            column: number;
            ancestorLimit?: number;
          }>(req)
        )
      );
      return true;
    }

    if (url.pathname === '/api/agent-v2/snapshot-edit/find-css') {
      sendJson(
        res,
        200,
        await service.findCss(await readJsonBody<{ htmlPath: string; selector: string }>(req))
      );
      return true;
    }

    if (url.pathname === '/api/agent-v2/snapshot-edit/patch-html') {
      sendJson(
        res,
        200,
        await service.patchHtml(
          await readJsonBody<Parameters<SnapshotEditService['patchHtml']>[0]>(req)
        )
      );
      return true;
    }

    if (url.pathname === '/api/agent-v2/snapshot-edit/remove-node') {
      sendJson(
        res,
        200,
        await service.removeNode(
          await readJsonBody<Parameters<SnapshotEditService['removeNode']>[0]>(req)
        )
      );
      return true;
    }

    if (url.pathname === '/api/agent-v2/snapshot-edit/remove-nodes-by-selector') {
      sendJson(
        res,
        200,
        await service.removeNodesBySelector(
          await readJsonBody<Parameters<SnapshotEditService['removeNodesBySelector']>[0]>(req)
        )
      );
      return true;
    }

    if (url.pathname === '/api/agent-v2/snapshot-edit/remove-similar-nodes') {
      sendJson(
        res,
        200,
        await service.removeSimilarNodes(
          await readJsonBody<Parameters<SnapshotEditService['removeSimilarNodes']>[0]>(req)
        )
      );
      return true;
    }

    if (url.pathname === '/api/agent-v2/snapshot-edit/replace-inner-html') {
      sendJson(
        res,
        200,
        await service.replaceInnerHtml(
          await readJsonBody<Parameters<SnapshotEditService['replaceInnerHtml']>[0]>(req)
        )
      );
      return true;
    }

    if (url.pathname === '/api/agent-v2/snapshot-edit/replace-text') {
      sendJson(
        res,
        200,
        await service.replaceText(
          await readJsonBody<Parameters<SnapshotEditService['replaceText']>[0]>(req)
        )
      );
      return true;
    }

    if (url.pathname === '/api/agent-v2/snapshot-edit/patch-css') {
      sendJson(
        res,
        200,
        await service.patchCss(
          await readJsonBody<Parameters<SnapshotEditService['patchCss']>[0]>(req)
        )
      );
      return true;
    }

    if (url.pathname === '/api/agent-v2/snapshot-edit/patch-css-batch') {
      sendJson(
        res,
        200,
        await service.patchCssBatch(
          await readJsonBody<Parameters<SnapshotEditService['patchCssBatch']>[0]>(req)
        )
      );
      return true;
    }

    return false;
  };
}
