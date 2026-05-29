import assert from 'node:assert/strict';
import test from 'node:test';
import { buildClaudeRequestOptions } from './claude-request-builder.ts';

const BASE_ENV = {
  host: '127.0.0.1',
  port: 8792,
  workdir: '/tmp/project',
  model: null,
  claudeCodeExecutablePath: '/usr/local/bin/claude',
  enableBrowserExtensionMcp: true,
  browserExtensionMcpUrl: 'http://127.0.0.1:12306/mcp',
};

test('omits effort for third-party anthropic compatible gateways', () => {
  const options = buildClaudeRequestOptions({
    env: BASE_ENV,
    model: 'kimi-k2.6',
    effort: 'high',
    sdkEnv: {
      ANTHROPIC_API_KEY: 'sk-test',
      ANTHROPIC_BASE_URL: 'https://anapi-uat.annto.com/api-sse-anthropic',
    },
  });

  assert.equal(options.effort, undefined);
});

test('keeps effort for official anthropic api', () => {
  const options = buildClaudeRequestOptions({
    env: BASE_ENV,
    model: 'claude-sonnet-4-20250514',
    effort: 'high',
    sdkEnv: {
      ANTHROPIC_API_KEY: 'sk-test',
      ANTHROPIC_BASE_URL: 'https://api.anthropic.com/v1',
    },
  });

  assert.equal(options.effort, 'high');
});

test('injects default chinese system prompt when none is provided', () => {
  const options = buildClaudeRequestOptions({
    env: BASE_ENV,
    appendSystemPrompt: '你正在服务中文用户，所有面向用户的可见内容必须以简体中文输出。',
  });

  assert.deepEqual(options.systemPrompt, {
    type: 'preset',
    preset: 'claude_code',
    append: '你正在服务中文用户，所有面向用户的可见内容必须以简体中文输出。',
  });
});

test('merges default chinese system prompt with preset append prompts', () => {
  const options = buildClaudeRequestOptions({
    env: BASE_ENV,
    appendSystemPrompt: '你正在服务中文用户，所有面向用户的可见内容必须以简体中文输出。',
    systemPrompt: {
      type: 'preset',
      preset: 'claude_code',
      append: '当前是 WebEdit 扩展内置办公会话。',
    },
  });

  assert.deepEqual(options.systemPrompt, {
    type: 'preset',
    preset: 'claude_code',
    append:
      '你正在服务中文用户，所有面向用户的可见内容必须以简体中文输出。\n\n当前是 WebEdit 扩展内置办公会话。',
  });
});
