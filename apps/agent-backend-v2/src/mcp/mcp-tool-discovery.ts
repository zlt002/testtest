import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';
import type { McpServerConfig } from './browser-extension-mcp.ts';

export type DiscoveredMcpTool = {
  name: string;
  description?: string;
  inputSchema?: unknown;
};

function recordValue(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function stringRecord(value: unknown): Record<string, string> | undefined {
  const record = recordValue(value);
  if (!record) return undefined;
  return Object.fromEntries(
    Object.entries(record)
      .filter((entry): entry is [string, string] => typeof entry[1] === 'string')
      .filter(([key]) => Boolean(key.trim()))
  );
}

function getUrl(config: McpServerConfig): string | null {
  const candidates = [config.url, config.serverUrl];
  for (const candidate of candidates) {
    if (typeof candidate === 'string' && candidate.trim()) {
      return candidate.trim();
    }
  }
  return null;
}

function requestInit(config: McpServerConfig): RequestInit | undefined {
  const headers = stringRecord(config.headers);
  return headers ? { headers } : undefined;
}

function createTransport(config: McpServerConfig): Transport {
  const url = getUrl(config);
  const type = typeof config.type === 'string' ? config.type : '';
  const transport = typeof config.transport === 'string' ? config.transport : '';

  if (url) {
    if (type === 'sse' || transport === 'sse' || url.endsWith('/sse')) {
      return new SSEClientTransport(new URL(url), { requestInit: requestInit(config) });
    }
    return new StreamableHTTPClientTransport(new URL(url), { requestInit: requestInit(config) });
  }

  if (typeof config.command === 'string' && config.command.trim()) {
    return new StdioClientTransport({
      command: config.command.trim(),
      args: Array.isArray(config.args)
        ? config.args.filter((arg): arg is string => typeof arg === 'string')
        : [],
      env: stringRecord(config.env),
      cwd: typeof config.cwd === 'string' ? config.cwd : undefined,
      stderr: 'pipe',
    });
  }

  throw new Error('MCP server config must include url/serverUrl or command.');
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error('MCP tool discovery timed out.')), timeoutMs);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export async function discoverMcpTools(
  _name: string,
  config: McpServerConfig,
  options: { timeoutMs?: number } = {}
): Promise<DiscoveredMcpTool[]> {
  const transport = createTransport(config);
  const client = new Client({ name: 'accr Registry', version: '0.1.0' });
  try {
    await withTimeout(client.connect(transport), options.timeoutMs ?? 8000);
    const response = await withTimeout(client.listTools(), options.timeoutMs ?? 8000);
    return response.tools.map((tool) => ({
      name: tool.name,
      description: tool.description,
      inputSchema: tool.inputSchema,
    }));
  } finally {
    await transport.close().catch(() => {});
  }
}
