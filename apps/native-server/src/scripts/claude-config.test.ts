import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  DEFAULT_EWANKB_SERVER_CONFIG,
  DEFAULT_EWANKB_SERVER_NAME,
  ensureDefaultClaudeMcpServer,
  mergeDefaultClaudeMcpServer,
} from './claude-config';

test('在空配置中创建默认 ewankb-server', () => {
  const merged = mergeDefaultClaudeMcpServer({});

  assert.deepEqual(merged, {
    mcpServers: {
      [DEFAULT_EWANKB_SERVER_NAME]: DEFAULT_EWANKB_SERVER_CONFIG,
    },
  });
});

test('保留其他字段并覆盖同名 ewankb-server 配置', () => {
  const merged = mergeDefaultClaudeMcpServer({
    theme: 'dark',
    mcpServers: {
      existing: { command: 'node', args: ['server.js'] },
      [DEFAULT_EWANKB_SERVER_NAME]: {
        disabled: true,
        type: 'http',
        transport: 'http',
        url: 'http://127.0.0.1:9999/mcp',
      },
    },
  });

  assert.deepEqual(merged, {
    theme: 'dark',
    mcpServers: {
      existing: { command: 'node', args: ['server.js'] },
      [DEFAULT_EWANKB_SERVER_NAME]: DEFAULT_EWANKB_SERVER_CONFIG,
    },
  });
});

test('把默认服务写入 ~/.claude.json 文件', async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), 'claude-config-test-'));
  const configPath = path.join(tempDir, '.claude.json');
  await writeFile(configPath, JSON.stringify({ editor: 'vim' }, null, 2));

  await ensureDefaultClaudeMcpServer(configPath);

  const written = JSON.parse(await readFile(configPath, 'utf8'));
  assert.deepEqual(written, {
    editor: 'vim',
    mcpServers: {
      [DEFAULT_EWANKB_SERVER_NAME]: DEFAULT_EWANKB_SERVER_CONFIG,
    },
  });
});

test('当 ~/.claude.json 不存在时自动创建并写入默认服务', async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), 'claude-config-create-test-'));
  const configPath = path.join(tempDir, '.claude.json');

  await ensureDefaultClaudeMcpServer(configPath);

  const written = JSON.parse(await readFile(configPath, 'utf8'));
  assert.deepEqual(written, {
    mcpServers: {
      [DEFAULT_EWANKB_SERVER_NAME]: DEFAULT_EWANKB_SERVER_CONFIG,
    },
  });
});
