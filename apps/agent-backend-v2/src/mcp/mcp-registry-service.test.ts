import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { createMcpRegistryService } from './mcp-registry-service.ts';

test('lists browser_extension as built-in and project servers as installed', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'agent-backend-v2-mcp-registry-'));
  try {
    const configPath = join(dir, '.mcp.json');
    await writeFile(
      configPath,
      JSON.stringify({
        mcpServers: {
          context7: {
            type: 'http',
            url: 'https://mcp.context7.com/mcp',
            headers: { CONTEXT7_API_KEY: 'secret' },
          },
        },
      }),
      'utf8'
    );
    const service = createMcpRegistryService({
      configPath,
      userConfigPath: join(dir, '.claude.json'),
      permissionsPath: join(dir, 'permissions.json'),
      browserExtensionMcpUrl: 'http://127.0.0.1:12306/mcp',
      enableBrowserExtensionMcp: true,
    });

    const registry = await service.listServers();

    assert.deepEqual(
      registry.servers.map((server) => ({
        name: server.name,
        builtIn: server.builtIn,
        type: server.type,
        disabled: server.disabled,
        status: server.status,
      })),
      [
        {
          name: 'ewankb-server',
          builtIn: false,
          type: 'sse',
          disabled: false,
          status: 'enabled',
        },
        {
          name: 'browser_extension',
          builtIn: true,
          type: 'http',
          disabled: false,
          status: 'enabled',
        },
        {
          name: 'context7',
          builtIn: false,
          type: 'http',
          disabled: false,
          status: 'enabled',
        },
      ]
    );
    const headers = registry.servers.find((server) => server.name === 'context7')?.config
      .headers as Record<string, string>;
    assert.equal(headers.CONTEXT7_API_KEY, 'secret');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('lists Claude CLI user MCP servers from claude config', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'agent-backend-v2-mcp-registry-user-'));
  try {
    const claudeConfigPath = join(dir, '.claude.json');
    await writeFile(
      claudeConfigPath,
      JSON.stringify({
        mcpServers: {
          'codebase-memory-mcp': {
            command: 'node',
            args: ['memory.js'],
          },
          context7: {
            type: 'http',
            url: 'https://mcp.context7.com/mcp',
            disabled: true,
          },
        },
        projects: {
          [dir]: {
            disabledMcpServers: ['codebase-memory-mcp'],
          },
        },
      }),
      'utf8'
    );
    const service = createMcpRegistryService({
      configPath: join(dir, '.mcp.json'),
      userConfigPath: claudeConfigPath,
      projectPath: dir,
      permissionsPath: join(dir, 'permissions.json'),
      browserExtensionMcpUrl: 'http://127.0.0.1:12306/mcp',
      enableBrowserExtensionMcp: false,
    });

    const registry = await service.listServers();

    assert.deepEqual(
      registry.servers.map((server) => ({
        name: server.name,
        source: server.source,
        type: server.type,
        disabled: server.disabled,
        status: server.status,
      })),
      [
        {
          name: 'codebase-memory-mcp',
          source: 'user',
          type: 'stdio',
          disabled: true,
          status: 'disabled',
        },
        {
          name: 'context7',
          source: 'user',
          type: 'http',
          disabled: true,
          status: 'disabled',
        },
        {
          name: 'ewankb-server',
          source: 'user',
          type: 'sse',
          disabled: false,
          status: 'enabled',
        },
      ]
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('auto injects default ewankb user MCP server when claude config is missing', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'agent-backend-v2-mcp-registry-ewankb-'));
  try {
    const claudeConfigPath = join(dir, '.claude.json');
    const service = createMcpRegistryService({
      configPath: join(dir, '.mcp.json'),
      userConfigPath: claudeConfigPath,
      projectPath: dir,
      permissionsPath: join(dir, 'permissions.json'),
      browserExtensionMcpUrl: 'http://127.0.0.1:12306/mcp',
      enableBrowserExtensionMcp: false,
    });

    const registry = await service.listServers();

    assert.deepEqual(
      registry.servers.map((server) => ({
        name: server.name,
        source: server.source,
        type: server.type,
        disabled: server.disabled,
      })),
      [
        {
          name: 'ewankb-server',
          source: 'user',
          type: 'sse',
          disabled: false,
        },
      ]
    );

    const payload = JSON.parse(await readFile(claudeConfigPath, 'utf8'));
    assert.deepEqual(payload.mcpServers['ewankb-server'], {
      disabled: false,
      type: 'sse',
      transport: 'sse',
      url: 'http://10.27.15.64:22902/sse',
    });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('updates server disabled flag without removing config', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'agent-backend-v2-mcp-registry-disabled-'));
  try {
    const configPath = join(dir, '.mcp.json');
    await writeFile(
      configPath,
      JSON.stringify({ mcpServers: { demo: { command: 'node', args: ['server.js'] } } }),
      'utf8'
    );
    const service = createMcpRegistryService({
      configPath,
      userConfigPath: join(dir, '.claude.json'),
      permissionsPath: join(dir, 'permissions.json'),
      browserExtensionMcpUrl: 'http://127.0.0.1:12306/mcp',
      enableBrowserExtensionMcp: false,
    });

    await service.setServerEnabled('demo', false);

    const payload = JSON.parse(await readFile(configPath, 'utf8'));
    assert.deepEqual(payload.mcpServers.demo, {
      command: 'node',
      args: ['server.js'],
      disabled: true,
    });
    const demoServer = (await service.listServers()).servers.find((server) => server.name === 'demo');
    assert.equal(demoServer?.status, 'disabled');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('updates user server disabled flag through project overrides', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'agent-backend-v2-mcp-registry-user-disable-'));
  try {
    const claudeConfigPath = join(dir, '.claude.json');
    await writeFile(
      claudeConfigPath,
      JSON.stringify({
        mcpServers: {
          gitnexus: { command: 'node', args: ['gitnexus.js'] },
        },
      }),
      'utf8'
    );
    const service = createMcpRegistryService({
      configPath: join(dir, '.mcp.json'),
      userConfigPath: claudeConfigPath,
      projectPath: dir,
      permissionsPath: join(dir, 'permissions.json'),
      browserExtensionMcpUrl: 'http://127.0.0.1:12306/mcp',
      enableBrowserExtensionMcp: false,
    });

    await service.setServerEnabled('gitnexus', false);

    const overrides = JSON.parse(
      await readFile(join(dir, '.webmcp', 'mcp-server-overrides.json'), 'utf8')
    ) as { disabledServers: string[] };
    assert.deepEqual(overrides.disabledServers, ['gitnexus']);
    const gitnexusServer = (await service.listServers()).servers.find(
      (server) => server.name === 'gitnexus'
    );
    assert.equal(gitnexusServer?.status, 'disabled');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('updates built-in browser_extension disabled flag through project overrides', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'agent-backend-v2-mcp-registry-built-in-disable-'));
  try {
    const service = createMcpRegistryService({
      configPath: join(dir, '.mcp.json'),
      userConfigPath: join(dir, '.claude.json'),
      projectPath: dir,
      permissionsPath: join(dir, 'permissions.json'),
      browserExtensionMcpUrl: 'http://127.0.0.1:12306/mcp',
      enableBrowserExtensionMcp: true,
    });

    await service.setServerEnabled('browser_extension', false);

    const overrides = JSON.parse(
      await readFile(join(dir, '.webmcp', 'mcp-server-overrides.json'), 'utf8')
    ) as { disabledServers: string[] };
    assert.deepEqual(overrides.disabledServers, ['browser_extension']);
    const browserExtensionServer = (await service.listServers()).servers.find(
      (server) => server.name === 'browser_extension'
    );
    assert.equal(browserExtensionServer?.status, 'disabled');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('reads and writes raw mcp json', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'agent-backend-v2-mcp-registry-raw-'));
  try {
    const configPath = join(dir, '.mcp.json');
    const service = createMcpRegistryService({
      configPath,
      userConfigPath: join(dir, '.claude.json'),
      permissionsPath: join(dir, 'permissions.json'),
      browserExtensionMcpUrl: 'http://127.0.0.1:12306/mcp',
      enableBrowserExtensionMcp: false,
    });

    await service.writeRawConfig(
      JSON.stringify({ mcpServers: { demo: { type: 'http', url: 'https://example.com/mcp' } } })
    );

    const raw = await service.readRawConfig();
    assert.match(raw.rawJson, /"demo"/);
    const demoServer = (await service.listServers()).servers.find((server) => server.name === 'demo');
    assert.equal(demoServer?.config.url, 'https://example.com/mcp');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('lists workspace-specific project mcp servers when projectPath is provided', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'agent-backend-v2-mcp-registry-project-path-'));
  const workspaceDir = join(dir, 'workspace-a');
  try {
    await mkdir(workspaceDir, { recursive: true });
    await writeFile(
      join(dir, '.mcp.json'),
      JSON.stringify({
        mcpServers: {
          default_server: { command: 'node', args: ['default.js'] },
        },
      }),
      'utf8'
    );
    await writeFile(
      join(workspaceDir, '.mcp.json'),
      JSON.stringify({
        mcpServers: {
          workspace_server: { command: 'node', args: ['workspace.js'] },
        },
      }),
      'utf8'
    );
    const service = createMcpRegistryService({
      configPath: join(dir, '.mcp.json'),
      userConfigPath: join(dir, '.claude.json'),
      permissionsPath: join(dir, 'permissions.json'),
      browserExtensionMcpUrl: 'http://127.0.0.1:12306/mcp',
      enableBrowserExtensionMcp: false,
    });

    const registry = await service.listServers({ projectPath: workspaceDir });

    assert.deepEqual(
      registry.servers.map((server) => server.name),
      ['ewankb-server', 'workspace_server']
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('listServers reuses cached registry until forced refresh', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'agent-backend-v2-mcp-registry-cache-'));
  try {
    const configPath = join(dir, '.mcp.json');
    await writeFile(
      configPath,
      JSON.stringify({
        mcpServers: {
          first: { command: 'node', args: ['first.js'] },
        },
      }),
      'utf8'
    );
    const service = createMcpRegistryService({
      configPath,
      userConfigPath: join(dir, '.claude.json'),
      permissionsPath: join(dir, 'permissions.json'),
      browserExtensionMcpUrl: 'http://127.0.0.1:12306/mcp',
      enableBrowserExtensionMcp: false,
    });

    const first = await service.listServers();
    assert.deepEqual(
      first.servers.map((server) => server.name),
      ['ewankb-server', 'first']
    );

    await writeFile(
      configPath,
      JSON.stringify({
        mcpServers: {
          first: { command: 'node', args: ['first.js'] },
          second: { command: 'node', args: ['second.js'] },
        },
      }),
      'utf8'
    );

    assert.deepEqual(
      (await service.listServers()).servers.map((server) => server.name),
      ['ewankb-server', 'first']
    );
    assert.deepEqual(
      (await service.listServers({ forceRefresh: true })).servers.map((server) => server.name),
      ['ewankb-server', 'first', 'second']
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('toggles tool permissions through allowed and disallowed tools', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'agent-backend-v2-mcp-registry-tools-'));
  try {
    const service = createMcpRegistryService({
      configPath: join(dir, '.mcp.json'),
      userConfigPath: join(dir, '.claude.json'),
      permissionsPath: join(dir, 'permissions.json'),
      browserExtensionMcpUrl: 'http://127.0.0.1:12306/mcp',
      enableBrowserExtensionMcp: true,
      discoverTools: async () => [],
    });

    const enabled = await service.setToolEnabled(
      'mcp__browser_extension__read_current_page_content',
      true
    );
    assert.deepEqual(enabled.allowedTools, ['mcp__browser_extension__read_current_page_content']);
    assert.deepEqual(enabled.disallowedTools, []);

    const disabled = await service.setToolEnabled(
      'mcp__browser_extension__read_current_page_content',
      false
    );
    assert.deepEqual(disabled.allowedTools, []);
    assert.deepEqual(disabled.disallowedTools, [
      'mcp__browser_extension__read_current_page_content',
    ]);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('browser_extension built-in tools expose input schemas for agent tool calling', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'agent-backend-v2-mcp-registry-schema-'));
  try {
    const service = createMcpRegistryService({
      configPath: join(dir, '.mcp.json'),
      userConfigPath: join(dir, '.claude.json'),
      permissionsPath: join(dir, 'permissions.json'),
      browserExtensionMcpUrl: 'http://127.0.0.1:12306/mcp',
      enableBrowserExtensionMcp: true,
      discoverTools: async () => [],
    });

    const registry = await service.listServerTools('browser_extension');
    const callWebsiteTool = registry.tools.find(
      (tool) => tool.fullName === 'mcp__browser_extension__call_website_tool'
    );
    const snapshotLocateTool = registry.tools.find(
      (tool) => tool.fullName === 'mcp__browser_extension__snapshot_locate_dom'
    );

    assert.ok(callWebsiteTool);
    assert.ok(snapshotLocateTool);
    assert.deepEqual(callWebsiteTool.inputSchema, {
      type: 'object',
      properties: {
        toolName: {
          type: 'string',
          description: '要调用的 website tool 全名。',
        },
        arguments: {
          type: 'object',
          description: '传给 website tool 的参数对象。',
          additionalProperties: true,
        },
      },
      required: ['toolName'],
      additionalProperties: false,
    });
    assert.deepEqual(snapshotLocateTool.inputSchema, {
      type: 'object',
      properties: {
        filePath: { type: 'string', description: 'Absolute path to the local HTML file.' },
        line: { type: 'number', description: 'One-based line number.' },
        column: { type: 'number', description: 'One-based column number.' },
      },
      required: ['filePath', 'line', 'column'],
      additionalProperties: false,
    });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('deletes external project MCP servers but refuses built-in browser_extension deletion', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'agent-backend-v2-mcp-registry-delete-'));
  try {
    const configPath = join(dir, '.mcp.json');
    await writeFile(
      configPath,
      JSON.stringify({
        mcpServers: {
          demo: { command: 'node', args: ['server.js'] },
        },
      }),
      'utf8'
    );
    const service = createMcpRegistryService({
      configPath,
      userConfigPath: join(dir, '.claude.json'),
      permissionsPath: join(dir, 'permissions.json'),
      browserExtensionMcpUrl: 'http://127.0.0.1:12306/mcp',
      enableBrowserExtensionMcp: true,
    });

    await service.deleteServer('demo');

    const payload = JSON.parse(await readFile(configPath, 'utf8'));
    assert.deepEqual(payload.mcpServers, {});
    await assert.rejects(() => service.deleteServer('browser_extension'), /cannot be deleted/i);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('discovers live MCP tools and updates registry counts', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'agent-backend-v2-mcp-registry-discover-'));
  try {
    const configPath = join(dir, '.mcp.json');
    await writeFile(
      configPath,
      JSON.stringify({
        mcpServers: {
          context7: { type: 'http', url: 'https://mcp.context7.com/mcp' },
        },
      }),
      'utf8'
    );
    const service = createMcpRegistryService({
      configPath,
      userConfigPath: join(dir, '.claude.json'),
      permissionsPath: join(dir, 'permissions.json'),
      browserExtensionMcpUrl: 'http://127.0.0.1:12306/mcp',
      enableBrowserExtensionMcp: false,
      async discoverTools(name) {
        assert.equal(name, 'context7');
        return [
          {
            name: 'resolve-library-id',
            description: 'Resolve library',
            inputSchema: { type: 'object' },
          },
          {
            name: 'query-docs',
            description: 'Query docs',
          },
        ];
      },
    });

    const details = await service.listServerTools('context7');

    assert.deepEqual(
      details.tools.map((tool) => ({
        name: tool.name,
        fullName: tool.fullName,
        enabled: tool.enabled,
      })),
      [
        {
          name: 'query-docs',
          fullName: 'mcp__context7__query-docs',
          enabled: true,
        },
        {
          name: 'resolve-library-id',
          fullName: 'mcp__context7__resolve-library-id',
          enabled: true,
        },
      ]
    );
    const context7Server = (await service.listServers()).servers.find(
      (server) => server.name === 'context7'
    );
    assert.equal(context7Server?.totalToolCount, 2);
    assert.equal(context7Server?.enabledToolCount, 2);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
