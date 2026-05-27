import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, stat, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import {
  createCapability,
  deleteCapability,
  importSkillBundle,
  importSkillDirectory,
  listCapabilities,
  readCapability,
  readCapabilityFile,
  setCapabilityEnabled,
  updateCapability,
  updateCapabilityFile,
} from './capability-catalog-service.ts';

test('listCapabilities scans user, project, and plugin skills', async () => {
  const root = await mkdtemp(join(tmpdir(), 'webmcp-capabilities-'));
  const homeDir = join(root, 'home');
  const projectPath = join(root, 'project');
  const pluginPath = join(root, 'plugins', 'demo');

  await mkdir(join(homeDir, '.claude', 'skills', 'user-skill'), { recursive: true });
  await mkdir(join(projectPath, '.claude', 'skills', 'project-skill'), { recursive: true });
  await mkdir(join(pluginPath, 'skills', 'plugin-skill'), { recursive: true });
  await writeFile(
    join(homeDir, '.claude', 'skills', 'user-skill', 'SKILL.md'),
    '---\ndescription: User skill description\n---\n# User Skill\n',
    'utf8'
  );
  await writeFile(
    join(projectPath, '.claude', 'skills', 'project-skill', 'SKILL.md'),
    '# Project Skill\nProject skill description\n',
    'utf8'
  );
  await writeFile(
    join(pluginPath, 'skills', 'plugin-skill', 'SKILL.md'),
    'Plugin skill description\n',
    'utf8'
  );

  const capabilities = await listCapabilities({
    type: 'skill',
    homeDir,
    projectPath,
    pluginPaths: [pluginPath],
    pluginSources: [{ id: 'demo-plugin@local', path: pluginPath }],
    builtinSources: [],
  });

  assert.deepEqual(
    capabilities.map((capability) => ({
      name: capability.name,
      kind: capability.source.kind,
      editable: capability.editable,
      description: capability.description,
    })),
    [
      {
        name: 'user-skill',
        kind: 'user',
        editable: true,
        description: 'User skill description',
      },
      {
        name: 'project-skill',
        kind: 'project',
        editable: true,
        description: 'Project skill description',
      },
      {
        name: 'demo-plugin:plugin-skill',
        kind: 'plugin',
        editable: false,
        description: 'Plugin skill description',
      },
    ]
  );
});

test('listCapabilities scans packaged builtin skills', async () => {
  const root = await mkdtemp(join(tmpdir(), 'webmcp-builtin-capabilities-'));
  const homeDir = join(root, 'home');
  const builtinSkillsRoot = join(root, 'builtin-skills');
  const builtinPluginRoot = join(root, 'builtin-plugins', 'demo-builtin');
  await mkdir(join(builtinSkillsRoot, 'builtin-core'), { recursive: true });
  await mkdir(join(builtinPluginRoot, 'skills', 'builtin-plugin-skill'), { recursive: true });
  await writeFile(
    join(builtinSkillsRoot, 'builtin-core', 'SKILL.md'),
    '---\ndescription: Builtin core skill\n---\n# Builtin Core Skill\n',
    'utf8'
  );
  await writeFile(
    join(builtinPluginRoot, 'skills', 'builtin-plugin-skill', 'SKILL.md'),
    'Builtin plugin skill description\n',
    'utf8'
  );

  const capabilities = await listCapabilities({
    type: 'skill',
    homeDir,
    builtinSources: [
      { rootDir: builtinSkillsRoot, scanDir: builtinSkillsRoot },
      {
        rootDir: builtinPluginRoot,
        scanDir: join(builtinPluginRoot, 'skills'),
        prefix: 'demo-builtin',
      },
    ],
  });

  assert.deepEqual(
    capabilities
      .filter((capability) => capability.source.kind === 'builtin')
      .map((capability) => ({
        name: capability.name,
        kind: capability.source.kind,
        editable: capability.editable,
        enabled: capability.enabled,
      })),
    [
      {
        name: 'builtin-core',
        kind: 'builtin',
        editable: false,
        enabled: true,
      },
      {
        name: 'demo-builtin:builtin-plugin-skill',
        kind: 'builtin',
        editable: false,
        enabled: true,
      },
    ]
  );
});

test('listCapabilities skips dependency folders while scanning skills', async () => {
  const root = await mkdtemp(join(tmpdir(), 'webmcp-capability-scan-prune-'));
  const homeDir = join(root, 'home');
  const skillRoot = join(homeDir, '.claude', 'skills');

  await mkdir(join(skillRoot, 'visible-skill'), { recursive: true });
  await mkdir(join(skillRoot, 'node_modules', 'ignored-skill'), { recursive: true });
  await writeFile(join(skillRoot, 'visible-skill', 'SKILL.md'), '# Visible\n', 'utf8');
  await writeFile(
    join(skillRoot, 'node_modules', 'ignored-skill', 'SKILL.md'),
    '# Ignored\n',
    'utf8'
  );

  const capabilities = await listCapabilities({
    type: 'skill',
    homeDir,
    builtinSources: [],
  });

  assert.deepEqual(
    capabilities.map((capability) => capability.name),
    ['visible-skill']
  );
});

test('listCapabilities reuses cached scan results until forced refresh', async () => {
  const root = await mkdtemp(join(tmpdir(), 'webmcp-capability-cache-'));
  const homeDir = join(root, 'home');
  const skillRoot = join(homeDir, '.claude', 'skills');

  await mkdir(join(skillRoot, 'first-skill'), { recursive: true });
  await writeFile(join(skillRoot, 'first-skill', 'SKILL.md'), '# First\n', 'utf8');

  const first = await listCapabilities({
    type: 'skill',
    homeDir,
    builtinSources: [],
  });
  assert.deepEqual(
    first.map((capability) => capability.name),
    ['first-skill']
  );

  await mkdir(join(skillRoot, 'second-skill'), { recursive: true });
  await writeFile(join(skillRoot, 'second-skill', 'SKILL.md'), '# Second\n', 'utf8');

  const cached = await listCapabilities({
    type: 'skill',
    homeDir,
    builtinSources: [],
  });
  assert.deepEqual(
    cached.map((capability) => capability.name),
    ['first-skill']
  );

  const refreshed = await listCapabilities({
    type: 'skill',
    homeDir,
    builtinSources: [],
    forceRefresh: true,
  });
  assert.deepEqual(
    refreshed.map((capability) => capability.name),
    ['first-skill', 'second-skill']
  );
});

test('create, read, and update command capabilities in project scope', async () => {
  const root = await mkdtemp(join(tmpdir(), 'webmcp-command-capability-'));
  const homeDir = join(root, 'home');
  const projectPath = join(root, 'project');

  const created = await createCapability({
    type: 'command',
    scope: 'project',
    homeDir,
    projectPath,
    name: 'ship-it',
    content: 'Ship $ARGUMENTS',
  });

  assert.equal(created.name, 'ship-it');
  assert.equal(created.source.kind, 'project');
  assert.equal(created.editable, true);

  const detail = await readCapability({ id: created.id, homeDir, projectPath });
  assert.equal(detail.content, 'Ship $ARGUMENTS\n');

  const updated = await updateCapability({
    id: created.id,
    homeDir,
    projectPath,
    content: 'Ship safely',
  });
  const updatedDetail = await readCapability({ id: updated.id, homeDir, projectPath });
  assert.equal(updatedDetail.content, 'Ship safely\n');
});

test('setCapabilityEnabled persists disabled state for user skills', async () => {
  const root = await mkdtemp(join(tmpdir(), 'webmcp-skill-enabled-state-'));
  const homeDir = join(root, 'home');
  await mkdir(join(homeDir, '.claude', 'skills', 'toggle-me'), { recursive: true });
  await writeFile(
    join(homeDir, '.claude', 'skills', 'toggle-me', 'SKILL.md'),
    '# Toggle\n',
    'utf8'
  );

  const [capability] = await listCapabilities({
    type: 'skill',
    homeDir,
  });
  assert.equal(capability.enabled, true);

  await setCapabilityEnabled({
    id: capability.id,
    homeDir,
    enabled: false,
  });

  const [updatedCapability] = await listCapabilities({
    type: 'skill',
    homeDir,
  });
  assert.equal(updatedCapability.enabled, false);

  const detail = await readCapability({ id: capability.id, homeDir });
  assert.equal(detail.capability.enabled, false);
});

test('readCapability returns skill file tree and SKILL.md as the default file', async () => {
  const root = await mkdtemp(join(tmpdir(), 'webmcp-skill-detail-'));
  const homeDir = join(root, 'home');
  const skillDir = join(homeDir, '.claude', 'skills', 'demo-skill');

  await mkdir(join(skillDir, 'scripts'), { recursive: true });
  await writeFile(join(skillDir, 'SKILL.md'), '# Demo Skill\n', 'utf8');
  await writeFile(join(skillDir, 'LICENSE.txt'), 'demo license\n', 'utf8');
  await writeFile(join(skillDir, 'scripts', 'helper.py'), 'print("demo")\n', 'utf8');

  const [capability] = await listCapabilities({ type: 'skill', homeDir, builtinSources: [] });
  const detail = await readCapability({ id: capability.id, homeDir, builtinSources: [] });

  assert.equal(detail.selectedFilePath, 'SKILL.md');
  assert.equal(detail.content, '# Demo Skill\n');
  assert.equal(detail.rootDir, skillDir);
  assert.deepEqual(detail.files, [
    {
      path: 'scripts',
      name: 'scripts',
      kind: 'directory',
      children: [{ path: 'scripts/helper.py', name: 'helper.py', kind: 'file' }],
    },
    { path: 'LICENSE.txt', name: 'LICENSE.txt', kind: 'file' },
    { path: 'SKILL.md', name: 'SKILL.md', kind: 'file' },
  ]);
});

test('readCapabilityFile reads an existing skill child file', async () => {
  const root = await mkdtemp(join(tmpdir(), 'webmcp-read-skill-file-'));
  const homeDir = join(root, 'home');
  const skillDir = join(homeDir, '.claude', 'skills', 'demo-skill');

  await mkdir(join(skillDir, 'scripts'), { recursive: true });
  await writeFile(join(skillDir, 'SKILL.md'), '# Demo Skill\n', 'utf8');
  await writeFile(join(skillDir, 'scripts', 'helper.py'), 'print("demo")\n', 'utf8');

  const [capability] = await listCapabilities({ type: 'skill', homeDir, builtinSources: [] });
  const payload = await readCapabilityFile({
    id: capability.id,
    homeDir,
    path: 'scripts/helper.py',
    builtinSources: [],
  });

  assert.equal(payload.path, 'scripts/helper.py');
  assert.equal(payload.content, 'print("demo")\n');
  assert.equal(payload.encoding, 'utf8');
});

test('readCapabilityFile normalizes Windows-style separators in skill child paths', async () => {
  const root = await mkdtemp(join(tmpdir(), 'webmcp-read-skill-file-backslash-'));
  const homeDir = join(root, 'home');
  const skillDir = join(homeDir, '.claude', 'skills', 'demo-skill');

  await mkdir(join(skillDir, 'scripts'), { recursive: true });
  await writeFile(join(skillDir, 'SKILL.md'), '# Demo Skill\n', 'utf8');
  await writeFile(join(skillDir, 'scripts', 'helper.py'), 'print("demo")\n', 'utf8');

  const [capability] = await listCapabilities({ type: 'skill', homeDir, builtinSources: [] });
  const payload = await readCapabilityFile({
    id: capability.id,
    homeDir,
    path: 'scripts\\helper.py',
    builtinSources: [],
  });

  assert.equal(payload.path, 'scripts/helper.py');
  assert.equal(payload.content, 'print("demo")\n');
  assert.equal(payload.encoding, 'utf8');
});

test('updateCapabilityFile updates an existing writable skill child file', async () => {
  const root = await mkdtemp(join(tmpdir(), 'webmcp-update-skill-file-'));
  const homeDir = join(root, 'home');
  const skillDir = join(homeDir, '.claude', 'skills', 'demo-skill');

  await mkdir(join(skillDir, 'scripts'), { recursive: true });
  await writeFile(join(skillDir, 'SKILL.md'), '# Demo Skill\n', 'utf8');
  await writeFile(join(skillDir, 'scripts', 'helper.py'), 'print("old")\n', 'utf8');

  const [capability] = await listCapabilities({ type: 'skill', homeDir, builtinSources: [] });
  await updateCapabilityFile({
    id: capability.id,
    homeDir,
    path: 'scripts/helper.py',
    content: 'print("new")',
    builtinSources: [],
  });

  assert.equal(
    await readFile(join(skillDir, 'scripts', 'helper.py'), 'utf8'),
    'print("new")\n'
  );
  assert.equal(capability.id, (await updateCapabilityFile({
    id: capability.id,
    homeDir,
    path: 'scripts/helper.py',
    content: 'print("newer")',
    builtinSources: [],
  })).capability.id);
});

test('readCapabilityFile rejects path traversal outside the skill root', async () => {
  const root = await mkdtemp(join(tmpdir(), 'webmcp-read-skill-file-traversal-'));
  const homeDir = join(root, 'home');
  const skillDir = join(homeDir, '.claude', 'skills', 'demo-skill');

  await mkdir(skillDir, { recursive: true });
  await writeFile(join(skillDir, 'SKILL.md'), '# Demo Skill\n', 'utf8');

  const [capability] = await listCapabilities({ type: 'skill', homeDir, builtinSources: [] });
  await assert.rejects(
    () =>
      readCapabilityFile({
        id: capability.id,
        homeDir,
        path: '../outside.txt',
        builtinSources: [],
      }),
    /invalid/i
  );
});

test('updateCapabilityFile rejects read-only skill sources', async () => {
  const root = await mkdtemp(join(tmpdir(), 'webmcp-update-readonly-skill-file-'));
  const pluginPath = join(root, 'plugins', 'demo');
  const skillDir = join(pluginPath, 'skills', 'demo-skill');

  await mkdir(join(skillDir, 'scripts'), { recursive: true });
  await writeFile(join(skillDir, 'SKILL.md'), '# Demo Skill\n', 'utf8');
  await writeFile(join(skillDir, 'scripts', 'helper.py'), 'print("demo")\n', 'utf8');

  const [capability] = await listCapabilities({
    type: 'skill',
    homeDir: join(root, 'home'),
    pluginPaths: [pluginPath],
    pluginSources: [{ id: 'demo-plugin@local', path: pluginPath }],
    builtinSources: [],
  });

  await assert.rejects(
    () =>
      updateCapabilityFile({
        id: capability.id,
        homeDir: join(root, 'home'),
        path: 'scripts/helper.py',
        content: 'print("changed")',
        pluginPaths: [pluginPath],
        pluginSources: [{ id: 'demo-plugin@local', path: pluginPath }],
        builtinSources: [],
      }),
    /read-only/i
  );
});

test('updateCapabilityFile rejects builtin skill sources as read-only', async () => {
  const root = await mkdtemp(join(tmpdir(), 'webmcp-update-builtin-skill-file-'));
  const homeDir = join(root, 'home');
  const builtinSkillsRoot = join(root, 'builtin-skills');
  const skillDir = join(builtinSkillsRoot, 'demo-skill');

  await mkdir(join(skillDir, 'scripts'), { recursive: true });
  await writeFile(join(skillDir, 'SKILL.md'), '# Demo Skill\n', 'utf8');
  await writeFile(join(skillDir, 'scripts', 'helper.py'), 'print("demo")\n', 'utf8');

  const [capability] = await listCapabilities({
    type: 'skill',
    homeDir,
    builtinSources: [{ rootDir: builtinSkillsRoot, scanDir: builtinSkillsRoot }],
  });

  await assert.rejects(
    () =>
      updateCapabilityFile({
        id: capability.id,
        homeDir,
        path: 'scripts/helper.py',
        content: 'print("changed")',
        builtinSources: [{ rootDir: builtinSkillsRoot, scanDir: builtinSkillsRoot }],
      }),
    /read-only/i
  );
});

test('readCapabilityFile rejects binary skill child files for text editing', async () => {
  const root = await mkdtemp(join(tmpdir(), 'webmcp-read-binary-skill-file-'));
  const homeDir = join(root, 'home');
  const skillDir = join(homeDir, '.claude', 'skills', 'demo-skill');

  await mkdir(join(skillDir, 'assets'), { recursive: true });
  await writeFile(join(skillDir, 'SKILL.md'), '# Demo Skill\n', 'utf8');
  await writeFile(join(skillDir, 'assets', 'logo.png'), Buffer.from([0x89, 0x50, 0x4e, 0x47]));

  const [capability] = await listCapabilities({ type: 'skill', homeDir, builtinSources: [] });
  await assert.rejects(
    () =>
      readCapabilityFile({
        id: capability.id,
        homeDir,
        path: 'assets/logo.png',
        builtinSources: [],
      }),
    /text editing/i
  );
});

test('readCapabilityFile supports UTF-16 LE BOM skill child text files', async () => {
  const root = await mkdtemp(join(tmpdir(), 'webmcp-read-utf16-skill-file-'));
  const homeDir = join(root, 'home');
  const skillDir = join(homeDir, '.claude', 'skills', 'demo-skill');

  await mkdir(join(skillDir, 'scripts'), { recursive: true });
  await writeFile(join(skillDir, 'SKILL.md'), '# Demo Skill\n', 'utf8');
  await writeFile(
    join(skillDir, 'scripts', 'helper.txt'),
    Buffer.concat([
      Buffer.from([0xff, 0xfe]),
      Buffer.from('hello utf16\n', 'utf16le'),
    ])
  );

  const [capability] = await listCapabilities({ type: 'skill', homeDir, builtinSources: [] });
  const payload = await readCapabilityFile({
    id: capability.id,
    homeDir,
    path: 'scripts/helper.txt',
    builtinSources: [],
  });

  assert.equal(payload.content, 'hello utf16\n');
  assert.equal(payload.encoding, 'utf16le');
});

test('updateCapabilityFile preserves UTF-16 LE BOM encoding for skill child text files', async () => {
  const root = await mkdtemp(join(tmpdir(), 'webmcp-update-utf16-skill-file-'));
  const homeDir = join(root, 'home');
  const skillDir = join(homeDir, '.claude', 'skills', 'demo-skill');

  await mkdir(join(skillDir, 'scripts'), { recursive: true });
  await writeFile(join(skillDir, 'SKILL.md'), '# Demo Skill\n', 'utf8');
  await writeFile(
    join(skillDir, 'scripts', 'helper.txt'),
    Buffer.concat([
      Buffer.from([0xff, 0xfe]),
      Buffer.from('hello utf16\n', 'utf16le'),
    ])
  );

  const [capability] = await listCapabilities({ type: 'skill', homeDir, builtinSources: [] });
  await updateCapabilityFile({
    id: capability.id,
    homeDir,
    path: 'scripts/helper.txt',
    content: 'updated utf16',
    builtinSources: [],
  });

  const bytes = await readFile(join(skillDir, 'scripts', 'helper.txt'));
  assert.equal(bytes[0], 0xff);
  assert.equal(bytes[1], 0xfe);
  assert.equal(bytes.subarray(2).toString('utf16le'), 'updated utf16\n');
});

test('readCapabilityFile rejects symlinked child paths that escape the skill root', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'webmcp-read-symlink-skill-file-'));
  const homeDir = join(root, 'home');
  const skillDir = join(homeDir, '.claude', 'skills', 'demo-skill');
  const outsideDir = join(root, 'outside');

  await mkdir(skillDir, { recursive: true });
  await mkdir(outsideDir, { recursive: true });
  await writeFile(join(skillDir, 'SKILL.md'), '# Demo Skill\n', 'utf8');
  await writeFile(join(outsideDir, 'secret.txt'), 'top secret\n', 'utf8');
  try {
    await symlink(outsideDir, join(skillDir, 'linked'));
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === 'EPERM' || code === 'EACCES' || code === 'UNKNOWN') {
      t.skip(`symlink not available in current environment: ${code}`);
      return;
    }
    throw error;
  }

  const [capability] = await listCapabilities({ type: 'skill', homeDir, builtinSources: [] });
  await assert.rejects(
    () =>
      readCapabilityFile({
        id: capability.id,
        homeDir,
        path: 'linked/secret.txt',
        builtinSources: [],
      }),
    /symlink|invalid|outside/i
  );
});

test('updateCapability rejects plugin capabilities as read-only', async () => {
  const root = await mkdtemp(join(tmpdir(), 'webmcp-plugin-capability-'));
  const pluginPath = join(root, 'plugins', 'demo');
  await mkdir(join(pluginPath, 'commands'), { recursive: true });
  await writeFile(join(pluginPath, 'commands', 'review.md'), 'Review diff\n', 'utf8');

  const [capability] = await listCapabilities({
    type: 'command',
    homeDir: join(root, 'home'),
    pluginPaths: [pluginPath],
    pluginSources: [{ id: 'demo-plugin@local', path: pluginPath }],
  });

  await assert.rejects(
    () => updateCapability({ id: capability.id, content: 'Change it' }),
    /read-only/i
  );
});

test('importSkillDirectory copies a full skill folder into user scope', async () => {
  const root = await mkdtemp(join(tmpdir(), 'webmcp-import-skill-'));
  const homeDir = join(root, 'home');
  const sourceDir = join(root, 'source-skill');

  await mkdir(join(sourceDir, 'references'), { recursive: true });
  await mkdir(join(sourceDir, 'agents'), { recursive: true });
  await writeFile(
    join(sourceDir, 'SKILL.md'),
    '---\ndescription: demo\n---\n# Demo Skill\n',
    'utf8'
  );
  await writeFile(join(sourceDir, 'references', 'guide.md'), 'hello\n', 'utf8');
  await writeFile(
    join(sourceDir, 'agents', 'openai.yaml'),
    'interface:\n  display_name: Demo\n',
    'utf8'
  );

  const imported = await importSkillDirectory({
    homeDir,
    scope: 'user',
    sourceDir,
  });

  assert.equal(imported.name, 'source-skill');
  assert.equal(imported.source.kind, 'user');
  assert.equal(
    await readFile(join(homeDir, '.claude', 'skills', 'source-skill', 'SKILL.md'), 'utf8'),
    '---\ndescription: demo\n---\n# Demo Skill\n'
  );
  assert.equal(
    await readFile(
      join(homeDir, '.claude', 'skills', 'source-skill', 'references', 'guide.md'),
      'utf8'
    ),
    'hello\n'
  );
});

test('importSkillDirectory rejects directories without SKILL.md', async () => {
  const root = await mkdtemp(join(tmpdir(), 'webmcp-import-skill-invalid-'));
  const sourceDir = join(root, 'bad-skill');
  await mkdir(sourceDir, { recursive: true });

  await assert.rejects(
    () =>
      importSkillDirectory({
        homeDir: join(root, 'home'),
        scope: 'user',
        sourceDir,
      }),
    /SKILL\.md/i
  );
});

test('importSkillDirectory rejects conflicts with existing skill folders', async () => {
  const root = await mkdtemp(join(tmpdir(), 'webmcp-import-skill-conflict-'));
  const homeDir = join(root, 'home');
  const sourceDir = join(root, 'demo-skill');

  await mkdir(join(sourceDir), { recursive: true });
  await writeFile(join(sourceDir, 'SKILL.md'), '# Demo\n', 'utf8');
  await mkdir(join(homeDir, '.claude', 'skills', 'demo-skill'), { recursive: true });
  await writeFile(
    join(homeDir, '.claude', 'skills', 'demo-skill', 'SKILL.md'),
    '# Existing\n',
    'utf8'
  );

  await assert.rejects(
    () =>
      importSkillDirectory({
        homeDir,
        scope: 'user',
        sourceDir,
      }),
    /already exists/i
  );
});

test('importSkillBundle writes dropped skill files without needing a source directory', async () => {
  const root = await mkdtemp(join(tmpdir(), 'webmcp-import-skill-bundle-'));
  const homeDir = join(root, 'home');

  const imported = await importSkillBundle({
    homeDir,
    scope: 'user',
    name: 'bundle-skill',
    files: [
      {
        path: 'SKILL.md',
        contentBase64: Buffer.from(
          '---\ndescription: bundle\n---\n# Bundle Skill\n',
          'utf8'
        ).toString('base64'),
      },
      {
        path: 'references/guide.md',
        contentBase64: Buffer.from('hello bundle\n', 'utf8').toString('base64'),
      },
    ],
  });

  assert.equal(imported.name, 'bundle-skill');
  assert.equal(
    await readFile(join(homeDir, '.claude', 'skills', 'bundle-skill', 'SKILL.md'), 'utf8'),
    '---\ndescription: bundle\n---\n# Bundle Skill\n'
  );
  assert.equal(
    await readFile(
      join(homeDir, '.claude', 'skills', 'bundle-skill', 'references', 'guide.md'),
      'utf8'
    ),
    'hello bundle\n'
  );
});

test('importSkillBundle preserves empty files in dropped skill directories', async () => {
  const root = await mkdtemp(join(tmpdir(), 'webmcp-import-skill-bundle-empty-file-'));
  const homeDir = join(root, 'home');

  const imported = await importSkillBundle({
    homeDir,
    scope: 'user',
    name: 'empty-file-skill',
    files: [
      {
        path: 'SKILL.md',
        contentBase64: Buffer.from(
          '---\ndescription: empty file bundle\n---\n# Empty File Bundle Skill\n',
          'utf8'
        ).toString('base64'),
      },
      {
        path: 'scripts/office/helpers/__init__.py',
        contentBase64: '',
      },
    ],
  });

  assert.equal(imported.name, 'empty-file-skill');
  assert.equal(
    await readFile(
      join(
        homeDir,
        '.claude',
        'skills',
        'empty-file-skill',
        'scripts',
        'office',
        'helpers',
        '__init__.py'
      ),
      'utf8'
    ),
    ''
  );
});

test('deleteCapability removes the whole skill directory and nested files', async () => {
  const root = await mkdtemp(join(tmpdir(), 'webmcp-delete-skill-directory-'));
  const homeDir = join(root, 'home');
  const skillDir = join(homeDir, '.claude', 'skills', 'delete-me');

  await mkdir(join(skillDir, 'references'), { recursive: true });
  await writeFile(join(skillDir, 'SKILL.md'), '# Delete Me\n', 'utf8');
  await writeFile(join(skillDir, 'SKILL.md.bak'), '# Backup\n', 'utf8');
  await writeFile(join(skillDir, 'references', 'guide.md'), 'nested\n', 'utf8');

  const [capability] = await listCapabilities({
    type: 'skill',
    homeDir,
  });

  await deleteCapability({
    id: capability.id,
    homeDir,
  });

  await assert.rejects(() => stat(skillDir), /ENOENT/);
});

test('deleteCapability clears disabled state so recreated same-name skills default to enabled', async () => {
  const root = await mkdtemp(join(tmpdir(), 'webmcp-delete-skill-state-'));
  const homeDir = join(root, 'home');
  const stateFile = join(homeDir, '.claude', 'capability-state.json');
  const stateKey = '.claude/skills/toggle-me/SKILL.md';

  const created = await createCapability({
    type: 'skill',
    scope: 'user',
    homeDir,
    name: 'toggle-me',
    content: '# Toggle Me',
  });

  await setCapabilityEnabled({
    id: created.id,
    homeDir,
    enabled: false,
  });

  const disabledState = JSON.parse(await readFile(stateFile, 'utf8')) as {
    skills?: Record<string, boolean>;
  };
  assert.equal(disabledState.skills?.[stateKey], false);

  await deleteCapability({
    id: created.id,
    homeDir,
  });

  const clearedState = JSON.parse(await readFile(stateFile, 'utf8')) as {
    skills?: Record<string, boolean>;
  };
  assert.equal(clearedState.skills?.[stateKey], undefined);

  const recreated = await createCapability({
    type: 'skill',
    scope: 'user',
    homeDir,
    name: 'toggle-me',
    content: '# Toggle Me Recreated',
  });

  const detail = await readCapability({ id: recreated.id, homeDir });
  assert.equal(detail.capability.enabled, true);
});
