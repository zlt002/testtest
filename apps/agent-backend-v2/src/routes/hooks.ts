import type { IncomingMessage, ServerResponse } from 'node:http';
import { sendJson } from '../http/json.ts';

export function createHooksRoute(hooksService: {
  getHooksOverview(input: { projectPath?: string; forceRefresh?: boolean }): Promise<unknown>;
}) {
  return async function handleHooks(req: IncomingMessage, res: ServerResponse, url: URL) {
    if (url.pathname === '/api/agent-v2/hooks/overview' && req.method === 'GET') {
      const forceRefresh =
        url.searchParams.get('forceRefresh') === 'true' || url.searchParams.get('refresh') === '1';
      sendJson(
        res,
        200,
        await hooksService.getHooksOverview({
          projectPath: url.searchParams.get('projectPath') || undefined,
          ...(forceRefresh ? { forceRefresh: true } : {}),
        })
      );
      return true;
    }

    return false;
  };
}
