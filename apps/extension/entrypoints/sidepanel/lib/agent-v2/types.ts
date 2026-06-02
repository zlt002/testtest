export type AgentEventType =
  | 'run.started'
  | 'assistant.message.started'
  | 'assistant.message.delta'
  | 'assistant.message.completed'
  | 'tool.call.started'
  | 'tool.call.delta'
  | 'tool.call.completed'
  | 'tool.call.failed'
  | 'process.thinking.delta'
  | 'interaction.required'
  | 'interaction.resolved'
  | 'usage.updated'
  | 'session.bound'
  | 'run.completed'
  | 'run.failed'
  | 'run.aborted'
  | 'sdk.event.unsupported';

export type AgentEvent = {
  eventId: string;
  runId: string;
  sessionId: string | null;
  sequence: number;
  type: AgentEventType;
  timestamp: string;
  payload: Record<string, unknown>;
};

export type DisplayAttachment = {
  id: string;
  name: string;
  mimeType: string;
  size: number;
  kind: 'document' | 'text' | 'other';
};

export type DisplayMessage = {
  id: string;
  sessionId: string;
  runId?: string | null;
  role: 'user' | 'assistant' | 'system' | 'tool';
  kind: 'text' | 'thinking' | 'tool_call' | 'tool_result' | 'interaction' | 'error' | 'run_status';
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
  images?: ImageAttachment[];
  attachments?: DisplayAttachment[];
  requestId?: string | null;
  interactionKind?: 'interactive_prompt' | 'permission_request' | 'plan_approval' | null;
  runPhase?:
    | 'planning'
    | 'awaiting_plan_approval'
    | 'executing'
    | 'completed'
    | 'aborted'
    | null;
};

export type SessionSubagentActivity = {
  id: string;
  timestamp: string;
  kind: 'message' | 'tool_started' | 'tool_completed' | 'status';
  title: string;
  detail: string;
};

export type SessionSubagentSnapshot = {
  agentId: string;
  title: string;
  status: 'running' | 'completed' | 'failed';
  startedAt: string | null;
  updatedAt: string | null;
  latestSummary?: string | null;
  latestToolName?: string | null;
  messageCount: number;
  toolCount: number;
  activities: SessionSubagentActivity[];
};

export type SessionSubagentsResponse = {
  sessionId: string;
  subagents: SessionSubagentSnapshot[];
};

export type AgentV2StopReason =
  | 'user_stop'
  | 'window_takeover_user_left'
  | 'subagent_timeout';

export type ToolDisplayRecord = {
  id: string;
  runId?: string | null;
  sessionId?: string | null;
  toolId?: string | null;
  toolName?: string | null;
  input?: unknown;
  partialInputJson?: string | null;
  result?: unknown;
  isError?: boolean;
  status: 'pending' | 'running' | 'done' | 'error';
  startedAt?: string | null;
  completedAt?: string | null;
  preview: string;
};

export type AgentBackendV2Capabilities = {
  agent: 'local_claude_sdk' | 'remote_claude_sdk';
  browserTools: 'local_mcp_http' | 'remote_tunnel' | 'disabled';
  history: 'claude_local' | 'remote';
  files: 'local_filesystem' | 'remote_workspace' | 'disabled';
  mcpConfig: boolean;
  workdir?: string;
};

export type SystemUpdateInfo = {
  updateAvailable: boolean;
  packageUrl?: string;
  projectUrl?: string;
  packageId?: string | null;
  lastModified?: string | null;
  currentPackageId?: string | null;
  distribution?: string;
  error?: string;
};

export type SystemUpdateStartResponse = {
  success: boolean;
  message?: string;
  error?: string;
};

export type ClaudeSessionSummary = {
  sessionId: string;
  projectPath: string;
  filePath: string;
  messageCount: number | null;
  updatedAt: string | null;
  title?: string;
  interrupted?: boolean;
  interruptedAt?: string;
  interruptedReason?: string;
};

export type ClaudeProjectSummary = {
  projectKey: string;
  projectPath: string;
  name: string;
  sessionCount: number;
  updatedAt: string | null;
};

export type SessionRunStateStatus = 'connecting' | 'streaming' | 'completed' | 'failed' | 'aborted';

export type SessionRunStateRecord = {
  sessionId: string;
  projectPath: string;
  runId: string;
  status: SessionRunStateStatus;
  startedAt: string;
  lastEventAt: string;
  latestSequence: number;
  latestPreviewText?: string;
  hasActiveStream: boolean;
  lastError?: string;
};

export type ProjectSessionRunsResponse = {
  projectPath: string;
  sessions: SessionRunStateRecord[];
};

export type FolderSuggestion = {
  name: string;
  path: string;
};

export type WorkspaceFolderBrowseResponse = {
  path: string;
  parentPath: string | null;
  folders: FolderSuggestion[];
};

export type WorkspaceFolderPickResponse = {
  projectPath: string | null;
};

export type SkillHealthCheckResult = {
  ok: true;
  healthy: boolean;
  checkedPath: string;
  issues: string[];
  recommendedAction: 'none' | 'remote_resync';
  syncStateVersion?: string;
};

export type PageGraphRoutingRule = {
  id: string;
  enabled: boolean;
  hostIncludes: string[];
  pathnameIncludes?: string[];
  hashRouteIncludes?: string[];
  pageTextIncludes?: string[];
  apiPrefixes?: string[];
  resourceHintIncludes?: string[];
  businessId: string;
  pageLabel?: string;
  triggerSkill: string;
  ewankbKb?: string;
  ewankbMode?: 'graph' | 'kb' | 'deep';
  frontendGraphProjects: string[];
  backendGraphProjects: string[];
  sharedGraphProjects?: string[];
};

export type PageGraphRoutingConfig = {
  rules: PageGraphRoutingRule[];
};

export type CurrentPageGraphContext = {
  tabId?: number;
  windowId?: number;
  title?: string;
  url?: string;
  pathname?: string;
  hashRoute?: string;
  pageTextSummary: string[];
  apiCandidates: string[];
  resourceHints: string[];
  frameHints: {
    includeFrames: boolean;
    frameCount?: number;
  };
};

export type AttributionConfidence = 'high' | 'medium' | 'low';

export type RecommendedAttributionAction =
  | 'inspect-best-api'
  | 'validate-top-candidates'
  | 'collect-more-evidence';

export type AttributionEvidenceLabel =
  | 'api-candidate'
  | 'network-request'
  | 'element-text'
  | 'page-summary'
  | 'response-preview';

export type AttributionCandidate = {
  api: string;
  score: number;
  evidence: AttributionEvidenceLabel[];
};

export type AttributionResult = {
  bestApi: string | null;
  candidateApis: AttributionCandidate[];
  confidence: AttributionConfidence;
  needsMoreEvidence: boolean;
  recommendedAction: RecommendedAttributionAction;
};

export type CodeLocationBucket = {
  graphProjects: string[];
  searchTerms: string[];
};

export type PageGraphContextResolution = {
  matched: boolean;
  matchedRuleId: string | null;
  businessId: string | null;
  pageLabel: string | null;
  triggerSkill: string | null;
  ewankbKb: string | null;
  ewankbMode: 'graph' | 'kb' | 'deep' | null;
  url: string | null;
  pathname: string | null;
  hashRoute: string | null;
  pageTextSummary: string[];
  apiCandidates: string[];
  resourceHints: string[];
  frontendGraphProjects: string[];
  backendGraphProjects: string[];
  sharedGraphProjects: string[];
};

export type CodeLocationResult = {
  routeContext: PageGraphContextResolution;
  frontend: CodeLocationBucket;
  backend: CodeLocationBucket;
  shared: CodeLocationBucket;
  attribution: AttributionResult;
};

export type DomDocumentType =
  | 'analysis-report'
  | 'prd-draft'
  | 'technical-design'
  | 'task-breakdown';

export type DomDocumentPage = {
  title: string;
  url: string;
  hashRoute: string | null;
  targetElement: string;
};

export type DomDocumentLocation = {
  matchedRuleId: string | null;
  frontend: CodeLocationBucket;
  backend: CodeLocationBucket;
  shared: CodeLocationBucket;
};

export type SessionHistoryResponse = {
  sessionId: string;
  messages: DisplayMessage[];
};

export type FileTreeEntry = {
  name: string;
  path: string;
  type: 'file' | 'directory';
  size?: number;
  modifiedAt?: string | null;
  children?: FileTreeEntry[];
};

export type PermissionMode = 'default' | 'plan' | 'acceptEdits' | 'bypassPermissions';

export type ThinkingMode = 'low' | 'medium' | 'high' | 'xhigh' | 'max';

export type CommandCatalogEntry = {
  name: string;
  description?: string;
  namespace?: 'local-ui' | 'project' | 'user' | 'skill' | string;
  path?: string;
  metadata?: {
    type?: 'local-ui' | 'custom' | 'skill' | string;
    group?: string;
  };
};

export type CommandCatalog = {
  localUi: CommandCatalogEntry[];
  project: CommandCatalogEntry[];
  user: CommandCatalogEntry[];
  plugin: CommandCatalogEntry[];
  skills: CommandCatalogEntry[];
  count: number;
};

export type CommandExecutionResult =
  | {
      type: 'local-ui';
      command: string;
      action: string;
      message: string;
    }
  | {
      type: 'custom';
      command: string;
      content: string;
      metadata?: Record<string, unknown>;
      hasFileIncludes?: boolean;
      hasBashCommands?: boolean;
    };

export type ManagementCapabilityType = 'skill' | 'command';

export type ManagementCapability = {
  id: string;
  type: ManagementCapabilityType;
  name: string;
  description?: string;
  path?: string;
  editable?: boolean;
  enabled?: boolean;
  source?: {
    kind?: 'user' | 'project' | 'plugin' | 'builtin' | string;
    path?: string;
    writable?: boolean;
    reason?: string;
    pluginId?: string;
    pluginSourceKind?: 'lite' | 'cli' | string;
  };
};

export type CapabilityListResponse = {
  success: boolean;
  capabilities: ManagementCapability[];
};

export type CapabilityDetailResponse = {
  success: boolean;
  capability: ManagementCapability;
  content: string;
  rootDir?: string;
  selectedFilePath?: string;
  files?: CapabilityFileNode[];
};

export type CapabilityFileNode = {
  path: string;
  name: string;
  kind: 'file' | 'directory';
  children?: CapabilityFileNode[];
};

export type CapabilityFileDetailResponse = {
  success: boolean;
  capability: ManagementCapability;
  rootDir?: string;
  path: string;
  content: string;
  encoding: string;
};

export type CapabilityFileUpdateResponse = {
  success: boolean;
  capability: ManagementCapability;
  path: string;
};

export type CapabilityMutationResponse = {
  success: boolean;
  capability: ManagementCapability;
};

export type ManagedPlugin = {
  id: string;
  name?: string;
  version?: string;
  path?: string;
  enabled?: boolean;
  sdkResolved?: boolean;
  source?: {
    kind?: 'lite' | 'cli' | 'github' | string;
    path?: string;
    repoUrl?: string;
    writable?: boolean;
    removable?: boolean;
  };
};

export type InstallPluginInput =
  | {
      source: { kind: 'dev-local'; directory: string };
      scope: 'user';
    }
  | {
      source: { kind: 'github'; repoUrl: string };
      scope: 'user';
    };

export type PluginListResponse = {
  success: boolean;
  plugins: ManagedPlugin[];
};

export type HookSourceOverview = {
  id: 'user' | 'project' | 'local' | string;
  kind?: string;
  label?: string;
  path?: string;
  writable?: boolean;
  hasFile?: boolean;
  hookEventCount?: number;
  rawJson?: string;
};

export type HooksOverviewResponse = {
  sources: HookSourceOverview[];
};

export type AgentAuthSource = 'user_claude_settings' | 'project_model_config';

export type RuntimeCapabilities = {
  selectedAuthSource: AgentAuthSource;
};

export type RuntimeCapabilitiesResponse = {
  success: boolean;
  capabilities: RuntimeCapabilities;
};

export type AgentModelConfig = {
  configMode?: 'official' | 'third_party';
  modelProvider: 'openai' | 'anthropic';
  providerVariant?: 'standard';
  openaiModelName?: string;
  openaiApiKey?: string;
  openaiBaseUrl?: string;
  anthropicModelName?: string;
  anthropicApiKey?: string;
  anthropicBaseUrl?: string;
};

export type AgentDetectedModelConfig = AgentModelConfig;
export type AgentUserClaudeSettingsSnapshot = {
  path: string;
  exists: boolean;
  rawJson: string | null;
};

export type AgentOfficialModelCatalogItem = {
  id: string;
  object?: string;
  ownedBy?: string;
};

export type AgentOfficialModelCatalogResponse = {
  success: boolean;
  models: AgentOfficialModelCatalogItem[];
};

export type AgentOfficialQuota = {
  usagePercent: number | null;
  nextResetTime: string | null;
  resetCycle: string;
};

export type AgentOfficialQuotaResponse = {
  success: boolean;
  quota: AgentOfficialQuota;
};

export type AgentModelConfigRuntimeInfo = {
  authSource: AgentAuthSource | 'process_env';
  selectedAuthSource: AgentAuthSource;
  available: boolean;
  claudeCliAvailable: boolean;
  hasProjectModelConfig: boolean;
  reason: string;
  isUnexpectedProcessEnvFallback?: boolean;
};

export type AgentModelConfigResponse = {
  success: boolean;
  config: AgentModelConfig;
  runtime: AgentModelConfigRuntimeInfo;
  detectedCliConfig: AgentDetectedModelConfig | null;
  userClaudeSettings: AgentUserClaudeSettingsSnapshot;
};

export type AgentUserClaudeSettingsUpdateResponse = {
  success: boolean;
  userClaudeSettings: AgentUserClaudeSettingsSnapshot;
};

export type AgentModelConfigAuthTestResult = {
  ok: boolean;
  message: string;
  runtimeAuthSummary: string;
  runtime: AgentModelConfigRuntimeInfo;
};

export type AgentModelConfigAuthTestResponse = {
  success: boolean;
  result: AgentModelConfigAuthTestResult;
};

export type McpRegistryServer = {
  name: string;
  builtIn: boolean;
  disabled: boolean;
  type: 'stdio' | 'http' | 'sse';
  source: 'built-in' | 'project' | 'user';
  config: Record<string, unknown>;
  enabledToolCount: number;
  totalToolCount: number;
  status: 'enabled' | 'disabled' | 'error';
};

export type McpRegistryTool = {
  name: string;
  fullName: string;
  description?: string;
  inputSchema?: unknown;
  enabled: boolean;
};

export type McpRegistryResponse = {
  servers: McpRegistryServer[];
  rawJson: string;
};

export type McpRegistryToolsResponse = {
  server: McpRegistryServer;
  tools: McpRegistryTool[];
};

export type McpToolPermissionResponse = {
  allowedTools: string[];
  disallowedTools: string[];
};

export type McpServerScope = 'project' | 'user';

export type BrowserContextTabSnapshot = {
  tabId: number;
  windowId?: number;
  title?: string;
  url?: string;
  content?: string;
  captureError?: string;
};

export type BrowserContext = {
  windowId?: number;
  tabId?: number;
  title?: string;
  url?: string;
  source?: 'active-tab' | 'window-fallback' | 'window-only' | 'current-window' | 'selected-tabs';
  allowedTabIds?: number[];
  selectedTabs?: BrowserContextTabSnapshot[];
  primaryTabId?: number | null;
};

export type ImageAttachment = {
  id: string;
  name: string;
  mimeType: string;
  data?: string;
  previewUrl?: string;
};

export type SessionAttachmentKind = 'image' | 'document' | 'text' | 'other';

export type SessionAttachment = {
  id: string;
  sessionFileId: string;
  name: string;
  mimeType: string;
  size: number;
  kind: SessionAttachmentKind;
  storage: string;
  absolutePath?: string;
  data?: string;
  previewUrl?: string;
};

export type StartRunInput = {
  prompt: string;
  projectPath?: string;
  browserContext?: BrowserContext;
  preferredBrowserTool?: string;
  permissionMode?: PermissionMode;
  effort?: ThinkingMode;
  attachments?: SessionAttachment[];
  images?: ImageAttachment[];
  signal?: AbortSignal;
};

export type ContinueRunInput = StartRunInput & {
  sessionId: string;
};

export type InteractionDecision = {
  allow?: boolean;
  message?: string;
  updatedInput?: unknown;
  answers?: Record<string, unknown>;
  nextPermissionMode?: 'acceptEdits' | 'bypassPermissions';
  clearContext?: boolean;
};
