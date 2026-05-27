import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { createMcpConfigService } from './mcp-config-service.ts';

test('includes browser_extension default server', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'agent-backend-v2-mcp-'));
  try {
    const service = createMcpConfigService({
      configPath: join(dir, '.mcp.json'),
      browserExtensionMcpUrl: 'http://127.0.0.1:12306/mcp',
      enableBrowserExtensionMcp: true,
    });

    const servers = await service.listServers();
    assert.equal(servers.browser_extension.type, 'http');
    assert.equal(servers.browser_extension.url, 'http://127.0.0.1:12306/mcp');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('creates updates and deletes project MCP servers', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'agent-backend-v2-mcp-crud-'));
  const configPath = join(dir, '.mcp.json');
  try {
    const service = createMcpConfigService({
      configPath,
      browserExtensionMcpUrl: 'http://127.0.0.1:12306/mcp',
      enableBrowserExtensionMcp: false,
    });

    await service.upsertServer('demo', { command: 'node', args: ['server.js'] });
    assert.equal((await service.listServers()).demo.command, 'node');

    await service.upsertServer('demo', { command: 'tsx', args: ['server.ts'] });
    assert.equal((await service.listServers()).demo.command, 'tsx');

    await service.deleteServer('demo');
    assert.equal((await service.listServers()).demo, undefined);
    assert.deepEqual(JSON.parse(await readFile(configPath, 'utf8')), {
      mcpServers: {},
    });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('upserts user scoped mcp server into ~/.claude.json mcpServers only', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'mcp-config-user-upsert-'));
  try {
    const userConfigPath = join(dir, '.claude.json');
    await writeFile(
      userConfigPath,
      JSON.stringify({
        apiKeyHelper: 'keep-me',
        mcpServers: {
          existing: { command: 'node', args: ['existing.js'] },
        },
      }),
      'utf8'
    );

    const service = createMcpConfigService({
      configPath: join(dir, '.mcp.json'),
      userConfigPath,
      browserExtensionMcpUrl: 'http://127.0.0.1:12306/mcp',
      enableBrowserExtensionMcp: false,
    });

    await service.upsertServer(
      'gitnexus',
      { command: 'node', args: ['gitnexus.js'] },
      { scope: 'user' as 'user' }
    );

    const payload = JSON.parse(await readFile(userConfigPath, 'utf8'));
    assert.equal(payload.apiKeyHelper, 'keep-me');
    assert.deepEqual(payload.mcpServers.gitnexus, {
      command: 'node',
      args: ['gitnexus.js'],
    });
    assert.deepEqual(payload.mcpServers.existing, {
      command: 'node',
      args: ['existing.js'],
    });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('deletes user scoped mcp server from ~/.claude.json without touching other fields', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'mcp-config-user-delete-'));
  try {
    const userConfigPath = join(dir, '.claude.json');
    await writeFile(
      userConfigPath,
      JSON.stringify({
        apiKeyHelper: 'keep-me',
        mcpServers: {
          gitnexus: { command: 'node', args: ['gitnexus.js'] },
          keep: { command: 'node', args: ['keep.js'] },
        },
      }),
      'utf8'
    );

    const service = createMcpConfigService({
      configPath: join(dir, '.mcp.json'),
      userConfigPath,
      browserExtensionMcpUrl: 'http://127.0.0.1:12306/mcp',
      enableBrowserExtensionMcp: false,
    });

    await service.deleteServer('gitnexus', { scope: 'user' as 'user' });

    const payload = JSON.parse(await readFile(userConfigPath, 'utf8'));
    assert.equal(payload.apiKeyHelper, 'keep-me');
    assert.equal(payload.mcpServers.gitnexus, undefined);
    assert.deepEqual(payload.mcpServers.keep, {
      command: 'node',
      args: ['keep.js'],
    });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('reads workspace-specific mcp config when projectPath is provided', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'agent-backend-v2-mcp-project-path-'));
  const defaultConfigPath = join(dir, '.mcp.json');
  const workspaceDir = join(dir, 'workspace-a');
  const workspaceConfigPath = join(workspaceDir, '.mcp.json');
  try {
    await mkdir(workspaceDir, { recursive: true });
    await writeFile(
      defaultConfigPath,
      JSON.stringify({
        mcpServers: {
          default_server: { command: 'node', args: ['default.js'] },
        },
      }),
      'utf8'
    );
    await writeFile(
      workspaceConfigPath,
      JSON.stringify({
        mcpServers: {
          workspace_server: { command: 'node', args: ['workspace.js'] },
        },
      }),
      'utf8'
    );

    const service = createMcpConfigService({
      configPath: defaultConfigPath,
      userConfigPath: join(dir, '.claude.json'),
      browserExtensionMcpUrl: 'http://127.0.0.1:12306/mcp',
      enableBrowserExtensionMcp: false,
    });

    const servers = await service.listServers({ projectPath: workspaceDir });

    assert.deepEqual(Object.keys(servers), ['workspace_server']);
    assert.equal(servers.workspace_server.command, 'node');
    assert.equal(servers.default_server, undefined);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('user configured browser_extension server overrides the default server', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'agent-backend-v2-mcp-override-'));
  const configPath = join(dir, '.mcp.json');
  try {
    await writeFile(
      configPath,
      JSON.stringify({
        mcpServers: {
          browser_extension: { type: 'http', url: 'http://127.0.0.1:9999/mcp' },
        },
      }),
      'utf8'
    );
    const service = createMcpConfigService({
      configPath,
      browserExtensionMcpUrl: 'http://127.0.0.1:12306/mcp',
      enableBrowserExtensionMcp: true,
    });

    const servers = await service.listServers();

    assert.equal(servers.browser_extension.url, 'http://127.0.0.1:9999/mcp');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('merges user MCP servers by default', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'agent-backend-v2-mcp-user-merge-'));
  const configPath = join(dir, '.mcp.json');
  const userConfigPath = join(dir, '.claude.json');
  try {
    await writeFile(
      configPath,
      JSON.stringify({
        mcpServers: {
          project_demo: { command: 'node', args: ['project.js'] },
        },
      }),
      'utf8'
    );
    await writeFile(
      userConfigPath,
      JSON.stringify({
        mcpServers: {
          allowed_user: { command: 'node', args: ['allowed.js'] },
          blocked_user: { command: 'node', args: ['blocked.js'] },
        },
      }),
      'utf8'
    );

    const service = createMcpConfigService({
      configPath,
      userConfigPath,
      browserExtensionMcpUrl: 'http://127.0.0.1:12306/mcp',
      enableBrowserExtensionMcp: false,
    });

    const servers = await service.listServers();

    assert.deepEqual(Object.keys(servers).sort(), [
      'allowed_user',
      'blocked_user',
      'project_demo',
    ]);
    assert.equal(servers.allowed_user.command, 'node');
    assert.equal(servers.blocked_user.command, 'node');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('filters disabled project servers from runtime MCP list', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'agent-backend-v2-mcp-project-disabled-'));
  const configPath = join(dir, '.mcp.json');
  try {
    await writeFile(
      configPath,
      JSON.stringify({
        mcpServers: {
          enabled_server: { command: 'node', args: ['enabled.js'] },
          disabled_server: { command: 'node', args: ['disabled.js'], disabled: true },
        },
      }),
      'utf8'
    );

    const service = createMcpConfigService({
      configPath,
      userConfigPath: join(dir, '.claude.json'),
      browserExtensionMcpUrl: 'http://127.0.0.1:12306/mcp',
      enableBrowserExtensionMcp: false,
    });

    assert.deepEqual(Object.keys(await service.listServers()), ['enabled_server']);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('filters disabled user MCP servers from runtime MCP list via project overrides', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'agent-backend-v2-mcp-user-disabled-'));
  const configPath = join(dir, '.mcp.json');
  const userConfigPath = join(dir, '.claude.json');
  try {
    await writeFile(
      userConfigPath,
      JSON.stringify({
        mcpServers: {
          codebase_memory: { command: 'node', args: ['memory.js'] },
          playwright: { command: 'node', args: ['playwright.js'] },
        },
      }),
      'utf8'
    );
    await mkdir(join(dir, '.webmcp'), { recursive: true });
    await writeFile(
      join(dir, '.webmcp', 'mcp-server-overrides.json'),
      JSON.stringify({ disabledServers: ['playwright'] }),
      'utf8'
    );
    const service = createMcpConfigService({
      configPath,
      userConfigPath,
      browserExtensionMcpUrl: 'http://127.0.0.1:12306/mcp',
      enableBrowserExtensionMcp: false,
    });

    const servers = await service.listServers();

    assert.deepEqual(Object.keys(servers), ['codebase_memory']);
    assert.equal(servers.codebase_memory.command, 'node');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('filters disabled built-in browser_extension via project overrides', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'agent-backend-v2-mcp-built-in-disabled-'));
  const configPath = join(dir, '.mcp.json');
  try {
    await mkdir(join(dir, '.webmcp'), { recursive: true });
    await writeFile(
      join(dir, '.webmcp', 'mcp-server-overrides.json'),
      JSON.stringify({ disabledServers: ['browser_extension'] }),
      'utf8'
    );
    const service = createMcpConfigService({
      configPath,
      userConfigPath: join(dir, '.claude.json'),
      browserExtensionMcpUrl: 'http://127.0.0.1:12306/mcp',
      enableBrowserExtensionMcp: true,
    });

    assert.equal((await service.listServers()).browser_extension, undefined);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('ignores malformed project override json when listing runtime MCP servers', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'agent-backend-v2-mcp-bad-overrides-'));
  const configPath = join(dir, '.mcp.json');
  const userConfigPath = join(dir, '.claude.json');
  try {
    await writeFile(
      userConfigPath,
      JSON.stringify({
        mcpServers: {
          codebase_memory: { command: 'node', args: ['memory.js'] },
        },
      }),
      'utf8'
    );
    await mkdir(join(dir, '.webmcp'), { recursive: true });
    await writeFile(
      join(dir, '.webmcp', 'mcp-server-overrides.json'),
      '{\n  "disabledServers": [\n    "browser_extension"\n  ]\n}\n}\n',
      'utf8'
    );
    const service = createMcpConfigService({
      configPath,
      userConfigPath,
      browserExtensionMcpUrl: 'http://127.0.0.1:12306/mcp',
      enableBrowserExtensionMcp: true,
    });

    const servers = await service.listServers();

    assert.equal(servers.browser_extension?.type, 'http');
    assert.equal(servers.codebase_memory?.command, 'node');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
