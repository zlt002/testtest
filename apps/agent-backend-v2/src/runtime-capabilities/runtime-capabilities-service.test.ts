import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test from 'node:test';
import {
  createRuntimeCapabilitiesService,
  DEFAULT_RUNTIME_CAPABILITIES,
} from './runtime-capabilities-service.ts';

test('runtime capabilities default to inheriting user Claude settings', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'agent-backend-v2-runtime-capabilities-'));
  try {
    const service = createRuntimeCapabilitiesService({
      configPath: join(dir, '.webmcp', 'runtime-capabilities.json'),
    });

    assert.deepEqual(await service.getCapabilities(), {
      ...DEFAULT_RUNTIME_CAPABILITIES,
      selectedAuthSource: 'user_claude_settings',
    });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('runtime capabilities ignore legacy plugin/tool fields when reading config', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'agent-backend-v2-runtime-capabilities-legacy-read-'));
  const configPath = join(dir, '.webmcp', 'runtime-capabilities.json');
  try {
    await mkdir(dirname(configPath), { recursive: true });
    await writeFile(
      configPath,
      `${JSON.stringify(
        {
          inheritUserClaudeSettings: true,
          allowExternalBrowserAutomation: true,
          allowedPluginIds: ['playwright@claude-plugins-official'],
          allowedToolPrefixes: ['mcp__plugin_playwright_playwright__'],
        },
        null,
        2
      )}\n`,
      'utf8'
    );

    const service = createRuntimeCapabilitiesService({ configPath });

    assert.deepEqual(await service.getCapabilities(), {
      selectedAuthSource: 'user_claude_settings',
    });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('runtime capabilities migrate inheritUserClaudeSettings=false to project_model_config', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'agent-backend-v2-runtime-capabilities-migrate-'));
  const configPath = join(dir, '.webmcp', 'runtime-capabilities.json');
  try {
    await mkdir(dirname(configPath), { recursive: true });
    await writeFile(
      configPath,
      `${JSON.stringify(
        {
          inheritUserClaudeSettings: false,
        },
        null,
        2
      )}\n`,
      'utf8'
    );

    const service = createRuntimeCapabilitiesService({ configPath });

    assert.deepEqual(await service.getCapabilities(), {
      selectedAuthSource: 'project_model_config',
    });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('runtime capabilities rewrite persisted config without legacy plugin/tool fields', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'agent-backend-v2-runtime-capabilities-write-'));
  const configPath = join(dir, '.webmcp', 'runtime-capabilities.json');
  try {
    await mkdir(dirname(configPath), { recursive: true });
    await writeFile(
      configPath,
      `${JSON.stringify(
        {
          inheritUserClaudeSettings: false,
          allowExternalBrowserAutomation: false,
          allowedPluginIds: ['playwright@claude-plugins-official'],
          allowedToolPrefixes: ['mcp__plugin_playwright_playwright__'],
        },
        null,
        2
      )}\n`,
      'utf8'
    );

    const service = createRuntimeCapabilitiesService({ configPath });

    const next = await service.updateCapabilities({
      selectedAuthSource: 'user_claude_settings',
    });

    assert.deepEqual(next, {
      selectedAuthSource: 'user_claude_settings',
    });
    assert.deepEqual(JSON.parse(await readFile(configPath, 'utf8')), {
      selectedAuthSource: 'user_claude_settings',
    });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('runtime capabilities partial update preserves fields not explicitly changed', async () => {
  const dir = await mkdtemp(
    join(tmpdir(), 'agent-backend-v2-runtime-capabilities-partial-update-')
  );
  const configPath = join(dir, '.webmcp', 'runtime-capabilities.json');
  try {
    const service = createRuntimeCapabilitiesService({ configPath });

    await service.updateCapabilities({
      selectedAuthSource: 'user_claude_settings',
    });

    const next = await service.updateCapabilities({
      selectedAuthSource: undefined,
    });

    assert.deepEqual(next, {
      selectedAuthSource: 'user_claude_settings',
    });
    assert.deepEqual(JSON.parse(await readFile(configPath, 'utf8')), {
      selectedAuthSource: 'user_claude_settings',
    });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('runtime capabilities serialize concurrent partial updates within one service instance', async () => {
  const dir = await mkdtemp(
    join(tmpdir(), 'agent-backend-v2-runtime-capabilities-concurrent-update-')
  );
  const configPath = join(dir, '.webmcp', 'runtime-capabilities.json');
  try {
    const service = createRuntimeCapabilitiesService({ configPath });

    await Promise.all([
      service.updateCapabilities({ selectedAuthSource: 'user_claude_settings' }),
      service.updateCapabilities({}),
    ]);

    assert.deepEqual(await service.getCapabilities(), {
      selectedAuthSource: 'user_claude_settings',
    });
    assert.deepEqual(JSON.parse(await readFile(configPath, 'utf8')), {
      selectedAuthSource: 'user_claude_settings',
    });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
