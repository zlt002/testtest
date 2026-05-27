import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';

type McpServerOverridesFile = {
  disabledServers?: string[];
};

export type McpServerOverrides = {
  disabledServers: string[];
};

function normalizeList(value: unknown): string[] {
  return Array.isArray(value)
    ? [
        ...new Set(
          value.filter((item): item is string => typeof item === 'string' && Boolean(item.trim()))
        ),
      ]
    : [];
}

export function resolveMcpProjectScope(options: {
  configPath: string;
  permissionsPath?: string;
  projectPath?: string;
}, projectPath?: string) {
  const trimmed = projectPath?.trim();
  if (trimmed) {
    const resolvedProjectPath = resolve(trimmed);
    return {
      projectPath: resolvedProjectPath,
      configPath: join(resolvedProjectPath, '.mcp.json'),
      permissionsPath: join(resolvedProjectPath, '.webmcp', 'mcp-tool-permissions.json'),
      overridesPath: join(resolvedProjectPath, '.webmcp', 'mcp-server-overrides.json'),
    };
  }

  const baseProjectPath = options.projectPath || dirname(options.configPath);
  return {
    projectPath: baseProjectPath,
    configPath: options.configPath,
    permissionsPath:
      options.permissionsPath || join(baseProjectPath, '.webmcp', 'mcp-tool-permissions.json'),
    overridesPath: join(baseProjectPath, '.webmcp', 'mcp-server-overrides.json'),
  };
}

export async function readMcpServerOverrides(
  filePath: string
): Promise<McpServerOverrides> {
  try {
    const payload = JSON.parse(await readFile(filePath, 'utf8')) as McpServerOverridesFile;
    return {
      disabledServers: normalizeList(payload.disabledServers),
    };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return { disabledServers: [] };
    }
    if (error instanceof SyntaxError) {
      console.warn(
        `[agent-backend-v2] ignoring malformed MCP server overrides at ${filePath}: ${error.message}`
      );
      return { disabledServers: [] };
    }
    throw error;
  }
}

export async function writeMcpServerOverrides(
  filePath: string,
  overrides: McpServerOverrides
): Promise<void> {
  await mkdir(dirname(filePath), { recursive: true });
  await writeFile(
    filePath,
    `${JSON.stringify({ disabledServers: overrides.disabledServers }, null, 2)}\n`,
    'utf8'
  );
}
