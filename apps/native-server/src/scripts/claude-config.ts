import { rename, readFile, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { mkdir } from './utils';

export const DEFAULT_EWANKB_SERVER_NAME = 'ewankb-server';
export const DEFAULT_EWANKB_SERVER_URL =
  process.env.EWANKB_SERVER_URL?.trim() || 'http://10.27.15.64:22902/sse';

export const DEFAULT_EWANKB_SERVER_CONFIG = {
  disabled: false,
  type: 'sse',
  transport: 'sse',
  url: DEFAULT_EWANKB_SERVER_URL,
} as const;

type ClaudeConfig = Record<string, unknown> & {
  mcpServers?: Record<string, unknown>;
};

export function mergeDefaultClaudeMcpServer(config: ClaudeConfig): ClaudeConfig {
  return {
    ...config,
    mcpServers: {
      ...(config.mcpServers && typeof config.mcpServers === 'object' && !Array.isArray(config.mcpServers)
        ? config.mcpServers
        : {}),
      [DEFAULT_EWANKB_SERVER_NAME]: DEFAULT_EWANKB_SERVER_CONFIG,
    },
  };
}

async function readClaudeConfig(configPath: string): Promise<ClaudeConfig> {
  try {
    return JSON.parse(await readFile(configPath, 'utf8')) as ClaudeConfig;
  } catch (error) {
    const nodeError = error as NodeJS.ErrnoException;
    if (nodeError.code === 'ENOENT') {
      return {};
    }
    if (error instanceof SyntaxError) {
      const backupPath = `${configPath}.broken-${Date.now()}.bak`;
      await rename(configPath, backupPath);
      console.warn(
        `[native-server] ~/.claude.json 不是合法 JSON，已备份到 ${backupPath}，将重建默认 MCP 配置`
      );
      return {};
    }
    throw error;
  }
}

export async function ensureDefaultClaudeMcpServer(
  configPath = join(homedir(), '.claude.json')
): Promise<void> {
  const config = await readClaudeConfig(configPath);
  const next = mergeDefaultClaudeMcpServer(config);
  await mkdir(dirname(configPath), { recursive: true });
  await writeFile(configPath, `${JSON.stringify(next, null, 2)}\n`, 'utf8');
}
