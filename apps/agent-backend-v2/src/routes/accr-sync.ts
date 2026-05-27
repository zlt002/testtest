import type { IncomingMessage, ServerResponse } from 'node:http';
import { readJsonBody, sendJson } from '../http/json.ts';
import type { AccrSyncMode, AccrSyncResult } from '../accr-sync/accr-sync-service.ts';

type AccrSyncService = {
  run(input: { mode: AccrSyncMode; force?: boolean }): Promise<AccrSyncResult>;
};

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function resolveModeFromBody(body: Record<string, unknown>): AccrSyncMode | null {
  if ('mode' in body) {
    return body.mode === 'remote' || body.mode === 'local-debug' ? body.mode : null;
  }

  return null;
}

export function createAccrSyncRoute(service: AccrSyncService) {
  return async function handleAccrSync(req: IncomingMessage, res: ServerResponse, url: URL) {
    if (url.pathname !== '/api/accr-sync/run') {
      return false;
    }

    if (req.method !== 'POST') {
      sendJson(res, 405, { ok: false, error: 'Method not allowed' });
      return true;
    }

    let parsedBody: unknown;
    try {
      parsedBody = await readJsonBody<unknown>(req);
    } catch (error) {
      if (error instanceof SyntaxError) {
        sendJson(res, 400, { ok: false, error: 'Invalid JSON body' });
        return true;
      }
      throw error;
    }

    if (!isPlainObject(parsedBody)) {
      sendJson(res, 400, { ok: false, error: 'Invalid request body' });
      return true;
    }

    const mode = resolveModeFromBody(parsedBody);

    if ('mode' in parsedBody && mode === null) {
      sendJson(res, 400, { ok: false, error: 'Invalid mode' });
      return true;
    }

    if (mode === null) {
      sendJson(res, 400, { ok: false, error: 'Invalid request body' });
      return true;
    }

    const force = parsedBody.force === true;
    const result = await service.run({ mode, force });
    sendJson(res, 200, result);
    return true;
  };
}
