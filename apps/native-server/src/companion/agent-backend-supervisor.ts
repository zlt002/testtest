import { type ChildProcessWithoutNullStreams, spawn } from 'node:child_process';
import path from 'node:path';
import { NATIVE_SERVER_PORT } from '../constant';
import { logger } from '../util/logger';

export type AgentBackendDiscovery = {
  agentBaseUrl: string;
  agentApiBaseUrl: string;
  mcpUrl: string;
  capabilities: unknown | null;
  agent: {
    running: boolean;
    managed: boolean;
    pid?: number;
  };
};

function repoRoot() {
  return process.env.WEBMCP_REPO_ROOT || path.resolve(__dirname, '../../../..');
}

function agentBaseUrl() {
  return process.env.WEBMCP_AGENT_V2_BASE_URL || 'http://127.0.0.1:8792';
}

function mcpUrl(port: number) {
  return process.env.WEBMCP_NATIVE_MCP_URL || `http://127.0.0.1:${port}/mcp`;
}

async function sleep(ms: number) {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchJson(url: string): Promise<unknown | null> {
  try {
    const response = await fetch(url);
    if (!response.ok) {
      return null;
    }
    return response.json();
  } catch {
    return null;
  }
}

type AgentBackendCommand = {
  command: string;
  args: string[];
};

function parseOverrideCommand(override: string): AgentBackendCommand {
  const [command, ...args] =
    override.match(/"[^"]+"|'[^']+'|\S+/g)?.map((part) => part.replace(/^["']|["']$/g, '')) ?? [];
  return { command, args };
}

export function resolveAgentBackendCommand({
  env = process.env,
  platform = process.platform,
}: {
  env?: NodeJS.ProcessEnv;
  platform?: NodeJS.Platform;
} = {}): AgentBackendCommand {
  const windowsStartScript = env.WEBMCP_AGENT_V2_WINDOWS_START_SCRIPT?.trim();
  if (platform === 'win32' && windowsStartScript) {
    return {
      command: env.ComSpec || 'cmd.exe',
      args: ['/d', '/s', '/c', windowsStartScript],
    };
  }

  const override = env.WEBMCP_AGENT_V2_COMMAND?.trim();
  if (override) {
    return parseOverrideCommand(override);
  }

  return {
    command: 'pnpm',
    args: ['--filter', '@mcp-b/agent-backend-v2', 'dev'],
  };
}

export class AgentBackendSupervisor {
  private child: ChildProcessWithoutNullStreams | null = null;

  public async ensureStarted(): Promise<void> {
    const capabilities = await fetchJson(`${agentBaseUrl()}/api/capabilities`);
    if (capabilities) {
      return;
    }

    if (this.child && !this.child.killed) {
      await this.waitForReady();
      return;
    }

    const { command, args } = resolveAgentBackendCommand();
    logger.info(`[companion] Starting Agent Backend V2 with: ${command} ${args.join(' ')}`);
    this.child = spawn(command, args, {
      cwd: repoRoot(),
      env: {
        ...process.env,
        CLAUDE_EXTENSION_MCP_URL: mcpUrl(NATIVE_SERVER_PORT),
      },
      stdio: 'pipe',
    });

    this.child.stdout.on('data', (chunk) => {
      logger.info(`[agent-backend-v2] ${String(chunk).trimEnd()}`);
    });
    this.child.stderr.on('data', (chunk) => {
      logger.error(`[agent-backend-v2] ${String(chunk).trimEnd()}`);
    });
    this.child.on('error', (error) => {
      logger.error(`[companion] Failed to start Agent Backend V2: ${error.message}`);
      this.child = null;
    });
    this.child.on('exit', (code, signal) => {
      logger.info(`[companion] Agent Backend V2 exited with code=${code} signal=${signal}`);
      this.child = null;
    });

    await this.waitForReady();
  }

  public async discovery(port: number = NATIVE_SERVER_PORT): Promise<AgentBackendDiscovery> {
    const baseUrl = agentBaseUrl();
    const capabilities = await fetchJson(`${baseUrl}/api/capabilities`);

    return {
      agentBaseUrl: baseUrl,
      agentApiBaseUrl: `${baseUrl}/api/agent-v2`,
      mcpUrl: mcpUrl(port),
      capabilities,
      agent: {
        running: capabilities !== null,
        managed: this.child !== null,
        pid: this.child?.pid,
      },
    };
  }

  public async stop(): Promise<void> {
    if (!this.child) {
      return;
    }

    this.child.kill('SIGTERM');
    this.child = null;
  }

  private async waitForReady(): Promise<void> {
    for (let attempt = 0; attempt < 30; attempt += 1) {
      const capabilities = await fetchJson(`${agentBaseUrl()}/api/capabilities`);
      if (capabilities) {
        return;
      }
      await sleep(500);
    }

    logger.error('[companion] Agent Backend V2 did not become ready within 15s');
  }
}
