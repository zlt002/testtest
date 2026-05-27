import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { setupTools } from './register-tools';

export let mcpServer: McpServer | null = null;

export const createMcpServer = () => {
  const server = new McpServer(
    {
      name: 'ChromeMcpServer',
      version: '1.0.0',
    },
    {
      capabilities: {
        tools: {},
      },
    }
  );
  setupTools(server);
  return server;
};

export const getMcpServer = () => {
  if (mcpServer) {
    return mcpServer;
  }
  mcpServer = createMcpServer();
  return mcpServer;
};
