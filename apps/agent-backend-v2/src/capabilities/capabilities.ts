import type { AgentBackendV2Capabilities } from '../providers/types.ts';

const defaultCapabilities: AgentBackendV2Capabilities = {
  agent: 'local_claude_sdk',
  browserTools: 'local_mcp_http',
  history: 'claude_local',
  files: 'local_filesystem',
  mcpConfig: true,
};

export function createCapabilitiesService(capabilities: Partial<AgentBackendV2Capabilities> = {}) {
  return {
    getCapabilities(): AgentBackendV2Capabilities {
      return {
        ...defaultCapabilities,
        ...capabilities,
      };
    },
  };
}
