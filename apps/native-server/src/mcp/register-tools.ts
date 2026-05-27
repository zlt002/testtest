import * as fs from 'node:fs';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import {
  CallToolRequestSchema,
  type CallToolResult,
  ListToolsRequestSchema,
  type Tool,
} from '@modelcontextprotocol/sdk/types.js';
import { NativeMessageType } from '../constant';
import nativeMessagingHostInstance from '../native-messaging-host';
import { executeScriptToolOverride, registerUserscriptToolOverride } from './inject-user-mcp';

const agentBackendBaseUrl = () => process.env.WEBMCP_AGENT_V2_BASE_URL || 'http://127.0.0.1:8792';

const snapshotEditTools: Tool[] = [
  {
    name: 'snapshot_locate_dom',
    description:
      'Fast local snapshot helper. Locate the smallest DOM element in an HTML file by absolute filePath plus one-based line and column.',
    inputSchema: {
      type: 'object',
      properties: {
        filePath: { type: 'string', description: 'Absolute path to the local HTML file.' },
        line: { type: 'number', description: 'One-based line number.' },
        column: { type: 'number', description: 'One-based column number.' },
      },
      required: ['filePath', 'line', 'column'],
      additionalProperties: false,
    },
  },
  {
    name: 'snapshot_find_css',
    description:
      'Fast local snapshot helper. Find CSS rules in linked stylesheets that match a located DOM selector.',
    inputSchema: {
      type: 'object',
      properties: {
        htmlPath: { type: 'string', description: 'Absolute path to the local HTML file.' },
        selector: { type: 'string', description: 'DOM selector returned by snapshot_locate_dom.' },
      },
      required: ['htmlPath', 'selector'],
      additionalProperties: false,
    },
  },
  {
    name: 'snapshot_patch_html',
    description:
      'Fast local snapshot helper. Patch HTML by source range or selector-driven operations, including attributes, node removal, inner HTML replacement, and text replacement.',
    inputSchema: {
      type: 'object',
      properties: {
        filePath: { type: 'string', description: 'Absolute path to the local HTML file.' },
        range: { type: 'object', description: 'Source range returned by snapshot_locate_dom.' },
        operation: {
          type: 'object',
          description:
            'Patch operation. Use { type: "setAttributes", attributes: { class: "...", "data-x": "..." } }.',
        },
      },
      required: ['filePath', 'range', 'operation'],
      additionalProperties: false,
    },
  },
  {
    name: 'snapshot_patch_css',
    description:
      'Fast local snapshot helper. Update or append CSS declarations for a selector in the snapshot stylesheet.',
    inputSchema: {
      type: 'object',
      properties: {
        htmlPath: { type: 'string', description: 'Absolute path to the local HTML file.' },
        selector: { type: 'string', description: 'CSS selector to update or append.' },
        declarations: {
          type: 'object',
          description: 'CSS declarations, for example { color: "#fff", background: "#111" }.',
          additionalProperties: true,
        },
      },
      required: ['htmlPath', 'selector', 'declarations'],
      additionalProperties: false,
    },
  },
  {
    name: 'snapshot_patch_css_batch',
    description:
      'Fast local snapshot helper. Update or append multiple CSS rules in one stylesheet write. Prefer this over repeated snapshot_patch_css calls.',
    inputSchema: {
      type: 'object',
      properties: {
        htmlPath: { type: 'string', description: 'Absolute path to the local HTML file.' },
        rules: {
          type: 'array',
          description: 'CSS rule patches to apply in order.',
          items: {
            type: 'object',
            properties: {
              selector: { type: 'string', description: 'CSS selector to update or append.' },
              declarations: {
                type: 'object',
                description: 'CSS declarations for this selector.',
                additionalProperties: true,
              },
            },
            required: ['selector', 'declarations'],
            additionalProperties: false,
          },
        },
      },
      required: ['htmlPath', 'rules'],
      additionalProperties: false,
    },
  },
  {
    name: 'snapshot_remove_node',
    description:
      'Fast local snapshot helper. Remove one HTML node by source range returned from snapshot_locate_dom.',
    inputSchema: {
      type: 'object',
      properties: {
        filePath: { type: 'string', description: 'Absolute path to the local HTML file.' },
        range: { type: 'object', description: 'Source range returned by snapshot_locate_dom.' },
      },
      required: ['filePath', 'range'],
      additionalProperties: false,
    },
  },
  {
    name: 'snapshot_remove_nodes_by_selector',
    description:
      'Fast local snapshot helper. Remove all matching HTML nodes in one file write by selector, optionally scoped to a source range.',
    inputSchema: {
      type: 'object',
      properties: {
        filePath: { type: 'string', description: 'Absolute path to the local HTML file.' },
        selector: { type: 'string', description: 'Selector used to match nodes to remove.' },
        scopeRange: {
          type: 'object',
          description: 'Optional ancestor/source range to limit removals.',
        },
      },
      required: ['filePath', 'selector'],
      additionalProperties: false,
    },
  },
  {
    name: 'snapshot_remove_similar_nodes',
    description:
      'Fast local snapshot helper. Remove nodes similar to an anchor node, for example same selector or same tag/classes.',
    inputSchema: {
      type: 'object',
      properties: {
        filePath: { type: 'string', description: 'Absolute path to the local HTML file.' },
        range: { type: 'object', description: 'Anchor node source range from snapshot_locate_dom.' },
        matchMode: {
          type: 'string',
          description: 'Similarity mode: sameSelector, sameTagAndClasses, or sameStructure.',
        },
        scopeRange: {
          type: 'object',
          description: 'Optional ancestor/source range to limit removals.',
        },
      },
      required: ['filePath', 'range'],
      additionalProperties: false,
    },
  },
  {
    name: 'snapshot_replace_inner_html',
    description:
      'Fast local snapshot helper. Keep the wrapper element and replace only its inner HTML.',
    inputSchema: {
      type: 'object',
      properties: {
        filePath: { type: 'string', description: 'Absolute path to the local HTML file.' },
        range: { type: 'object', description: 'Source range returned by snapshot_locate_dom.' },
        html: { type: 'string', description: 'Replacement inner HTML.' },
      },
      required: ['filePath', 'range', 'html'],
      additionalProperties: false,
    },
  },
  {
    name: 'snapshot_replace_text',
    description:
      'Fast local snapshot helper. Replace the text content of a simple text-only HTML element.',
    inputSchema: {
      type: 'object',
      properties: {
        filePath: { type: 'string', description: 'Absolute path to the local HTML file.' },
        range: { type: 'object', description: 'Source range returned by snapshot_locate_dom.' },
        text: { type: 'string', description: 'Replacement text content.' },
      },
      required: ['filePath', 'range', 'text'],
      additionalProperties: false,
    },
  },
];

function snapshotToolEndpoint(name: string): string | null {
  switch (name) {
    case 'snapshot_locate_dom':
      return '/api/agent-v2/snapshot-edit/locate-dom';
    case 'snapshot_find_css':
      return '/api/agent-v2/snapshot-edit/find-css';
    case 'snapshot_patch_html':
      return '/api/agent-v2/snapshot-edit/patch-html';
    case 'snapshot_remove_node':
      return '/api/agent-v2/snapshot-edit/remove-node';
    case 'snapshot_remove_nodes_by_selector':
      return '/api/agent-v2/snapshot-edit/remove-nodes-by-selector';
    case 'snapshot_remove_similar_nodes':
      return '/api/agent-v2/snapshot-edit/remove-similar-nodes';
    case 'snapshot_replace_inner_html':
      return '/api/agent-v2/snapshot-edit/replace-inner-html';
    case 'snapshot_replace_text':
      return '/api/agent-v2/snapshot-edit/replace-text';
    case 'snapshot_patch_css':
      return '/api/agent-v2/snapshot-edit/patch-css';
    case 'snapshot_patch_css_batch':
      return '/api/agent-v2/snapshot-edit/patch-css-batch';
    default:
      return null;
  }
}

async function handleSnapshotEditTool(name: string, args: unknown): Promise<CallToolResult> {
  const endpoint = snapshotToolEndpoint(name);
  if (!endpoint) {
    return {
      content: [{ type: 'text', text: `Unknown snapshot edit tool: ${name}` }],
      isError: true,
    };
  }

  try {
    const response = await fetch(`${agentBackendBaseUrl()}${endpoint}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(args || {}),
    });
    const text = await response.text();
    return {
      content: [{ type: 'text', text }],
      isError: !response.ok,
    };
  } catch (error) {
    return {
      content: [
        {
          type: 'text',
          text: `Error calling snapshot edit backend: ${error instanceof Error ? error.message : String(error)}`,
        },
      ],
      isError: true,
    };
  }
}

export const setupTools = (server: McpServer) => {
  // List tools handler
  server.server.setRequestHandler(ListToolsRequestSchema, async () => {
    const tools = (await nativeMessagingHostInstance.sendRequestToExtensionAndWait(
      {},
      NativeMessageType.LIST_TOOLS,
      30000
    )) as { data: Tool[] };

    // Filter out the original tools that we're overriding
    tools.data = tools.data.filter(
      (tool) =>
        tool.name !== 'extension_tool_execute_user_script' &&
        tool.name !== 'extension_tool_userscripts_register'
    );

    // Add our overridden tools that read files from disk
    tools.data.push(executeScriptToolOverride);
    tools.data.push(registerUserscriptToolOverride);
    tools.data.push(...snapshotEditTools);

    // @ts-ignore
    return { tools: tools.data };
  });

  // server.server.setRequestHandler(ToolListChangedNotificationSchema, async () => {
  //   const tools = await nativeMessagingHostInstance.sendRequestToExtensionAndWait(
  //     {},
  //     NativeMessageType.LIST_TOOLS,
  //     30000
  //   );
  //   // @ts-ignore
  //   return { tools: tools.data };
  // });

  // nativeMessagingHostInstance.addMessageHandler(
  //   NativeMessageType.TOOL_LIST_UPDATED,
  //   async (message) => {
  //     const msg = message as { payload?: { tools?: Tool[] } };
  //     const tools = msg.payload?.tools;
  //     if (tools?.length) {
  //       tools.forEach((tool) => {
  //         server.registerTool(
  //           tool.name,
  //           {
  //             title: tool.name,
  //             description: tool.description,
  //             inputSchema: tool.inputSchema as any,
  //           },
  //           async (request: any) => {
  //             return await handleToolCall(request.params.name, request.params.arguments || {});
  //           }
  //         );
  //       });
  //     }

  //     server.sendToolListChanged();

  //     nativeMessagingHostInstance.sendMessage({
  //       type: NativeMessageType.TOOL_LIST_UPDATED_ACK,
  //     });
  //   }
  // );

  // Call tool handler
  server.server.setRequestHandler(CallToolRequestSchema, async (request) => {
    if (snapshotToolEndpoint(request.params.name)) {
      return handleSnapshotEditTool(request.params.name, request.params.arguments || {});
    }

    if (request.params.name === 'extension_tool_execute_user_script') {
      if (!request.params.arguments?.filePath) {
        return {
          content: [
            {
              type: 'text',
              text: 'Missing required argument: filePath. Provide an absolute path to a local JavaScript userscript, e.g. /Users/yourname/project/scripts/example.user.js. The native host will read the file and the extension will inject it into the target tab.',
            },
          ],
          isError: true,
        };
      }
      const file = fs.readFileSync(request.params.arguments.filePath as string, 'utf8');

      return handleToolCall('extension_tool_execute_user_script', {
        tabId: request.params.arguments?.tabId,
        code: file,
        allFrames: false,
        world: 'MAIN',
      });
    }

    if (request.params.name === 'extension_tool_userscripts_register') {
      if (!request.params.arguments?.filePath) {
        return {
          content: [
            {
              type: 'text',
              text: 'Missing required argument: filePath. Provide an absolute path to a local JavaScript userscript, e.g. /Users/yourname/project/scripts/example.user.js. The native host will read the file and register it as a persistent userscript.',
            },
          ],
          isError: true,
        };
      }

      if (!request.params.arguments?.id || !request.params.arguments?.matches) {
        return {
          content: [
            {
              type: 'text',
              text: 'Missing required arguments: id and matches are required. id should be a unique identifier for the script, and matches should be an array of URL patterns.',
            },
          ],
          isError: true,
        };
      }

      const file = fs.readFileSync(request.params.arguments.filePath as string, 'utf8');

      // Build the registration parameters with MCP-B optimized defaults
      const registrationParams: any = {
        id: request.params.arguments.id,
        matches: request.params.arguments.matches,
        js: [{ code: file }],
      };

      // Add optional parameters if provided
      if (request.params.arguments.excludeMatches) {
        registrationParams.excludeMatches = request.params.arguments.excludeMatches;
      }
      if (request.params.arguments.allFrames !== undefined) {
        registrationParams.allFrames = request.params.arguments.allFrames;
      }

      // Set runAt with document_start as the recommended default for accr userscripts
      if (request.params.arguments.runAt) {
        registrationParams.runAt = request.params.arguments.runAt;
      } else {
        registrationParams.runAt = 'document_start'; // Default to document_start for accr userscripts
      }

      // Set world with MAIN as the recommended default for accr userscripts
      if (request.params.arguments.world) {
        registrationParams.world = request.params.arguments.world;
      } else {
        registrationParams.world = 'MAIN'; // Default to MAIN for accr userscripts to interact with page
      }

      // Only set worldId if using USER_SCRIPT world
      if (request.params.arguments.worldId && registrationParams.world === 'USER_SCRIPT') {
        registrationParams.worldId = request.params.arguments.worldId;
      }

      return handleToolCall('extension_tool_userscripts_register', registrationParams);
    }

    return handleToolCall(request.params.name, request.params.arguments || {});
  });
};

function isCallToolResult(value: unknown): value is CallToolResult {
  return Boolean(
    value && typeof value === 'object' && Array.isArray((value as { content?: unknown }).content)
  );
}

function unwrapExtensionToolResponse(response: unknown): CallToolResult {
  const envelope =
    response && typeof response === 'object' ? (response as Record<string, unknown>) : null;
  const data = envelope?.data;

  if (isCallToolResult(data)) {
    return data;
  }

  if (isCallToolResult(response)) {
    return response;
  }

  return {
    content: [
      {
        type: 'text',
        text: typeof data === 'string' ? data : JSON.stringify(data ?? response),
      },
    ],
    isError: envelope?.status === 'error',
  };
}

const handleToolCall = async (name: string, args: any): Promise<CallToolResult> => {
  try {
    // 发送请求到Chrome扩展并等待响应
    const response = await nativeMessagingHostInstance.sendRequestToExtensionAndWait(
      {
        name,
        args,
      },
      NativeMessageType.CALL_TOOL,
      30000 // 30秒超时
    );
    return unwrapExtensionToolResponse(response);
  } catch (error: any) {
    return {
      content: [
        {
          type: 'text',
          text: `Error calling tool: ${error.message}`,
        },
      ],
      isError: true,
    };
  }
};
