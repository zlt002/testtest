import { Server } from './index';

describe('Streamable HTTP MCP responses', () => {
  it('returns JSON responses for request/response MCP clients', async () => {
    const server = new Server();

    const response = await server.fastify.inject({
      method: 'POST',
      url: '/mcp',
      headers: {
        accept: 'application/json, text/event-stream',
        'content-type': 'application/json',
      },
      payload: {
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: {
          protocolVersion: '2025-03-26',
          capabilities: {},
          clientInfo: { name: 'json-response-test', version: '0.0.1' },
        },
      },
    });

    expect(response.statusCode).toBe(200);
    expect(response.headers['content-type']).toContain('application/json');
    expect(JSON.parse(response.body)).toMatchObject({
      jsonrpc: '2.0',
      id: 1,
      result: {
        serverInfo: {
          name: 'ChromeMcpServer',
        },
      },
    });

    await server.fastify.close();
  });
});
