import { resolveAgentBackendCommand } from './agent-backend-supervisor';

describe('resolveAgentBackendCommand', () => {
  it('prefers the bundled Windows launcher script when provided', () => {
    expect(
      resolveAgentBackendCommand({
        platform: 'win32',
        env: {
          ComSpec: 'C:\\Windows\\System32\\cmd.exe',
          WEBMCP_AGENT_V2_WINDOWS_START_SCRIPT: 'C:\\pkg\\runtime\\run_agent_backend.bat',
          WEBMCP_AGENT_V2_COMMAND:
            '"C:\\node\\node.exe" "C:\\pkg\\runtime\\agent-backend-v2\\server.cjs"',
        },
      })
    ).toEqual({
      command: 'C:\\Windows\\System32\\cmd.exe',
      args: ['/d', '/s', '/c', 'C:\\pkg\\runtime\\run_agent_backend.bat'],
    });
  });

  it('falls back to the explicit override command when no Windows launcher is provided', () => {
    expect(
      resolveAgentBackendCommand({
        platform: 'linux',
        env: {
          WEBMCP_AGENT_V2_COMMAND: '"node" "/tmp/agent/server.cjs"',
        },
      })
    ).toEqual({
      command: 'node',
      args: ['/tmp/agent/server.cjs'],
    });
  });
});
