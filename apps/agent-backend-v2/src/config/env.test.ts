import assert from 'node:assert/strict';
import { normalize } from 'node:path';
import test from 'node:test';
import { loadEnv } from './env.ts';

test('loadEnv returns defaults for local backend v2 development', () => {
  const env = loadEnv({});

  assert.equal(env.host, '127.0.0.1');
  assert.equal(env.port, 8792);
  assert.equal(
    normalize(env.workdir).toLowerCase().endsWith(normalize('webmcp').toLowerCase()),
    true
  );
  assert.equal(env.enableBrowserExtensionMcp, true);
  assert.equal(env.browserExtensionMcpUrl, 'http://127.0.0.1:12306/mcp');
  assert.equal(env.model, null);
});

test('loadEnv parses explicit port, workdir, model, and browser MCP settings', () => {
  const env = loadEnv({
    CLAUDE_AGENT_V2_HOST: '0.0.0.0',
    CLAUDE_AGENT_V2_PORT: '9999',
    CLAUDE_AGENT_V2_WORKDIR: '/tmp/demo',
    CLAUDE_AGENT_V2_MODEL: 'claude-sonnet-4-5',
    CLAUDE_ENABLE_EXTENSION_MCP: ' FALSE ',
    CLAUDE_EXTENSION_MCP_URL: 'http://127.0.0.1:4567/mcp',
  });

  assert.equal(env.host, '0.0.0.0');
  assert.equal(env.port, 9999);
  assert.equal(env.workdir, '/tmp/demo');
  assert.equal(env.model, 'claude-sonnet-4-5');
  assert.equal(env.enableBrowserExtensionMcp, false);
  assert.equal(env.browserExtensionMcpUrl, 'http://127.0.0.1:4567/mcp');
});

test('loadEnv parses global skill roots from a path list', () => {
  const env = loadEnv({
    CLAUDE_AGENT_V2_GLOBAL_SKILL_ROOTS:
      'C:\\Users\\Administrator\\Desktop\\kkk002\\workspace;D:\\shared\\skills;; ',
  });

  assert.deepEqual(env.globalSkillRoots, [
    'C:\\Users\\Administrator\\Desktop\\kkk002\\workspace',
    'D:\\shared\\skills',
  ]);
});

test('loadEnv rejects invalid ports', () => {
  assert.throws(
    () => loadEnv({ CLAUDE_AGENT_V2_PORT: 'abc' }),
    /CLAUDE_AGENT_V2_PORT must be an integer/
  );
});

test('loadEnv rejects invalid boolean values', () => {
  assert.throws(
    () => loadEnv({ CLAUDE_ENABLE_EXTENSION_MCP: 'maybe' }),
    /CLAUDE_ENABLE_EXTENSION_MCP must be true or false/
  );
});

test('loadEnv keeps live write preview diagnostics disabled by default and parses opt-in flag', () => {
  const disabled = loadEnv(
    {},
    {
      exists: () => false,
      resolveFromPath: () => null,
      platform: 'win32',
    }
  );
  assert.equal(disabled.enableLiveWritePreviewDiagnostics, false);

  const enabled = loadEnv(
    { CLAUDE_AGENT_V2_LIVE_WRITE_PREVIEW_DIAGNOSTICS: 'true' },
    {
      exists: () => false,
      resolveFromPath: () => null,
      platform: 'win32',
    }
  );
  assert.equal(enabled.enableLiveWritePreviewDiagnostics, true);
});

test('loadEnv uses explicit CLAUDE_CODE_EXECUTABLE_PATH before any fallback', () => {
  const env = loadEnv(
    {
      CLAUDE_CODE_EXECUTABLE_PATH: ' /custom/bin/claude ',
    },
    {
      exists: () => true,
      resolveFromPath: () => '/usr/local/bin/claude',
    }
  );

  assert.equal(env.claudeCodeExecutablePath, '/custom/bin/claude');
});

test('loadEnv forces SDK built-in Claude runtime when CLAUDE_CODE_USE_SDK_BUILTIN is enabled', () => {
  const env = loadEnv(
    {
      CLAUDE_CODE_USE_SDK_BUILTIN: ' true ',
      CLAUDE_CODE_EXECUTABLE_PATH: '/custom/bin/claude',
    },
    {
      exists: () => true,
      resolveFromPath: () => '/usr/local/bin/claude',
    }
  );

  assert.equal(env.claudeCodeExecutablePath, null);
});

test('loadEnv falls back to bundled vendor cli before PATH lookup', () => {
  const env = loadEnv(
    {},
    {
      exists: () => true,
      resolveFromPath: () => '/usr/local/bin/claude',
    }
  );

  assert.equal(
    normalize(env.claudeCodeExecutablePath || '').endsWith(
      normalize('vendor/claude-agent-sdk/cli.js')
    ),
    true
  );
});

test('loadEnv falls back to claude found on PATH when no explicit or bundled cli exists', () => {
  const env = loadEnv(
    {},
    {
      exists: () => false,
      resolveFromPath: () => '/usr/local/bin/claude',
    }
  );

  assert.equal(env.claudeCodeExecutablePath, '/usr/local/bin/claude');
});

test('loadEnv resolves claude from PATH on Windows when no explicit or bundled cli exists', () => {
  const env = loadEnv(
    {},
    {
      exists: () => false,
      resolveFromPath: () =>
        'C:\\Users\\Administrator\\AppData\\Local\\Programs\\Claude\\claude.cmd',
      platform: 'win32',
    }
  );

  assert.equal(
    env.claudeCodeExecutablePath,
    'C:\\Users\\Administrator\\AppData\\Local\\Programs\\Claude\\claude.cmd'
  );
});

test('loadEnv resolves Windows npm shim to native claude.exe when present', () => {
  const env = loadEnv(
    {},
    {
      exists: (targetPath) =>
        targetPath ===
        'C:\\nvm4w\\nodejs\\node_modules\\@anthropic-ai\\claude-code\\bin\\claude.exe',
      resolveFromPath: () => 'C:\\nvm4w\\nodejs\\claude.cmd',
      platform: 'win32',
    }
  );

  assert.equal(
    env.claudeCodeExecutablePath,
    'C:\\nvm4w\\nodejs\\node_modules\\@anthropic-ai\\claude-code\\bin\\claude.exe'
  );
});

test('loadEnv leaves claudeCodeExecutablePath empty when no source is available', () => {
  const env = loadEnv(
    {},
    {
      exists: () => false,
      resolveFromPath: () => null,
    }
  );

  assert.equal(env.claudeCodeExecutablePath, null);
});
