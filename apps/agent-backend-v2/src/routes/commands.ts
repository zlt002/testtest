import type { IncomingMessage, ServerResponse } from 'node:http';
import { readJsonBody, sendJson } from '../http/json.ts';

type ListCommandsBody = {
  projectPath?: unknown;
  forceRefresh?: unknown;
};

type ExecuteCommandBody = {
  commandName?: unknown;
  commandPath?: unknown;
  args?: unknown;
  context?: unknown;
};

type PluginCommandSource = {
  id?: string;
  path: string;
  enabled?: boolean;
  sourceKind?: string;
};

function recordValue(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

export function createCommandsRoute(
  commandsService: {
    listCommands(input: {
      projectPath?: string;
      pluginPaths?: string[];
      pluginSources?: PluginCommandSource[];
      forceRefresh?: boolean;
    }): Promise<unknown>;
    executeCommand(input: {
      commandName: string;
      commandPath?: string;
      args?: string[];
      context?: { projectPath?: string };
    }): Promise<unknown>;
    invalidateCache?: () => void;
  },
  pluginManagementService?: {
    listManagedPlugins(input?: {
      forceRefresh?: boolean;
    }): Promise<
      Array<{ id?: string; enabled?: boolean; path?: string; source?: { kind?: string } }>
    >;
  }
) {
  return async function handleCommands(
    req: IncomingMessage,
    res: ServerResponse,
    pathname: string
  ) {
    if (req.method === 'POST' && pathname === '/api/agent-v2/commands/list') {
      const body = await readJsonBody<ListCommandsBody>(req);
      const pluginSources = pluginManagementService
        ? (
            await pluginManagementService.listManagedPlugins(
              body.forceRefresh === true ? { forceRefresh: true } : undefined
            )
          )
            .filter(
              (plugin) => plugin.enabled && typeof plugin.path === 'string' && plugin.path.trim()
            )
            .map((plugin) => ({
              id: plugin.id,
              path: plugin.path as string,
              enabled: plugin.enabled,
              sourceKind: plugin.source?.kind,
            }))
        : [];
      sendJson(
        res,
        200,
        await commandsService.listCommands({
          projectPath: typeof body.projectPath === 'string' ? body.projectPath : undefined,
          pluginPaths: pluginSources.map((plugin) => plugin.path),
          pluginSources,
          ...(body.forceRefresh === true ? { forceRefresh: true } : {}),
        })
      );
      return true;
    }

    if (req.method === 'POST' && pathname === '/api/agent-v2/commands/execute') {
      const body = await readJsonBody<ExecuteCommandBody>(req);
      const context = recordValue(body.context);
      sendJson(
        res,
        200,
        await commandsService.executeCommand({
          commandName: typeof body.commandName === 'string' ? body.commandName : '',
          commandPath: typeof body.commandPath === 'string' ? body.commandPath : undefined,
          args: Array.isArray(body.args)
            ? body.args.filter((arg): arg is string => typeof arg === 'string')
            : [],
          context: {
            projectPath:
              context && typeof context.projectPath === 'string' ? context.projectPath : undefined,
          },
        })
      );
      return true;
    }

    return false;
  };
}
