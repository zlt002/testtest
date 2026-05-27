import type { IncomingMessage, ServerResponse } from 'node:http';
import { readJsonBody, sendJson } from '../http/json.ts';
import { HttpError } from '../shared/errors.ts';

type CatalogInvalidationHooks = {
  invalidateCapabilityCatalog?: () => void;
  invalidateCommandCatalog?: () => void;
};

type ManagedPluginRouteItem = {
  id?: string;
  enabled?: boolean;
  path?: string;
  source?: {
    kind?: string;
  };
};

export function createPluginsRoute(
  pluginService: {
    listManagedPlugins(input?: { forceRefresh?: boolean }): Promise<ManagedPluginRouteItem[]>;
    installPlugin(input: {
      source:
        | {
            kind: 'dev-local';
            directory: string;
          }
        | {
            kind: 'github';
            repoUrl: string;
          };
      scope?: 'user';
    }): Promise<unknown>;
    importPluginDirectory(input: { pluginPath: string }): Promise<unknown>;
    setManagedPluginEnabled(input: {
      id: string;
      enabled: boolean;
      sourceKind?: 'lite' | 'cli';
    }): Promise<unknown>;
    removeManagedPlugin(input: { id: string; sourceKind?: 'lite' | 'cli' }): Promise<unknown>;
  },
  invalidationHooks?: CatalogInvalidationHooks
) {
  function invalidateCatalogs() {
    invalidationHooks?.invalidateCapabilityCatalog?.();
    invalidationHooks?.invalidateCommandCatalog?.();
  }

  function parseInstallSource(source: unknown) {
    if (!source || typeof source !== 'object') {
      throw new HttpError(
        400,
        "Plugin install source must be an object with kind 'github' or 'dev-local'.",
        'invalid_plugin_install_source'
      );
    }

    const rawSource = source as Record<string, unknown>;
    const kind = rawSource.kind;
    if (kind === 'github') {
      if (typeof rawSource.repoUrl !== 'string' || rawSource.repoUrl.length === 0) {
        throw new HttpError(
          400,
          "GitHub plugin installs require a repoUrl string.",
          'invalid_plugin_install_source'
        );
      }
      return {
        kind: 'github' as const,
        repoUrl: rawSource.repoUrl,
      };
    }

    if (kind === 'dev-local') {
      if (typeof rawSource.directory !== 'string' || rawSource.directory.length === 0) {
        throw new HttpError(
          400,
          "Dev-local plugin installs require a directory string.",
          'invalid_plugin_install_source'
        );
      }
      return {
        kind: 'dev-local' as const,
        directory: rawSource.directory,
      };
    }

    if (typeof kind === 'string') {
      throw new HttpError(
        400,
        `Unsupported plugin install source.kind: ${kind}.`,
        'invalid_plugin_install_source'
      );
    }

    throw new HttpError(
      400,
      "Plugin install source.kind must be 'github' or 'dev-local'.",
      'invalid_plugin_install_source'
    );
  }

  return async function handlePlugins(req: IncomingMessage, res: ServerResponse, url: URL) {
    if (url.pathname === '/api/agent-v2/plugins' && req.method === 'GET') {
      const forceRefresh =
        url.searchParams.get('forceRefresh') === 'true' || url.searchParams.get('refresh') === '1';
      sendJson(res, 200, {
        success: true,
        plugins: await pluginService.listManagedPlugins(
          forceRefresh ? { forceRefresh: true } : undefined
        ),
      });
      return true;
    }

    if (url.pathname === '/api/agent-v2/plugins/import-directory' && req.method === 'POST') {
      const body = await readJsonBody<Record<string, unknown>>(req);
      const pluginPath =
        typeof body.path === 'string'
          ? body.path
          : typeof body.pluginPath === 'string'
            ? body.pluginPath
            : '';
      const plugin = await pluginService.importPluginDirectory({ pluginPath });
      invalidateCatalogs();
      sendJson(res, 200, {
        success: true,
        plugin,
      });
      return true;
    }

    if (url.pathname === '/api/agent-v2/plugins/install' && req.method === 'POST') {
      const body = await readJsonBody<Record<string, unknown>>(req);
      const plugin = await pluginService.installPlugin({
        source: parseInstallSource(body.source),
        scope: body.scope === 'user' ? 'user' : 'user',
      });
      invalidateCatalogs();
      sendJson(res, 200, {
        success: true,
        plugin,
      });
      return true;
    }

    const pluginMatch = url.pathname.match(/^\/api\/agent-v2\/plugins\/(.+)$/);
    if (!pluginMatch) {
      return false;
    }

    const id = decodeURIComponent(pluginMatch[1]);
    if (req.method === 'PATCH') {
      const body = await readJsonBody<Record<string, unknown>>(req);
      const plugin = await pluginService.setManagedPluginEnabled({
        id,
        enabled: Boolean(body.enabled),
        sourceKind:
          body.sourceKind === 'cli' || body.sourceKind === 'lite' ? body.sourceKind : undefined,
      });
      invalidateCatalogs();
      sendJson(res, 200, {
        success: true,
        plugin,
      });
      return true;
    }

    if (req.method === 'DELETE') {
      const sourceKind = url.searchParams.get('sourceKind');
      const result = await pluginService.removeManagedPlugin({
        id,
        sourceKind: sourceKind === 'cli' || sourceKind === 'lite' ? sourceKind : undefined,
      });
      invalidateCatalogs();
      sendJson(res, 200, {
        success: true,
        result,
      });
      return true;
    }

    return false;
  };
}
