export type AgentProviderKind = 'local_claude_sdk' | 'remote_claude_sdk';

export type BrowserToolsProviderKind = 'local_mcp_http' | 'remote_tunnel' | 'disabled';

export type HistoryProviderKind = 'claude_local' | 'remote';

export type FileProviderKind = 'local_filesystem' | 'remote_workspace' | 'disabled';

export type AgentBackendV2Capabilities = {
  agent: AgentProviderKind;
  browserTools: BrowserToolsProviderKind;
  history: HistoryProviderKind;
  files: FileProviderKind;
  mcpConfig: boolean;
  workdir?: string;
};
