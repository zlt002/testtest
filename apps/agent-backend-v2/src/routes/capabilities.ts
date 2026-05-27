import type { IncomingMessage, ServerResponse } from 'node:http';
import { readJsonBody, sendJson } from '../http/json.ts';
import type { AgentBackendV2Capabilities } from '../providers/types.ts';
import { HttpError } from '../shared/errors.ts';

type PluginCapabilitySource = {
  id?: string;
  path: string;
  enabled?: boolean;
  sourceKind?: string;
};

type CatalogInvalidationHooks = {
  invalidateCommandCatalog?: () => void;
};

function decodeCapabilityRouteComponent(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch (error) {
    if (error instanceof URIError) {
      throw new HttpError(
        400,
        'Capability route contains invalid URL encoding.',
        'invalid_capability_route_encoding'
      );
    }
    throw error;
  }
}

export function createCapabilitiesRoute(
  capabilitiesService: {
    getCapabilities(): AgentBackendV2Capabilities;
  },
  capabilityCatalogService?: {
    listCapabilities(input: {
      type?: string;
      projectPath?: string;
      pluginPaths?: string[];
      pluginSources?: PluginCapabilitySource[];
      forceRefresh?: boolean;
    }): Promise<unknown>;
    readCapability(input: {
      id: string;
      projectPath?: string;
      pluginPaths?: string[];
      pluginSources?: PluginCapabilitySource[];
    }): Promise<Record<string, unknown>>;
    readCapabilityFile(input: {
      id: string;
      projectPath?: string;
      pluginPaths?: string[];
      pluginSources?: PluginCapabilitySource[];
      path?: string;
    }): Promise<Record<string, unknown>>;
    createCapability(input: {
      type?: string;
      scope?: string;
      projectPath?: string;
      name?: string;
      content?: string;
    }): Promise<unknown>;
    importSkillDirectory(input: {
      scope?: string;
      projectPath?: string;
      sourceDir?: string;
    }): Promise<unknown>;
    importSkillBundle(input: {
      scope?: string;
      projectPath?: string;
      name?: string;
      files?: Array<{ path: string; contentBase64: string }>;
    }): Promise<unknown>;
    updateCapability(input: {
      id: string;
      projectPath?: string;
      content?: string;
    }): Promise<unknown>;
    updateCapabilityFile(input: {
      id: string;
      projectPath?: string;
      path?: string;
      content?: string;
    }): Promise<Record<string, unknown>>;
    setCapabilityEnabled(input: {
      id: string;
      projectPath?: string;
      enabled?: boolean;
    }): Promise<unknown>;
    deleteCapability(input: { id: string; projectPath?: string }): Promise<unknown>;
  },
  pluginManagementService?: {
    listManagedPlugins(): Promise<
      Array<{ id?: string; enabled?: boolean; path?: string; source?: { kind?: string } }>
    >;
  },
  invalidationHooks?: CatalogInvalidationHooks
) {
  return async function handleCapabilities(
    req: IncomingMessage,
    res: ServerResponse,
    url: URL | string
  ) {
    const parsedUrl = typeof url === 'string' ? new URL(url, 'http://127.0.0.1') : url;
    const pathname = parsedUrl.pathname;
    if (req.method === 'GET' && pathname === '/api/capabilities') {
      sendJson(res, 200, capabilitiesService.getCapabilities());
      return true;
    }

    if (capabilityCatalogService && pathname === '/api/agent-v2/capabilities') {
      if (req.method === 'GET') {
        const forceRefresh =
          parsedUrl.searchParams.get('forceRefresh') === 'true' ||
          parsedUrl.searchParams.get('refresh') === '1';
        const pluginSources = pluginManagementService
          ? (await pluginManagementService.listManagedPlugins())
              .filter((plugin) => typeof plugin.path === 'string' && plugin.path.trim())
              .map((plugin) => ({
                id: plugin.id,
                path: plugin.path as string,
                enabled: plugin.enabled,
                sourceKind: plugin.source?.kind,
              }))
          : [];
        sendJson(res, 200, {
          success: true,
          capabilities: await capabilityCatalogService.listCapabilities({
            type: parsedUrl.searchParams.get('type') || undefined,
            projectPath: parsedUrl.searchParams.get('projectPath') || undefined,
            pluginPaths: pluginSources.map((plugin) => plugin.path),
            pluginSources,
            ...(forceRefresh ? { forceRefresh: true } : {}),
          }),
        });
        return true;
      }

      if (req.method === 'POST') {
        const body = await readJsonBody<Record<string, unknown>>(req);
        const capability = await capabilityCatalogService.createCapability({
          type: typeof body.type === 'string' ? body.type : undefined,
          scope: typeof body.scope === 'string' ? body.scope : undefined,
          projectPath: typeof body.projectPath === 'string' ? body.projectPath : undefined,
          name: typeof body.name === 'string' ? body.name : undefined,
          content: typeof body.content === 'string' ? body.content : undefined,
        });
        invalidationHooks?.invalidateCommandCatalog?.();
        sendJson(res, 200, {
          success: true,
          capability,
        });
        return true;
      }
    }

    if (
      capabilityCatalogService &&
      req.method === 'POST' &&
      pathname === '/api/agent-v2/capabilities/import-skill-directory'
    ) {
      const body = await readJsonBody<Record<string, unknown>>(req);
      const files = Array.isArray(body.files)
        ? body.files
            .filter((entry): entry is { path: string; contentBase64: string } => {
              return (
                Boolean(entry) &&
                typeof entry === 'object' &&
                typeof (entry as { path?: unknown }).path === 'string' &&
                typeof (entry as { contentBase64?: unknown }).contentBase64 === 'string'
              );
            })
            .map((entry) => ({
              path: entry.path,
              contentBase64: entry.contentBase64,
            }))
        : undefined;
      const capability = files?.length
        ? await capabilityCatalogService.importSkillBundle({
            scope: typeof body.scope === 'string' ? body.scope : undefined,
            projectPath: typeof body.projectPath === 'string' ? body.projectPath : undefined,
            name: typeof body.name === 'string' ? body.name : undefined,
            files,
          })
        : await capabilityCatalogService.importSkillDirectory({
            scope: typeof body.scope === 'string' ? body.scope : undefined,
            projectPath: typeof body.projectPath === 'string' ? body.projectPath : undefined,
            sourceDir: typeof body.sourceDir === 'string' ? body.sourceDir : undefined,
          });
      invalidationHooks?.invalidateCommandCatalog?.();
      sendJson(res, 200, {
        success: true,
        capability,
      });
      return true;
    }

    const capabilityFileMatch = pathname.match(/^\/api\/agent-v2\/capabilities\/(.+)\/files\/(.+)$/);
    if (capabilityCatalogService && capabilityFileMatch) {
      const id = decodeCapabilityRouteComponent(capabilityFileMatch[1]);
      const path = decodeCapabilityRouteComponent(capabilityFileMatch[2]);
      if (req.method === 'GET') {
        const pluginSources = pluginManagementService
          ? (await pluginManagementService.listManagedPlugins())
              .filter((plugin) => typeof plugin.path === 'string' && plugin.path.trim())
              .map((plugin) => ({
                id: plugin.id,
                path: plugin.path as string,
                enabled: plugin.enabled,
                sourceKind: plugin.source?.kind,
              }))
          : [];
        sendJson(res, 200, {
          success: true,
          ...(await capabilityCatalogService.readCapabilityFile({
            id,
            path,
            projectPath: parsedUrl.searchParams.get('projectPath') || undefined,
            pluginPaths: pluginSources.map((plugin) => plugin.path),
            pluginSources,
          })),
        });
        return true;
      }

      if (req.method === 'PATCH') {
        const body = await readJsonBody<Record<string, unknown>>(req);
        sendJson(res, 200, {
          success: true,
          ...(await capabilityCatalogService.updateCapabilityFile({
            id,
            path,
            projectPath:
              typeof body.projectPath === 'string'
                ? body.projectPath
                : parsedUrl.searchParams.get('projectPath') || undefined,
            content: typeof body.content === 'string' ? body.content : undefined,
          })),
        });
        return true;
      }
    }

    const capabilityMatch = pathname.match(/^\/api\/agent-v2\/capabilities\/(.+)$/);
    if (capabilityCatalogService && capabilityMatch) {
      const id = decodeCapabilityRouteComponent(capabilityMatch[1]);
      if (req.method === 'GET') {
        const pluginSources = pluginManagementService
          ? (await pluginManagementService.listManagedPlugins())
              .filter((plugin) => typeof plugin.path === 'string' && plugin.path.trim())
              .map((plugin) => ({
                id: plugin.id,
                path: plugin.path as string,
                enabled: plugin.enabled,
                sourceKind: plugin.source?.kind,
              }))
          : [];
        sendJson(res, 200, {
          success: true,
          ...(await capabilityCatalogService.readCapability({
            id,
            projectPath: parsedUrl.searchParams.get('projectPath') || undefined,
            pluginPaths: pluginSources.map((plugin) => plugin.path),
            pluginSources,
          })),
        });
        return true;
      }

      if (req.method === 'PATCH') {
        const body = await readJsonBody<Record<string, unknown>>(req);
        if (typeof body.enabled === 'boolean' && typeof body.content !== 'string') {
          const capability = await capabilityCatalogService.setCapabilityEnabled({
            id,
            projectPath:
              typeof body.projectPath === 'string'
                ? body.projectPath
                : parsedUrl.searchParams.get('projectPath') || undefined,
            enabled: body.enabled,
          });
          invalidationHooks?.invalidateCommandCatalog?.();
          sendJson(res, 200, {
            success: true,
            capability,
          });
          return true;
        }
        const capability = await capabilityCatalogService.updateCapability({
          id,
          projectPath:
            typeof body.projectPath === 'string'
              ? body.projectPath
              : parsedUrl.searchParams.get('projectPath') || undefined,
          content: typeof body.content === 'string' ? body.content : undefined,
        });
        invalidationHooks?.invalidateCommandCatalog?.();
        sendJson(res, 200, {
          success: true,
          capability,
        });
        return true;
      }

      if (req.method === 'DELETE') {
        const result = await capabilityCatalogService.deleteCapability({
          id,
          projectPath: parsedUrl.searchParams.get('projectPath') || undefined,
        });
        invalidationHooks?.invalidateCommandCatalog?.();
        sendJson(res, 200, {
          success: true,
          result,
        });
        return true;
      }
    }

    return false;
  };
}
