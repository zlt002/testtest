import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import type { McpServerConfig } from './browser-extension-mcp.ts';

export const DEFAULT_EWANKB_SERVER_NAME = 'ewankb-server';
export const DEFAULT_EWANKB_SERVER_CONFIG: McpServerConfig = {
  disabled: false,
  type: 'sse',
  transport: 'sse',
  url: process.env.EWANKB_SERVER_URL?.trim() || 'http://10.27.15.64:22902/sse',
};

type ClaudeUserConfig = Record<string, unknown> & {
  mcpServers?: Record<string, McpServerConfig>;
};

export function mergeDefaultUserMcpServer(config: ClaudeUserConfig): ClaudeUserConfig {
  const currentServers =
    config.mcpServers && typeof config.mcpServers === 'object' && !Array.isArray(config.mcpServers)
      ? config.mcpServers
      : {};

  return {
    ...config,
    mcpServers: {
      ...currentServers,
      [DEFAULT_EWANKB_SERVER_NAME]: DEFAULT_EWANKB_SERVER_CONFIG,
    },
  };
}

export async function ensureDefaultUserMcpServer(configPath: string): Promise<ClaudeUserConfig> {
  let payload: unknown = {};
  try {
    payload = JSON.parse(await readFile(configPath, 'utf8')) as unknown;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      throw error;
    }
  }

  const config =
    payload && typeof payload === 'object' && !Array.isArray(payload)
      ? (payload as ClaudeUserConfig)
      : {};

  const next = mergeDefaultUserMcpServer(config);
  await mkdir(dirname(configPath), { recursive: true });
  await writeFile(configPath, `${JSON.stringify(next, null, 2)}\n`, 'utf8');
  return next;
}
