import type { IncomingMessage, ServerResponse } from 'node:http';
import { readJsonBody, sendJson } from '../http/json.ts';
import { matchPath } from '../http/router.ts';

type RawBody = {
  rawJson?: unknown;
  projectPath?: unknown;
};

type EnabledBody = {
  enabled?: unknown;
  projectPath?: unknown;
};

type UpsertBody = {
  name?: unknown;
  config?: unknown;
  projectPath?: unknown;
  scope?: unknown;
};

export function createMcpRegistryRoute(mcpRegistryService: {
  listServers(input?: { projectPath?: string; forceRefresh?: boolean }): Promise<unknown>;
  upsertServer(
    name: string,
    config: unknown,
    input?: { projectPath?: string; scope?: 'project' | 'user' }
  ): Promise<unknown>;
  readRawConfig(input?: { projectPath?: string }): Promise<unknown>;
  writeRawConfig(rawJson: string, input?: { projectPath?: string }): Promise<unknown>;
  setServerEnabled(
    name: string,
    enabled: boolean,
    input?: { projectPath?: string }
  ): Promise<unknown>;
  deleteServer(
    name: string,
    input?: { projectPath?: string; scope?: 'project' | 'user' }
  ): Promise<unknown>;
  listServerTools(name: string, input?: { projectPath?: string }): Promise<unknown>;
  setToolEnabled(
    fullName: string,
    enabled: boolean,
    input?: { projectPath?: string }
  ): Promise<unknown>;
}) {
  return async function handleMcpRegistry(
    req: IncomingMessage,
    res: ServerResponse,
    url: URL | string
  ) {
    const requestUrl = typeof url === 'string' ? new URL(url, 'http://127.0.0.1') : url;
    const pathname = requestUrl.pathname;
    const queryProjectPath = requestUrl.searchParams.get('projectPath') || undefined;
    const queryScope = requestUrl.searchParams.get('scope') || undefined;
    if (req.method === 'GET' && pathname === '/api/mcp/registry') {
      const forceRefresh =
        requestUrl.searchParams.get('forceRefresh') === 'true' ||
        requestUrl.searchParams.get('refresh') === '1';
      sendJson(
        res,
        200,
        await mcpRegistryService.listServers({
          projectPath: queryProjectPath,
          ...(forceRefresh ? { forceRefresh: true } : {}),
        })
      );
      return true;
    }

    if (
      (req.method === 'POST' || req.method === 'PUT') &&
      pathname === '/api/mcp/registry/servers'
    ) {
      const body = await readJsonBody<UpsertBody>(req);
      const projectPath =
        typeof body.projectPath === 'string' ? body.projectPath : queryProjectPath;
      const scope = body.scope === 'user' || queryScope === 'user' ? 'user' : ('project' as const);
      sendJson(
        res,
        200,
        await mcpRegistryService.upsertServer(
          typeof body.name === 'string' ? body.name : '',
          body.config,
          { projectPath, scope }
        )
      );
      return true;
    }

    if (req.method === 'GET' && pathname === '/api/mcp/registry/raw') {
      sendJson(res, 200, await mcpRegistryService.readRawConfig({ projectPath: queryProjectPath }));
      return true;
    }

    if (req.method === 'PUT' && pathname === '/api/mcp/registry/raw') {
      const body = await readJsonBody<RawBody>(req);
      const projectPath =
        typeof body.projectPath === 'string' ? body.projectPath : queryProjectPath;
      sendJson(
        res,
        200,
        await mcpRegistryService.writeRawConfig(
          typeof body.rawJson === 'string' ? body.rawJson : '',
          { projectPath }
        )
      );
      return true;
    }

    const serverParams = matchPath('/api/mcp/registry/servers/:name', pathname);
    if (serverParams && req.method === 'PATCH') {
      const body = await readJsonBody<EnabledBody>(req);
      const projectPath =
        typeof body.projectPath === 'string' ? body.projectPath : queryProjectPath;
      sendJson(
        res,
        200,
        await mcpRegistryService.setServerEnabled(serverParams.name, body.enabled !== false, {
          projectPath,
        })
      );
      return true;
    }

    if (serverParams && req.method === 'DELETE') {
      const scope = queryScope === 'user' ? 'user' : ('project' as const);
      sendJson(
        res,
        200,
        await mcpRegistryService.deleteServer(serverParams.name, {
          projectPath: queryProjectPath,
          scope,
        })
      );
      return true;
    }

    const toolsParams = matchPath('/api/mcp/registry/servers/:name/tools', pathname);
    if (toolsParams && req.method === 'GET') {
      sendJson(
        res,
        200,
        await mcpRegistryService.listServerTools(toolsParams.name, {
          projectPath: queryProjectPath,
        })
      );
      return true;
    }

    const toolParams = matchPath('/api/mcp/registry/tools/:fullName', pathname);
    if (toolParams && req.method === 'PATCH') {
      const body = await readJsonBody<EnabledBody>(req);
      const projectPath =
        typeof body.projectPath === 'string' ? body.projectPath : queryProjectPath;
      sendJson(
        res,
        200,
        await mcpRegistryService.setToolEnabled(toolParams.fullName, body.enabled !== false, {
          projectPath,
        })
      );
      return true;
    }

    return false;
  };
}
