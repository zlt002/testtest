export type McpServerConfig = Record<string, unknown>;

export function createBrowserExtensionMcpServer(url: string): McpServerConfig {
  return {
    type: 'http',
    url,
    alwaysLoad: true,
  };
}
