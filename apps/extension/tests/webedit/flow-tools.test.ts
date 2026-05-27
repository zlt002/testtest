// @vitest-environment node

import { describe, expect, it } from 'vitest';
import { createWebEditTestWindow, loadWebEditScript } from './load-webedit-script';

type ToolHandler = (args?: Record<string, unknown>) => Promise<{
  content: Array<{ type: string; text: string }>;
  isError?: boolean;
}>;

function parseToolResult(result: Awaited<ReturnType<ToolHandler>>) {
  return JSON.parse(result.content[0].text);
}

async function loadFlowToolWindow(overrides: Record<string, unknown> = {}) {
  const win = createWebEditTestWindow(overrides);
  await loadWebEditScript(win, 'apps/extension/public/webedit/result-helpers.js');
  await loadWebEditScript(win, 'apps/extension/public/webedit/tools/flow.js');
  return win;
}

describe('webedit flow tools', () => {
  it('注册 flow tools', async () => {
    const win = await loadFlowToolWindow();
    const names: string[] = [];

    (
      win.__webeditFlowTools as {
        registerFlowTools: (deps: Record<string, unknown>) => void;
      }
    ).registerFlowTools({
      adapter: {},
      helpers: win.__webeditResultHelpers,
      errorCodes: {},
      registerTool(name: string) {
        names.push(name);
      },
    });

    expect(names).toEqual(
      expect.arrayContaining([
        'webedit_get_flow_context',
        'webedit_debug_flow_api',
        'webedit_read_flow_definition',
        'webedit_beautify_flow',
        'webedit_apply_flow_definition',
      ])
    );
  });

  it('返回 flow 上下文、定义和写入结果', async () => {
    const win = await loadFlowToolWindow();
    const tools = new Map<string, ToolHandler>();
    const definition = {
      source: 'model-primary',
      nodes: [{ id: 'node_1', text: '开始', name: 'roundRectangle' }],
      edges: [{ id: 'linker_1', name: 'linker', text: '下一步' }],
      summary: {
        nodesCount: 1,
        edgesCount: 1,
        totalCount: 2,
      },
    };

    (
      win.__webeditFlowTools as {
        registerFlowTools: (deps: Record<string, unknown>) => void;
      }
    ).registerFlowTools({
      adapter: {
        detectDocumentIdentity() {
          return {
            href: 'https://webedit.midea.com/c/backendservice/flow/pom/index.html?chartId=abc',
            title: '流程图',
            editId: 'abc',
          };
        },
        async detectRuntimeMode() {
          return 'flow';
        },
        getRuntimeFlags() {
          return { hasFlowModel: true, hasFlowDesigner: true };
        },
        isRuntimeReady() {
          return true;
        },
        async listFlowCapabilities() {
          return {
            mode: 'flow',
            canReadDefinition: true,
            canApplyDefinition: true,
            canBeautify: true,
          };
        },
        async inspectFlowRuntime() {
          return {
            flowGlobalsPresent: ['Model', 'Designer', 'Beautify'],
            modelMethods: ['create', 'addMulti', 'remove'],
            designerMethods: ['beautify'],
          };
        },
        async readFlowDefinition() {
          return definition;
        },
        async clearFlowCanvas() {
          return { supported: true, removedCount: 2, writeStrategy: 'Model.remove' };
        },
        async addFlowElements(input: unknown) {
          return {
            supported: true,
            writeStrategy: 'Model.addMulti',
            received: input,
            nodesCount: 2,
            edgesCount: 1,
          };
        },
        async beautifyFlow() {
          return { supported: true, strategy: 'Designer.beautify' };
        },
      },
      helpers: win.__webeditResultHelpers,
      errorCodes: {},
      registerTool(
        name: string,
        _description: string,
        _schema: unknown,
        handler: ToolHandler
      ) {
        tools.set(name, handler);
      },
    });

    const contextPayload = parseToolResult(await tools.get('webedit_get_flow_context')?.({}));
    expect(contextPayload.ok).toBe(true);
    expect(contextPayload.data).toMatchObject({
      mode: 'flow',
      runtimeReady: true,
      document: {
        title: '流程图',
        editId: 'abc',
      },
      capabilities: {
        canApplyDefinition: true,
      },
    });

    const debugPayload = parseToolResult(await tools.get('webedit_debug_flow_api')?.({}));
    expect(debugPayload.ok).toBe(true);
    expect(debugPayload.data.apiProbe).toMatchObject({
      flowGlobalsPresent: expect.arrayContaining(['Model', 'Designer']),
    });

    const definitionPayload = parseToolResult(
      await tools.get('webedit_read_flow_definition')?.({})
    );
    expect(definitionPayload.ok).toBe(true);
    expect(definitionPayload.data.definition).toMatchObject({
      summary: {
        totalCount: 2,
      },
    });

    const applyPayload = parseToolResult(
      await tools.get('webedit_apply_flow_definition')?.({
        nodes: [
          { id: 'node_1', text: '开始', shape: 'roundRectangle' },
          { id: 'node_2', text: '结束', shape: 'roundRectangle' },
        ],
        edges: [{ fromId: 'node_1', toId: 'node_2', text: '流转' }],
      })
    );
    expect(applyPayload.ok).toBe(true);
    expect(applyPayload.data).toMatchObject({
      requested: {
        clearExisting: true,
        beautify: true,
        summary: {
          nodesCount: 2,
          edgesCount: 1,
        },
      },
      clearResult: {
        supported: true,
      },
      writeResult: {
        supported: true,
        writeStrategy: 'Model.addMulti',
      },
      beautifyResult: {
        supported: true,
        strategy: 'Designer.beautify',
      },
      afterDefinition: {
        source: 'model-primary',
      },
    });
  });

  it('beautify 抛异常时不应让 apply_flow_definition 整体失败', async () => {
    const win = await loadFlowToolWindow();
    const tools = new Map<string, ToolHandler>();

    (
      win.__webeditFlowTools as {
        registerFlowTools: (deps: Record<string, unknown>) => void;
      }
    ).registerFlowTools({
      adapter: {
        async detectRuntimeMode() {
          return 'flow';
        },
        isRuntimeReady() {
          return true;
        },
        async clearFlowCanvas() {
          return { supported: true, removedCount: 0, writeStrategy: 'Model.remove' };
        },
        async addFlowElements() {
          return {
            supported: true,
            writeStrategy: 'Model.addMulti',
            nodesCount: 2,
            edgesCount: 1,
          };
        },
        async beautifyFlow() {
          throw new Error('beautify exploded');
        },
        async readFlowDefinition() {
          return {
            source: 'model-primary',
            nodes: [{ id: 'node_1', text: '开始' }, { id: 'node_2', text: '结束' }],
            edges: [{ id: 'edge_1', name: 'linker' }],
            summary: {
              nodesCount: 2,
              edgesCount: 1,
              totalCount: 3,
            },
          };
        },
      },
      helpers: win.__webeditResultHelpers,
      errorCodes: {},
      registerTool(
        name: string,
        _description: string,
        _schema: unknown,
        handler: ToolHandler
      ) {
        tools.set(name, handler);
      },
    });

    const payload = parseToolResult(
      await tools.get('webedit_apply_flow_definition')?.({
        nodes: [
          { id: 'node_1', text: '开始', shape: 'roundRectangle' },
          { id: 'node_2', text: '结束', shape: 'roundRectangle' },
        ],
        edges: [{ fromId: 'node_1', toId: 'node_2' }],
      })
    );

    expect(payload.ok).toBe(true);
    expect(payload.data.writeResult).toMatchObject({
      supported: true,
      writeStrategy: 'Model.addMulti',
    });
    expect(payload.data.beautifyResult).toMatchObject({
      supported: false,
      reason: 'adapter_call_failed',
      action: 'beautifyFlow',
      error: 'beautify exploded',
    });
  });

  it('beautify 工具抛异常时返回结构化失败而不是 MCP 崩溃', async () => {
    const win = await loadFlowToolWindow();
    const tools = new Map<string, ToolHandler>();

    (
      win.__webeditFlowTools as {
        registerFlowTools: (deps: Record<string, unknown>) => void;
      }
    ).registerFlowTools({
      adapter: {
        async detectRuntimeMode() {
          return 'flow';
        },
        isRuntimeReady() {
          return true;
        },
        async beautifyFlow() {
          throw new Error('beautify exploded');
        },
      },
      helpers: win.__webeditResultHelpers,
      errorCodes: {},
      registerTool(
        name: string,
        _description: string,
        _schema: unknown,
        handler: ToolHandler
      ) {
        tools.set(name, handler);
      },
    });

    const payload = parseToolResult(await tools.get('webedit_beautify_flow')?.({}));
    expect(payload.ok).toBe(false);
    expect(payload.error).toMatchObject({
      code: 'flow_write_not_supported',
    });
    expect(payload.meta).toMatchObject({
      action: 'beautify',
      result: {
        supported: false,
        reason: 'adapter_call_failed',
        action: 'beautifyFlow',
        error: 'beautify exploded',
      },
    });
  });
});
