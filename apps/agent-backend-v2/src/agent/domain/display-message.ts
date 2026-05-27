export type DisplayMessage = {
  id: string;
  sessionId: string;
  runId?: string | null;
  role: 'user' | 'assistant' | 'system' | 'tool';
  kind:
    | 'text'
    | 'thinking'
    | 'tool_call'
    | 'tool_result'
    | 'interaction'
    | 'error'
    | 'run_status';
  text?: string | null;
  toolId?: string | null;
  toolName?: string | null;
  toolInput?: unknown;
  toolResult?: unknown;
  isError?: boolean;
  status?: string | null;
  timestamp: string;
  sequence?: number | null;
  raw?: unknown;
  requestId?: string | null;
  interactionKind?: 'interactive_prompt' | 'permission_request' | null;
};
