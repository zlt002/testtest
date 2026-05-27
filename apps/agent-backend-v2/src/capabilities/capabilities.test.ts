import assert from 'node:assert/strict';
import test from 'node:test';
import { createCapabilitiesService } from './capabilities.ts';

test('capabilities service returns local provider defaults', () => {
  const service = createCapabilitiesService();

  assert.deepEqual(service.getCapabilities(), {
    agent: 'local_claude_sdk',
    browserTools: 'local_mcp_http',
    history: 'claude_local',
    files: 'local_filesystem',
    mcpConfig: true,
  });
});

test('capabilities service accepts remote-ready overrides', () => {
  const service = createCapabilitiesService({
    agent: 'remote_claude_sdk',
    browserTools: 'remote_tunnel',
    history: 'remote',
    files: 'remote_workspace',
    mcpConfig: false,
  });

  assert.equal(service.getCapabilities().agent, 'remote_claude_sdk');
  assert.equal(service.getCapabilities().browserTools, 'remote_tunnel');
});
