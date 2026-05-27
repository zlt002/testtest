import assert from 'node:assert/strict';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import test from 'node:test';
import { createCommandsService } from './commands-service.ts';
import { setCapabilityEnabledState } from '../management/capability-state-store.ts';
import {
  clearCapabilityCatalogCache,
  listCapabilities,
} from '../management/capability-catalog-service.ts';

test('listCommands returns local UI, project, user, and Claude skill commands', async () => {
  const root = await mkdtemp(join(tmpdir(), 'webmcp-commands-'));
  const homeDir = join(root, 'home');
  const projectPath = join(root, 'project');
  const pluginPath = join(root, 'plugins', 'demo-plugin');
  const builtinSkillRoot = join(root, 'builtin-skills');
  await mkdir(join(projectPath, '.claude', 'commands'), { recursive: true });
  await mkdir(join(projectPath, '.claude', 'skills', 'brainstorming'), { recursive: true });
  await mkdir(join(homeDir, '.claude', 'commands'), { recursive: true });
  await mkdir(join(homeDir, '.claude', 'skills', 'debug-workflow'), { recursive: true });
  await mkdir(join(builtinSkillRoot, 'builtin-core-skill'), { recursive: true });
  await mkdir(join(pluginPath, 'skills', 'plugin-workflow'), { recursive: true });
  await writeFile(
    join(projectPath, '.claude', 'commands', 'deploy.md'),
    '---\ndescription: Deploy current project\n---\nDeploy $ARGUMENTS\n',
    'utf8'
  );
  await writeFile(
    join(homeDir, '.claude', 'commands', 'review.md'),
    '# Review\nReview the current diff\n',
    'utf8'
  );
  await writeFile(
    join(homeDir, '.claude', 'skills', 'debug-workflow', 'SKILL.md'),
    '---\ndescription: Debug failing behavior\n---\n# Debug Workflow\n',
    'utf8'
  );
  await writeFile(
    join(projectPath, '.claude', 'skills', 'brainstorming', 'SKILL.md'),
    '---\ndescription: Explore user intent before implementation\n---\n# Brainstorming\n',
    'utf8'
  );
  await writeFile(
    join(builtinSkillRoot, 'builtin-core-skill', 'SKILL.md'),
    '---\ndescription: Builtin packaged skill\n---\n# Builtin Core Skill\n',
    'utf8'
  );
  await writeFile(
    join(pluginPath, 'skills', 'plugin-workflow', 'SKILL.md'),
    '---\ndescription: Plugin powered workflow\n---\n# Plugin Workflow\n',
    'utf8'
  );

  const service = createCommandsService({
    homeDir,
    builtinSkillSources: [{ rootDir: builtinSkillRoot }],
  });
  const catalog = await service.listCommands({
    projectPath,
    pluginPaths: [pluginPath],
    pluginSources: [{ id: 'demo-plugin@local', path: pluginPath }],
  });

  assert.equal(
    catalog.localUi.some((command) => command.name === '/clear'),
    true
  );
  assert.equal(
    catalog.project.some((command) => command.name === '/deploy'),
    true
  );
  assert.equal(
    catalog.user.some((command) => command.name === '/review'),
    true
  );
  assert.equal(
    catalog.skills.some((command) => command.name === '/debug-workflow'),
    true
  );
  assert.equal(
    catalog.skills.some((command) => command.name === '/brainstorming'),
    true
  );
  assert.equal(
    catalog.skills.some((command) => command.name === '/demo-plugin:plugin-workflow'),
    true
  );
  assert.equal(
    catalog.skills.some((command) => command.name === '/builtin-core-skill'),
    true
  );
  assert.equal(
    catalog.count,
    catalog.localUi.length +
      catalog.project.length +
      catalog.user.length +
      catalog.plugin.length +
      catalog.skills.length
  );
});

test('listCommands includes plugin markdown commands with plugin-prefixed slash names', async () => {
  const root = await mkdtemp(join(tmpdir(), 'webmcp-command-plugin-markdown-'));
  const homeDir = join(root, 'home');
  const pluginPath = join(root, 'plugins', 'demo-plugin');
  await mkdir(join(pluginPath, 'commands', 'release'), { recursive: true });
  await writeFile(
    join(pluginPath, 'commands', 'release', 'publish.md'),
    '---\ndescription: Publish the current release\n---\n# Publish release\n',
    'utf8'
  );

  const service = createCommandsService({ homeDir });
  const catalog = await service.listCommands({
    pluginSources: [{ id: 'demo-plugin@local', path: pluginPath }],
  });

  assert.equal(
    catalog.plugin.some(
      (command) =>
        command.name === '/demo-plugin:release/publish' &&
        command.namespace === 'plugin' &&
        command.metadata.group === 'plugin'
    ),
    true
  );
  assert.equal(
    catalog.count,
    catalog.localUi.length +
      catalog.project.length +
      catalog.user.length +
      catalog.plugin.length +
      catalog.skills.length
  );
});

test('listCommands skips dependency folders while scanning skills and commands', async () => {
  const root = await mkdtemp(join(tmpdir(), 'webmcp-command-scan-prune-'));
  const homeDir = join(root, 'home');
  const pluginPath = join(root, 'plugins', 'demo-plugin');

  await mkdir(join(homeDir, '.claude', 'skills', 'visible-skill'), { recursive: true });
  await mkdir(join(homeDir, '.claude', 'skills', 'node_modules', 'ignored-skill'), {
    recursive: true,
  });
  await mkdir(join(pluginPath, 'commands'), { recursive: true });
  await mkdir(join(pluginPath, 'commands', 'node_modules'), { recursive: true });
  await writeFile(
    join(homeDir, '.claude', 'skills', 'visible-skill', 'SKILL.md'),
    '# Visible\n',
    'utf8'
  );
  await writeFile(
    join(homeDir, '.claude', 'skills', 'node_modules', 'ignored-skill', 'SKILL.md'),
    '# Ignored\n',
    'utf8'
  );
  await writeFile(join(pluginPath, 'commands', 'publish.md'), '# Publish\n', 'utf8');
  await writeFile(
    join(pluginPath, 'commands', 'node_modules', 'ignored.md'),
    '# Ignored\n',
    'utf8'
  );

  const service = createCommandsService({ homeDir });
  const catalog = await service.listCommands({
    pluginSources: [{ id: 'demo-plugin@local', path: pluginPath }],
  });

  assert.equal(
    catalog.skills.some((command) => command.name === '/visible-skill'),
    true
  );
  assert.equal(
    catalog.skills.some((command) => command.name === '/ignored-skill'),
    false
  );
  assert.equal(
    catalog.plugin.some((command) => command.name === '/demo-plugin:publish'),
    true
  );
  assert.equal(
    catalog.plugin.some((command) => command.name === '/demo-plugin:node_modules/ignored'),
    false
  );
});

test('listCommands reuses cached catalog until forced refresh', async () => {
  const root = await mkdtemp(join(tmpdir(), 'webmcp-command-cache-'));
  const homeDir = join(root, 'home');
  const commandsRoot = join(homeDir, '.claude', 'commands');

  await mkdir(commandsRoot, { recursive: true });
  await writeFile(join(commandsRoot, 'first.md'), '# First\n', 'utf8');

  const service = createCommandsService({ homeDir, builtinSkillSources: [] });
  const first = await service.listCommands();
  assert.deepEqual(
    first.user.map((command) => command.name),
    ['/first']
  );

  await writeFile(join(commandsRoot, 'second.md'), '# Second\n', 'utf8');

  const cached = await service.listCommands();
  assert.deepEqual(
    cached.user.map((command) => command.name),
    ['/first']
  );

  const refreshed = await service.listCommands({ forceRefresh: true });
  assert.deepEqual(
    refreshed.user.map((command) => command.name),
    ['/first', '/second']
  );
});

test('listCommands reuses the shared skill capability cache', async () => {
  clearCapabilityCatalogCache();
  const root = await mkdtemp(join(tmpdir(), 'webmcp-command-shared-skill-cache-'));
  const homeDir = join(root, 'home');
  const skillRoot = join(homeDir, '.claude', 'skills');

  await mkdir(join(skillRoot, 'first-skill'), { recursive: true });
  await writeFile(join(skillRoot, 'first-skill', 'SKILL.md'), '# First\n', 'utf8');

  await listCapabilities({
    type: 'skill',
    homeDir,
    builtinSources: [],
  });
  await mkdir(join(skillRoot, 'second-skill'), { recursive: true });
  await writeFile(join(skillRoot, 'second-skill', 'SKILL.md'), '# Second\n', 'utf8');

  const service = createCommandsService({ homeDir, builtinSkillSources: [] });
  const cached = await service.listCommands();
  assert.deepEqual(
    cached.skills.map((command) => command.name),
    ['/first-skill']
  );

  const refreshed = await service.listCommands({ forceRefresh: true });
  assert.deepEqual(
    refreshed.skills.map((command) => command.name),
    ['/first-skill', '/second-skill']
  );
  clearCapabilityCatalogCache();
});

test('listCommands deduplicates same skill name and prefers builtin skill over user skill', async () => {
  const root = await mkdtemp(join(tmpdir(), 'webmcp-command-builtin-priority-'));
  const homeDir = join(root, 'home');
  const builtinSkillRoot = join(root, 'builtin-skills');
  await mkdir(join(homeDir, '.claude', 'skills', 'ewankb-server-query'), { recursive: true });
  await mkdir(join(builtinSkillRoot, 'ewankb-server-query'), { recursive: true });
  await writeFile(
    join(homeDir, '.claude', 'skills', 'ewankb-server-query', 'SKILL.md'),
    '---\ndescription: User version\n---\n# User Skill\n',
    'utf8'
  );
  await writeFile(
    join(builtinSkillRoot, 'ewankb-server-query', 'SKILL.md'),
    '---\ndescription: Builtin version\n---\n# Builtin Skill\n',
    'utf8'
  );

  const service = createCommandsService({
    homeDir,
    builtinSkillSources: [{ rootDir: builtinSkillRoot }],
  });
  const catalog = await service.listCommands();
  const matches = catalog.skills.filter((command) => command.name === '/ewankb-server-query');

  assert.equal(matches.length, 1);
  assert.equal(matches[0].description, 'Builtin version');
  assert.equal(matches[0].path, join(builtinSkillRoot, 'ewankb-server-query', 'SKILL.md'));
});

test('executeCommand expands custom markdown command arguments', async () => {
  const root = await mkdtemp(join(tmpdir(), 'webmcp-command-exec-'));
  const homeDir = join(root, 'home');
  const projectPath = join(root, 'project');
  const commandPath = join(projectPath, '.claude', 'commands', 'deploy.md');
  await mkdir(join(projectPath, '.claude', 'commands'), { recursive: true });
  await writeFile(commandPath, 'Deploy $1 to $2. Args: $ARGUMENTS', 'utf8');

  const service = createCommandsService({ homeDir, skillRoots: [] });
  const result = await service.executeCommand({
    commandName: '/deploy',
    commandPath,
    args: ['api', 'prod'],
    context: { projectPath },
  });

  assert.equal(result.type, 'custom');
  assert.equal(result.content, 'Deploy api to prod. Args: api prod');
});

test('executeCommand expands skill files into an explicit skill prompt with user arguments', async () => {
  const root = await mkdtemp(join(tmpdir(), 'webmcp-skill-exec-'));
  const homeDir = join(root, 'home');
  const skillPath = join(homeDir, '.claude', 'skills', 'ewankb-server-query', 'SKILL.md');
  await mkdir(join(homeDir, '.claude', 'skills', 'ewankb-server-query'), { recursive: true });
  await writeFile(
    skillPath,
    '---\ndescription: Query ewankb\n---\n# ewankb-server-query\n\n请使用 ewankb 服务回答问题。\n',
    'utf8'
  );

  const service = createCommandsService({ homeDir });
  const result = await service.executeCommand({
    commandName: '/ewankb-server-query',
    commandPath: skillPath,
    args: ['查询', '订单状态'],
  });

  assert.equal(result.type, 'custom');
  assert.match(result.content, /你必须优先遵循下面这个 skill/);
  assert.match(result.content, /请使用 ewankb 服务回答问题。/);
  assert.match(result.content, /请使用上面的 skill 完成以下请求：\n查询 订单状态/);
});

test('executeCommand allows builtin skill commands discovered from builtin skill sources', async () => {
  const root = await mkdtemp(join(tmpdir(), 'webmcp-builtin-skill-exec-'));
  const homeDir = join(root, 'home');
  const builtinSkillRoot = join(root, 'builtin-skills');
  const skillPath = join(builtinSkillRoot, 'ewankb-server-query', 'SKILL.md');
  await mkdir(join(builtinSkillRoot, 'ewankb-server-query'), { recursive: true });
  await writeFile(
    skillPath,
    '---\ndescription: Builtin ewankb query\n---\n# ewankb-server-query\n\n请查询知识库。\n',
    'utf8'
  );

  const service = createCommandsService({
    homeDir,
    builtinSkillSources: [{ rootDir: builtinSkillRoot }],
  });
  const result = await service.executeCommand({
    commandName: '/ewankb-server-query',
    commandPath: skillPath,
    args: ['graph', 'mall', '付款额度'],
  });

  assert.equal(result.type, 'custom');
  assert.match(result.content, /请查询知识库。/);
  assert.match(result.content, /graph mall 付款额度/);
});

test('listCommands hides disabled user skills from the skill command catalog', async () => {
  const root = await mkdtemp(join(tmpdir(), 'webmcp-command-disable-skill-'));
  const homeDir = join(root, 'home');
  await mkdir(join(homeDir, '.claude', 'skills', 'hidden-skill'), { recursive: true });
  await mkdir(join(homeDir, '.claude', 'skills', 'visible-skill'), { recursive: true });
  await writeFile(
    join(homeDir, '.claude', 'skills', 'hidden-skill', 'SKILL.md'),
    '# Hidden\n',
    'utf8'
  );
  await writeFile(
    join(homeDir, '.claude', 'skills', 'visible-skill', 'SKILL.md'),
    '# Visible\n',
    'utf8'
  );
  await setCapabilityEnabledState({
    type: 'skill',
    rootDir: homeDir,
    filepath: join(homeDir, '.claude', 'skills', 'hidden-skill', 'SKILL.md'),
    enabled: false,
  });

  const service = createCommandsService({ homeDir });
  const catalog = await service.listCommands();

  assert.equal(
    catalog.skills.some((command) => command.name === '/hidden-skill'),
    false
  );
  assert.equal(
    catalog.skills.some((command) => command.name === '/visible-skill'),
    true
  );
});

test('listCommands keeps default builtin skills when extra builtin skill sources are configured', async () => {
  const root = await mkdtemp(join(tmpdir(), 'webmcp-command-extra-builtin-'));
  const homeDir = join(root, 'home');
  const extraBuiltinSkillRoot = join(root, 'extra-builtin-skills');
  await mkdir(join(extraBuiltinSkillRoot, 'extra-global-skill'), { recursive: true });
  await writeFile(
    join(extraBuiltinSkillRoot, 'extra-global-skill', 'SKILL.md'),
    '---\ndescription: Extra global skill\n---\n# Extra Global Skill\n',
    'utf8'
  );

  const defaultService = createCommandsService({ homeDir });
  const defaultCatalog = await defaultService.listCommands({ forceRefresh: true });

  const serviceWithExtraBuiltin = createCommandsService({
    homeDir,
    builtinSkillSources: [{ rootDir: extraBuiltinSkillRoot }],
  });
  const catalogWithExtraBuiltin = await serviceWithExtraBuiltin.listCommands({
    forceRefresh: true,
  });

  for (const command of defaultCatalog.skills) {
    assert.equal(
      catalogWithExtraBuiltin.skills.some((item) => item.name === command.name),
      true,
      `expected extra builtin catalog to retain default skill command ${command.name}`
    );
  }
  assert.equal(
    catalogWithExtraBuiltin.skills.some((command) => command.name === '/extra-global-skill'),
    true
  );
});
