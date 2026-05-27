import { createMcpServer } from './mcp-server';

describe('createMcpServer', () => {
  it('creates an isolated MCP server instance for each transport session', () => {
    const first = createMcpServer();
    const second = createMcpServer();

    expect(first).not.toBe(second);
  });
});
