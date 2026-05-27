import type { IncomingMessage, ServerResponse } from 'node:http';
import { readJsonBody, sendJson } from '../http/json.ts';
import { matchPath } from '../http/router.ts';

type ServerBody = {
  name?: unknown;
  server?: Record<string, unknown>;
  projectPath?: unknown;
};

export function createMcpRoute(mcpService: {
  listServers(input?: { projectPath?: string }): Promise<unknown>;
  upsertServer(
    name: string,
    server: Record<string, unknown>,
    input?: { projectPath?: string }
  ): Promise<unknown>;
  deleteServer(name: string, input?: { projectPath?: string }): Promise<unknown>;
}) {
  return async function handleMcp(req: IncomingMessage, res: ServerResponse, url: URL | string) {
    const requestUrl = typeof url === 'string' ? new URL(url, 'http://127.0.0.1') : url;
    const pathname = requestUrl.pathname;
    const queryProjectPath = requestUrl.searchParams.get('projectPath') || undefined;
    if (req.method === 'GET' && pathname === '/api/mcp/servers') {
      sendJson(res, 200, {
        servers: await mcpService.listServers({ projectPath: queryProjectPath }),
      });
      return true;
    }

    if (req.method === 'POST' && pathname === '/api/mcp/servers') {
      const body = await readJsonBody<ServerBody>(req);
      sendJson(res, 201, {
        servers: await mcpService.upsertServer(
          typeof body.name === 'string' ? body.name : '',
          body.server || {},
          {
            projectPath: typeof body.projectPath === 'string' ? body.projectPath : queryProjectPath,
          }
        ),
      });
      return true;
    }

    const params = matchPath('/api/mcp/servers/:name', pathname);
    if (params && req.method === 'PUT') {
      const body = await readJsonBody<ServerBody>(req);
      sendJson(res, 200, {
        servers: await mcpService.upsertServer(params.name, body.server || body, {
          projectPath: typeof body.projectPath === 'string' ? body.projectPath : queryProjectPath,
        }),
      });
      return true;
    }

    if (params && req.method === 'DELETE') {
      sendJson(res, 200, {
        servers: await mcpService.deleteServer(params.name, { projectPath: queryProjectPath }),
      });
      return true;
    }

    return false;
  };
}
