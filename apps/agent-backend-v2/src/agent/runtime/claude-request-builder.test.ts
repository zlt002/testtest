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
