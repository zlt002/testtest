import assert from 'node:assert/strict';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { getHooksOverview } from './hooks-overview-service.ts';

test('getHooksOverview returns user, project, and local settings sources', async () => {
  const root = await mkdtemp(join(tmpdir(), 'webmcp-hooks-'));
  const homeDir = join(root, 'home');
  const projectPath = join(root, 'project');
  await mkdir(join(homeDir, '.claude'), { recursive: true });
  await mkdir(join(projectPath, '.claude'), { recursive: true });
  await writeFile(
    join(homeDir, '.claude', 'settings.json'),
    JSON.stringify({
      hooks: { Stop: [{ matcher: '', hooks: [{ type: 'command', command: 'echo user' }] }] },
    }),
    'utf8'
  );
  await writeFile(
    join(projectPath, '.claude', 'settings.json'),
    JSON.stringify({ hooks: { PreToolUse: [] } }),
    'utf8'
  );

  const overview = await getHooksOverview({ homeDir, projectPath });

  assert.deepEqual(
    overview.sources.map((source) => ({
      id: source.id,
      kind: source.kind,
      label: source.label,
      writable: source.writable,
      hookEventCount: source.hookEventCount,
      hasFile: source.hasFile,
    })),
    [
      {
        id: 'user',
        kind: 'user',
        label: 'User settings',
        writable: true,
        hookEventCount: 1,
        hasFile: true,
      },
      {
        id: 'project',
        kind: 'project',
        label: 'Project settings',
        writable: true,
        hookEventCount: 1,
        hasFile: true,
      },
      {
        id: 'local',
        kind: 'local',
        label: 'Local project settings',
        writable: true,
        hookEventCount: 0,
        hasFile: false,
      },
    ]
  );
  assert.equal(overview.sources[0].rawJson.includes('"Stop"'), true);
});

test('getHooksOverview reuses cached settings until forced refresh', async () => {
  const root = await mkdtemp(join(tmpdir(), 'webmcp-hooks-cache-'));
  const homeDir = join(root, 'home');
  const projectPath = join(root, 'project');
  const settingsPath = join(projectPath, '.claude', 'settings.json');
  await mkdir(join(homeDir, '.claude'), { recursive: true });
  await mkdir(join(projectPath, '.claude'), { recursive: true });
  await writeFile(join(homeDir, '.claude', 'settings.json'), '{}', 'utf8');
  await writeFile(settingsPath, JSON.stringify({ hooks: { PreToolUse: [] } }), 'utf8');

  const first = await getHooksOverview({ homeDir, projectPath });
  assert.equal(first.sources[1].hookEventCount, 1);

  await writeFile(settingsPath, JSON.stringify({ hooks: { PreToolUse: [], Stop: [] } }), 'utf8');

  const cached = await getHooksOverview({ homeDir, projectPath });
  assert.equal(cached.sources[1].hookEventCount, 1);

  const refreshed = await getHooksOverview({ homeDir, projectPath, forceRefresh: true });
  assert.equal(refreshed.sources[1].hookEventCount, 2);
});
