import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { createWorkspaceService, resolveDefaultWorkspacePath } from './workspace-service.ts';

test('resolveDefaultWorkspacePath places the default workspace under workspace/project', () => {
  assert.equal(
    resolveDefaultWorkspacePath('/opt/accr-ui'),
    join('/opt/accr-ui', 'workspace', 'project')
  );
});

test('workspace service persists, renames, filters missing paths, and deletes manual workspaces', async () => {
  const root = await mkdtemp(join(tmpdir(), 'agent-backend-v2-workspaces-'));
  const projectPath = join(root, 'project');
  const missingPath = join(root, 'missing');
  const configPath = join(root, '.webmcp', 'workspaces.json');
  await mkdir(projectPath, { recursive: true });

  const service = createWorkspaceService({ configPath });
  await service.addWorkspace({ projectPath, name: 'Original' });
  await service.addWorkspace({ projectPath: missingPath, name: 'Missing' }).catch(() => null);

  assert.deepEqual(
    (await service.listProjects()).map((project) => ({
      projectPath: project.projectPath,
      name: project.name,
      sessionCount: project.sessionCount,
    })),
    [{ projectPath, name: 'Original', sessionCount: 0 }]
  );

  await service.renameWorkspace({ projectPath, name: 'Renamed' });
  assert.equal((await service.listProjects())[0].name, 'Renamed');
  assert.match(await readFile(configPath, 'utf8'), /Renamed/);

  await service.deleteWorkspace({ projectPath });
  assert.deepEqual(await service.listProjects(), []);
  assert.deepEqual(await service.listHiddenProjectPaths(), [projectPath]);
  assert.equal((await stat(projectPath)).isDirectory(), true);

  await service.addWorkspace({ projectPath, name: 'Re-added' });
  assert.deepEqual(await service.listHiddenProjectPaths(), []);

  await rm(root, { recursive: true, force: true });
});

test('workspace service reuses cached manual workspace existence checks until forced refresh', async () => {
  const root = await mkdtemp(join(tmpdir(), 'agent-backend-v2-workspaces-cache-'));
  const projectPath = join(root, 'project');
  const configPath = join(root, '.webmcp', 'workspaces.json');
  await mkdir(projectPath, { recursive: true });

  const service = createWorkspaceService({ configPath });
  await service.addWorkspace({ projectPath, name: 'Cached' });
  assert.deepEqual(
    (await service.listProjects()).map((project) => project.projectPath),
    [projectPath]
  );

  await rm(projectPath, { recursive: true, force: true });
  assert.deepEqual(
    (await service.listProjects()).map((project) => project.projectPath),
    [projectPath]
  );
  assert.deepEqual(await service.listProjects({ forceRefresh: true }), []);

  await rm(root, { recursive: true, force: true });
});

test('workspace service removes the physical directory when deleteDirectory is enabled', async () => {
  const root = await mkdtemp(join(tmpdir(), 'agent-backend-v2-workspaces-delete-dir-'));
  const projectPath = join(root, 'project');
  const configPath = join(root, '.webmcp', 'workspaces.json');
  await mkdir(projectPath, { recursive: true });

  const service = createWorkspaceService({ configPath });
  await service.addWorkspace({ projectPath, name: 'Original' });

  await service.deleteWorkspace({ projectPath, deleteDirectory: true });
  assert.deepEqual(await service.listProjects(), []);
  await assert.rejects(() => stat(projectPath), { code: 'ENOENT' });

  await rm(root, { recursive: true, force: true });
});

test('workspace service browses child folders and normalizes home alias', async () => {
  const root = await mkdtemp(join(tmpdir(), 'agent-backend-v2-browse-'));
  const alphaPath = join(root, 'alpha');
  const betaPath = join(root, 'beta');
  const hiddenPath = join(root, '.hidden');
  const nestedFilePath = join(root, 'note.txt');
  const configPath = join(root, '.webmcp', 'workspaces.json');

  await mkdir(alphaPath, { recursive: true });
  await mkdir(betaPath, { recursive: true });
  await mkdir(hiddenPath, { recursive: true });
  await writeFile(nestedFilePath, 'note', 'utf8');

  const service = createWorkspaceService({ configPath });
  const result = await service.browseFolders({ path: root });

  assert.equal(result.path, root);
  assert.equal(result.parentPath, join(root, '..'));
  assert.deepEqual(
    result.folders.map((folder) => folder.name),
    ['.hidden', 'alpha', 'beta']
  );
  assert.equal(
    result.folders.every((folder) => folder.path.startsWith(root)),
    true
  );

  await rm(root, { recursive: true, force: true });
});

test('workspace service creates folders inside the browsed directory', async () => {
  const root = await mkdtemp(join(tmpdir(), 'agent-backend-v2-create-folder-'));
  const parentPath = join(root, 'parent');
  const configPath = join(root, '.webmcp', 'workspaces.json');

  await mkdir(parentPath, { recursive: true });

  const service = createWorkspaceService({ configPath });
  await service.createFolder({ parentPath, name: 'new-folder' });

  const result = await service.browseFolders({ path: parentPath });
  assert.deepEqual(
    result.folders.map((folder) => folder.name),
    ['new-folder']
  );

  await rm(root, { recursive: true, force: true });
});

test('workspace service returns selected folder from system picker when available', async () => {
  const root = await mkdtemp(join(tmpdir(), 'agent-backend-v2-pick-folder-'));
  const configPath = join(root, '.webmcp', 'workspaces.json');
  const selectedPath = join(root, 'picked-workspace');
  await mkdir(selectedPath, { recursive: true });

  const service = createWorkspaceService({
    configPath,
    pickFolder: async () => selectedPath,
  });

  assert.deepEqual(await service.pickFolder(), {
    projectPath: selectedPath,
  });

  await rm(root, { recursive: true, force: true });
});

test('workspace service returns null when system picker is cancelled', async () => {
  const root = await mkdtemp(join(tmpdir(), 'agent-backend-v2-pick-folder-cancelled-'));
  const configPath = join(root, '.webmcp', 'workspaces.json');

  const service = createWorkspaceService({
    configPath,
    pickFolder: async () => null,
  });

  assert.deepEqual(await service.pickFolder(), {
    projectPath: null,
  });

  await rm(root, { recursive: true, force: true });
});

test('workspace service auto-registers the default workspace when it exists', async () => {
  const root = await mkdtemp(join(tmpdir(), 'agent-backend-v2-default-workspace-'));
  const defaultWorkspacePath = join(root, 'workspace', 'project');
  const configPath = join(root, '.webmcp', 'workspaces.json');
  await mkdir(defaultWorkspacePath, { recursive: true });

  const service = createWorkspaceService({
    configPath,
    defaultWorkspacePath,
  });

  assert.deepEqual(
    (await service.listProjects()).map((project) => ({
      projectPath: project.projectPath,
      name: project.name,
    })),
    [
      {
        projectPath: defaultWorkspacePath,
        name: 'project',
      },
    ]
  );
  assert.match(await readFile(configPath, 'utf8'), /"projectPath":/);

  await rm(root, { recursive: true, force: true });
});

test('workspace service does not restore a hidden default workspace', async () => {
  const root = await mkdtemp(join(tmpdir(), 'agent-backend-v2-hidden-default-workspace-'));
  const defaultWorkspacePath = join(root, 'workspace', 'project');
  const configPath = join(root, '.webmcp', 'workspaces.json');
  await mkdir(defaultWorkspacePath, { recursive: true });
  await mkdir(join(root, '.webmcp'), { recursive: true });
  await writeFile(
    configPath,
    JSON.stringify({ workspaces: [], hiddenProjectPaths: [defaultWorkspacePath] }, null, 2),
    'utf8'
  );

  const service = createWorkspaceService({
    configPath,
    defaultWorkspacePath,
  });

  assert.deepEqual(await service.listProjects(), []);

  await rm(root, { recursive: true, force: true });
});
