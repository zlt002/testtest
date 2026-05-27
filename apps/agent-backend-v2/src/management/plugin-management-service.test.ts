import assert from 'node:assert/strict';
import { cp, mkdir, mkdtemp, readFile, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import {
  __setLitePluginRegistryTestHooks,
  importPluginDirectory,
  installPlugin,
  listManagedPlugins,
  removeManagedPlugin,
  setManagedPluginEnabled,
} from './plugin-management-service.ts';

async function createPlugin(root: string, input: { id: string; name?: string; version?: string }) {
  const pluginPath = join(root, input.id);
  await mkdir(join(pluginPath, '.claude-plugin'), { recursive: true });
  await writeFile(
    join(pluginPath, '.claude-plugin', 'plugin.json'),
    JSON.stringify({
      id: input.id,
      name: input.name || input.id,
      version: input.version || '1.0.0',
    }),
    'utf8'
  );
  return pluginPath;
}

function createFakeShell(repoMap: Record<string, string>) {
  const calls: Array<{ command: string; args: string[]; cwd?: string }> = [];
  return {
    calls,
    shell: async (input: { command: string; args: string[]; cwd?: string }) => {
      calls.push({ command: input.command, args: [...input.args], cwd: input.cwd });
      if (input.command !== 'git' || input.args[0] !== 'clone') {
        throw new Error(`Unexpected command: ${input.command} ${input.args.join(' ')}`);
      }
      const repoUrl = input.args[1];
      const targetDir = input.args[2];
      if (!repoUrl || !targetDir) {
        throw new Error(`Unexpected clone args: ${input.args.join(' ')}`);
      }
      const sourceDir = repoMap[repoUrl];
      if (!sourceDir) {
        throw new Error(`No fake repo mapped for ${repoUrl}`);
      }
      await cp(sourceDir, targetDir, { recursive: true });
      return { exitCode: 0, stdout: '', stderr: '' };
    },
  };
}

async function pathExists(path: string) {
  return stat(path)
    .then(() => true)
    .catch(() => false);
}

test('imports, toggles, lists, and removes local directory plugins', async () => {
  const root = await mkdtemp(join(tmpdir(), 'webmcp-plugins-'));
  const homeDir = join(root, 'home');
  const pluginPath = await createPlugin(join(root, 'plugins'), {
    id: 'demo@local',
    name: 'Demo Plugin',
  });

  const imported = await importPluginDirectory({ homeDir, pluginPath });
  assert.equal(imported.id, 'demo@local');
  assert.equal(imported.enabled, true);
  assert.equal(imported.path, pluginPath);

  assert.deepEqual(
    (await listManagedPlugins({ homeDir })).map((plugin) => ({
      id: plugin.id,
      enabled: plugin.enabled,
      kind: plugin.source.kind,
      removable: plugin.source.removable,
    })),
    [{ id: 'demo@local', enabled: true, kind: 'lite', removable: true }]
  );

  await setManagedPluginEnabled({ homeDir, id: 'demo@local', sourceKind: 'lite', enabled: false });
  assert.equal((await listManagedPlugins({ homeDir }))[0].enabled, false);

  await removeManagedPlugin({ homeDir, id: 'demo@local', sourceKind: 'lite' });
  assert.deepEqual(await listManagedPlugins({ homeDir }), []);
});

test('reads legacy plugins array and rewrites installs array after mutation', async () => {
  const root = await mkdtemp(join(tmpdir(), 'webmcp-plugin-registry-'));
  const homeDir = join(root, 'home');
  const registryPath = join(homeDir, '.webmcp', 'lite-plugin-registry.json');
  await mkdir(join(homeDir, '.webmcp'), { recursive: true });
  await writeFile(
    registryPath,
    JSON.stringify({
      plugins: [
        {
          id: 'legacy@local',
          name: 'Legacy Plugin',
          version: '1.0.0',
          path: 'C:\\legacy',
          enabled: true,
        },
      ],
    }),
    'utf8'
  );

  const before = await listManagedPlugins({ homeDir });
  assert.equal(before[0]?.id, 'legacy@local');
  assert.equal(before[0]?.source.kind, 'lite');

  const pluginPath = await createPlugin(join(root, 'plugins'), { id: 'demo@local' });
  await importPluginDirectory({ homeDir, pluginPath });

  const payload = JSON.parse(await readFile(registryPath, 'utf8')) as {
    installs?: unknown[];
    plugins?: unknown[];
  };
  assert.ok(Array.isArray(payload.installs));
  assert.equal(payload.plugins, undefined);
  assert.equal(payload.installs?.length, 2);
});

test('importPluginDirectory rejects directories without plugin manifest', async () => {
  const root = await mkdtemp(join(tmpdir(), 'webmcp-plugin-errors-'));
  const homeDir = join(root, 'home');
  const pluginPath = join(root, 'plugins', 'broken');
  await mkdir(pluginPath, { recursive: true });

  await assert.rejects(() => importPluginDirectory({ homeDir, pluginPath }), /plugin\.json/i);
});

test('installPlugin accepts GitHub repository URLs', async () => {
  const root = await mkdtemp(join(tmpdir(), 'webmcp-github-plugin-'));
  const homeDir = join(root, 'home');
  const remoteRepo = await createPlugin(join(root, 'remote'), {
    id: 'remote-demo@local',
    name: 'Remote Demo',
  });
  const fakeShell = createFakeShell({
    'https://github.com/example/remote-demo': remoteRepo,
  });

  const plugin = await installPlugin({
    homeDir,
    source: {
      kind: 'github',
      repoUrl: 'https://github.com/example/remote-demo',
    },
    shell: fakeShell.shell,
  });

  assert.equal(plugin.id, 'remote-demo@local');
  assert.equal(plugin.enabled, true);
  assert.equal(plugin.path, join(homeDir, '.webmcp', 'plugins', 'example__remote-demo'));
  assert.equal(plugin.source.kind, 'github');
  assert.equal(fakeShell.calls[0]?.command, 'git');
  assert.equal(fakeShell.calls[0]?.args[0], 'clone');
  assert.equal(fakeShell.calls[0]?.args[1], 'https://github.com/example/remote-demo');

  const listed = await listManagedPlugins({ homeDir, forceRefresh: true });
  assert.equal(listed[0]?.source.kind, 'github');
});

test('installPlugin supports repo#subdir manifest lookup', async () => {
  const root = await mkdtemp(join(tmpdir(), 'webmcp-github-subdir-'));
  const homeDir = join(root, 'home');
  const remoteRoot = join(root, 'remote', 'repo');
  await createPlugin(join(remoteRoot, 'plugins'), {
    id: 'subdir-demo@local',
    name: 'Subdir Demo',
  });
  const fakeShell = createFakeShell({
    'https://github.com/example/remote-demo': remoteRoot,
  });

  const plugin = await installPlugin({
    homeDir,
    source: {
      kind: 'github',
      repoUrl: 'https://github.com/example/remote-demo#plugins/subdir-demo@local',
    },
    shell: fakeShell.shell,
  });

  assert.equal(plugin.id, 'subdir-demo@local');
  assert.equal(
    plugin.path,
    join(homeDir, '.webmcp', 'plugins', 'example__remote-demo', 'plugins', 'subdir-demo@local')
  );
  assert.equal(plugin.source.repoUrl, 'https://github.com/example/remote-demo#plugins/subdir-demo@local');

  const listed = await listManagedPlugins({ homeDir, forceRefresh: true });
  assert.equal(listed[0]?.source.kind, 'github');
  assert.equal(listed[0]?.source.repoUrl, 'https://github.com/example/remote-demo#plugins/subdir-demo@local');
});

test('installPlugin rejects unsupported GitHub URLs', async () => {
  const root = await mkdtemp(join(tmpdir(), 'webmcp-github-invalid-'));
  const homeDir = join(root, 'home');

  await assert.rejects(
    () =>
      installPlugin({
        homeDir,
        source: {
          kind: 'github',
          repoUrl: 'https://gitlab.com/example/repo',
        },
      }),
    /github\.com/i
  );
});

test('installPlugin removes the cloned directory when manifest lookup fails', async () => {
  const root = await mkdtemp(join(tmpdir(), 'webmcp-github-manifest-fail-'));
  const homeDir = join(root, 'home');
  const repoRoot = join(root, 'remote', 'repo');
  await mkdir(repoRoot, { recursive: true });
  const fakeShell = createFakeShell({
    'https://github.com/example/manifest-fail': repoRoot,
  });
  const installDir = join(homeDir, '.webmcp', 'plugins', 'example__manifest-fail');

  await assert.rejects(
    () =>
      installPlugin({
        homeDir,
        source: {
          kind: 'github',
          repoUrl: 'https://github.com/example/manifest-fail',
        },
        shell: fakeShell.shell,
      }),
    /plugin manifest not found/i
  );

  assert.equal(await pathExists(installDir), false);
});

test('installPlugin removes the cloned directory when subdir lookup fails', async () => {
  const root = await mkdtemp(join(tmpdir(), 'webmcp-github-subdir-fail-'));
  const homeDir = join(root, 'home');
  const repoRoot = join(root, 'remote', 'repo');
  await createPlugin(repoRoot, { id: 'root-demo@local' });
  const fakeShell = createFakeShell({
    'https://github.com/example/subdir-fail': repoRoot,
  });
  const installDir = join(homeDir, '.webmcp', 'plugins', 'example__subdir-fail');

  await assert.rejects(
    () =>
      installPlugin({
        homeDir,
        source: {
          kind: 'github',
          repoUrl: 'https://github.com/example/subdir-fail#missing/subdir',
        },
        shell: fakeShell.shell,
      }),
    /subdirectory does not exist/i
  );

  assert.equal(await pathExists(installDir), false);
});

test('removeManagedPlugin deletes the managed GitHub install directory', async () => {
  const root = await mkdtemp(join(tmpdir(), 'webmcp-github-remove-'));
  const homeDir = join(root, 'home');
  const remoteRepo = await createPlugin(join(root, 'remote'), {
    id: 'remove-demo@local',
    name: 'Remove Demo',
  });
  const fakeShell = createFakeShell({
    'https://github.com/example/remove-demo': remoteRepo,
  });
  const installDir = join(homeDir, '.webmcp', 'plugins', 'example__remove-demo');

  const installed = await installPlugin({
    homeDir,
    source: {
      kind: 'github',
      repoUrl: 'https://github.com/example/remove-demo',
    },
    shell: fakeShell.shell,
  });

  assert.equal(installed.source.kind, 'github');
  assert.equal(await pathExists(installDir), true);

  await removeManagedPlugin({ homeDir, id: 'remove-demo@local' });

  assert.equal(await pathExists(installDir), false);
  assert.deepEqual(await listManagedPlugins({ homeDir, forceRefresh: true }), []);
});

test('removeManagedPlugin rejects unsafe GitHub install directories outside managed root', async () => {
  const root = await mkdtemp(join(tmpdir(), 'webmcp-github-unsafe-remove-'));
  const homeDir = join(root, 'home');
  const unsafeDir = await createPlugin(join(root, 'external'), {
    id: 'unsafe-demo@local',
    name: 'Unsafe Demo',
  });
  const registryPath = join(homeDir, '.webmcp', 'lite-plugin-registry.json');
  await mkdir(join(homeDir, '.webmcp'), { recursive: true });
  await writeFile(
    registryPath,
    JSON.stringify({
      installs: [
        {
          id: 'unsafe-demo@local',
          name: 'Unsafe Demo',
          version: '1.0.0',
          path: unsafeDir,
          enabled: true,
          type: 'local',
          local: true,
          scope: 'user',
          installSource: {
            kind: 'github',
            repoUrl: 'https://github.com/example/unsafe-demo',
            directory: unsafeDir,
          },
        },
      ],
    }),
    'utf8'
  );

  await assert.rejects(
    () => removeManagedPlugin({ homeDir, id: 'unsafe-demo@local' }),
    /outside the managed plugin directory/i
  );

  assert.equal(await pathExists(unsafeDir), true);
  const listed = await listManagedPlugins({ homeDir, forceRefresh: true });
  assert.equal(listed[0]?.id, 'unsafe-demo@local');
  assert.equal(listed[0]?.source.kind, 'github');
});

test('removeManagedPlugin leaves registry and install directory untouched when registry removal write fails', async () => {
  const root = await mkdtemp(join(tmpdir(), 'webmcp-github-remove-write-fail-'));
  const homeDir = join(root, 'home');
  const remoteRepo = await createPlugin(join(root, 'remote'), {
    id: 'write-fail-demo@local',
    name: 'Write Fail Demo',
  });
  const fakeShell = createFakeShell({
    'https://github.com/example/write-fail-demo': remoteRepo,
  });
  const installDir = join(homeDir, '.webmcp', 'plugins', 'example__write-fail-demo');

  await installPlugin({
    homeDir,
    source: {
      kind: 'github',
      repoUrl: 'https://github.com/example/write-fail-demo',
    },
    shell: fakeShell.shell,
  });

  __setLitePluginRegistryTestHooks({
    onBeforeRemovePersist: () => {
      throw new Error('simulated remove write failure');
    },
  });
  try {
    await assert.rejects(
      () => removeManagedPlugin({ homeDir, id: 'write-fail-demo@local' }),
      /simulated remove write failure/i
    );
  } finally {
    __setLitePluginRegistryTestHooks(null);
  }

  assert.equal(await pathExists(installDir), true);
  const listed = await listManagedPlugins({ homeDir, forceRefresh: true });
  assert.equal(listed[0]?.id, 'write-fail-demo@local');
  assert.equal(listed[0]?.source.kind, 'github');
});

test('removeManagedPlugin surfaces rollback failure when delete and registry restore both fail', async () => {
  const root = await mkdtemp(join(tmpdir(), 'webmcp-github-remove-rollback-fail-'));
  const homeDir = join(root, 'home');
  const unsafeDir = await createPlugin(join(root, 'external'), {
    id: 'rollback-fail-demo@local',
    name: 'Rollback Fail Demo',
  });
  const registryPath = join(homeDir, '.webmcp', 'lite-plugin-registry.json');
  await mkdir(join(homeDir, '.webmcp'), { recursive: true });
  await writeFile(
    registryPath,
    JSON.stringify({
      installs: [
        {
          id: 'rollback-fail-demo@local',
          name: 'Rollback Fail Demo',
          version: '1.0.0',
          path: unsafeDir,
          enabled: true,
          type: 'local',
          local: true,
          scope: 'user',
          installSource: {
            kind: 'github',
            repoUrl: 'https://github.com/example/rollback-fail-demo',
            directory: unsafeDir,
          },
        },
      ],
    }),
    'utf8'
  );

  __setLitePluginRegistryTestHooks({
    onBeforeUpsertPersist: ({ id }) => {
      if (id === 'rollback-fail-demo@local') {
        throw new Error('simulated rollback restore failure');
      }
    },
  });
  try {
    await assert.rejects(
      () => removeManagedPlugin({ homeDir, id: 'rollback-fail-demo@local' }),
      /rollback restore failure/i
    );
  } finally {
    __setLitePluginRegistryTestHooks(null);
  }

  assert.equal(await pathExists(unsafeDir), true);
});

test('listManagedPlugins includes Claude CLI enabled plugin records', async () => {
  const root = await mkdtemp(join(tmpdir(), 'webmcp-cli-plugins-'));
  const homeDir = join(root, 'home');
  const cliPluginPath = join(root, 'cache', 'cookbook');
  await mkdir(join(homeDir, '.claude', 'plugins'), { recursive: true });
  await writeFile(
    join(homeDir, '.claude', 'settings.json'),
    JSON.stringify({ enabledPlugins: { 'cookbook@market': true } }),
    'utf8'
  );
  await writeFile(
    join(homeDir, '.claude', 'plugins', 'installed_plugins.json'),
    JSON.stringify({
      plugins: {
        'cookbook@market': [
          { scope: 'user', name: 'cookbook', version: '3.0.0', installPath: cliPluginPath },
        ],
      },
    }),
    'utf8'
  );

  const plugins = await listManagedPlugins({ homeDir });

  assert.deepEqual(plugins, [
    {
      id: 'cookbook@market',
      name: 'cookbook',
      version: '3.0.0',
      path: cliPluginPath,
      enabled: true,
      type: 'local',
      local: true,
      sdkResolved: true,
      source: {
        kind: 'cli',
        path: join(homeDir, '.claude', 'settings.json'),
        writable: true,
        removable: false,
      },
    },
  ]);
});

test('listManagedPlugins reuses cached records until forced refresh or mutation', async () => {
  const root = await mkdtemp(join(tmpdir(), 'webmcp-plugin-cache-'));
  const homeDir = join(root, 'home');
  await mkdir(join(homeDir, '.claude', 'plugins'), { recursive: true });
  await writeFile(
    join(homeDir, '.claude', 'settings.json'),
    JSON.stringify({ enabledPlugins: { 'cookbook@market': true } }),
    'utf8'
  );
  await writeFile(
    join(homeDir, '.claude', 'plugins', 'installed_plugins.json'),
    JSON.stringify({
      plugins: {
        'cookbook@market': [
          { scope: 'user', name: 'cookbook', version: '3.0.0', installPath: join(root, 'cache') },
        ],
      },
    }),
    'utf8'
  );

  const first = await listManagedPlugins({ homeDir });
  assert.equal(first[0].enabled, true);

  await writeFile(
    join(homeDir, '.claude', 'settings.json'),
    JSON.stringify({ enabledPlugins: { 'cookbook@market': false } }),
    'utf8'
  );

  assert.equal((await listManagedPlugins({ homeDir }))[0].enabled, true);
  assert.equal((await listManagedPlugins({ homeDir, forceRefresh: true }))[0].enabled, false);

  await setManagedPluginEnabled({
    homeDir,
    id: 'cookbook@market',
    sourceKind: 'cli',
    enabled: true,
  });
  assert.equal((await listManagedPlugins({ homeDir }))[0].enabled, true);
});
