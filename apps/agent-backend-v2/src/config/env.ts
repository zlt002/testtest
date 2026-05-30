import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { basename, dirname, resolve } from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

export type AgentBackendV2Env = {
  host: string;
  port: number;
  workdir: string;
  model: string | null;
  globalSkillRoots: string[];
  enableBrowserExtensionMcp: boolean;
  enableLiveWritePreviewDiagnostics: boolean;
  browserExtensionMcpUrl: string;
  claudeCodeExecutablePath: string | null;
};

const defaultWorkdir = resolve(fileURLToPath(new URL('../../../../', import.meta.url)));
const defaultLiteClaudeCliPath = resolve(defaultWorkdir, 'vendor', 'claude-agent-sdk', 'cli.js');

function shouldUseSdkBuiltInClaudeRuntime(source: NodeJS.ProcessEnv): boolean {
  return parseBoolean(source.CLAUDE_CODE_USE_SDK_BUILTIN, false);
}

function parsePort(value: string | undefined): number {
  if (!value) {
    return 8792;
  }
  if (!/^[1-9]\d*$/.test(value)) {
    throw new Error('CLAUDE_AGENT_V2_PORT must be an integer');
  }
  const port = Number(value);
  if (!Number.isSafeInteger(port) || port > 65535) {
    throw new Error('CLAUDE_AGENT_V2_PORT must be between 1 and 65535');
  }
  return port;
}

function parseBoolean(value: string | undefined, defaultValue: boolean): boolean {
  if (value === undefined || value === '') {
    return defaultValue;
  }

  const normalized = value.trim().toLowerCase();
  if (normalized === 'true' || normalized === '1') {
    return true;
  }
  if (normalized === 'false' || normalized === '0') {
    return false;
  }
  throw new Error('CLAUDE_ENABLE_EXTENSION_MCP must be true or false');
}

function parsePathList(value: string | undefined): string[] {
  if (!value) {
    return [];
  }

  return value
    .split(/[;\n]/)
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function resolveClaudeExecutableFromPath(
  source: NodeJS.ProcessEnv,
  platform: NodeJS.Platform = process.platform
): string | null {
  try {
    const command = platform === 'win32' ? 'where.exe' : 'which';
    const resolvedPath = execFileSync(command, ['claude'], {
      encoding: 'utf8',
      env: source,
      stdio: ['ignore', 'pipe', 'ignore'],
    })
      .split(/\r?\n/)
      .map((entry) => entry.trim())
      .find(Boolean);
    return resolvedPath || null;
  } catch {
    return null;
  }
}

function normalizeClaudeExecutablePath(
  candidatePath: string | null,
  platform: NodeJS.Platform,
  fileExists: (path: string) => boolean
): string | null {
  if (!candidatePath) {
    return null;
  }

  if (platform !== 'win32') {
    return candidatePath;
  }

  const normalizedBaseName = basename(candidatePath).toLowerCase();
  if (
    normalizedBaseName !== 'claude' &&
    normalizedBaseName !== 'claude.cmd' &&
    normalizedBaseName !== 'claude.ps1'
  ) {
    return candidatePath;
  }

  const nativeExecutablePath = resolve(
    dirname(candidatePath),
    'node_modules',
    '@anthropic-ai',
    'claude-code',
    'bin',
    'claude.exe'
  );

  return fileExists(nativeExecutablePath) ? nativeExecutablePath : candidatePath;
}

export function loadEnv(
  source: NodeJS.ProcessEnv = process.env,
  deps: {
    exists?: (path: string) => boolean;
    resolveFromPath?: (env: NodeJS.ProcessEnv, platform: NodeJS.Platform) => string | null;
    platform?: NodeJS.Platform;
  } = {}
): AgentBackendV2Env {
  const fileExists = deps.exists ?? existsSync;
  const resolveFromPath = deps.resolveFromPath ?? resolveClaudeExecutableFromPath;
  const currentPlatform = deps.platform ?? process.platform;
  const claudeCodeExecutablePath =
    shouldUseSdkBuiltInClaudeRuntime(source)
      ? null
      : source.CLAUDE_CODE_EXECUTABLE_PATH?.trim() ||
        (fileExists(defaultLiteClaudeCliPath)
          ? defaultLiteClaudeCliPath
          : normalizeClaudeExecutablePath(
              resolveFromPath(source, currentPlatform),
              currentPlatform,
              fileExists
            ));

  return {
    host: source.CLAUDE_AGENT_V2_HOST || '127.0.0.1',
    port: parsePort(source.CLAUDE_AGENT_V2_PORT),
    workdir: source.CLAUDE_AGENT_V2_WORKDIR || defaultWorkdir,
    model: source.CLAUDE_AGENT_V2_MODEL?.trim() || null,
    globalSkillRoots: parsePathList(source.CLAUDE_AGENT_V2_GLOBAL_SKILL_ROOTS),
    enableBrowserExtensionMcp: parseBoolean(source.CLAUDE_ENABLE_EXTENSION_MCP, true),
    enableLiveWritePreviewDiagnostics: parseBoolean(
      source.CLAUDE_AGENT_V2_LIVE_WRITE_PREVIEW_DIAGNOSTICS,
      false
    ),
    browserExtensionMcpUrl: source.CLAUDE_EXTENSION_MCP_URL || 'http://127.0.0.1:12306/mcp',
    claudeCodeExecutablePath,
  };
}
