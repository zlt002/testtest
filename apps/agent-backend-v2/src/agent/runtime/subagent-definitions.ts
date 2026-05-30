import type { AgentDefinition } from '@anthropic-ai/claude-agent-sdk';

const VALID_PERMISSION_MODES = new Set([
  'default',
  'acceptEdits',
  'bypassPermissions',
  'plan',
  'dontAsk',
]);

const REPO_ANALYZER_TOOLS = ['Read', 'Grep', 'Glob', 'LS'];
const TEST_RUNNER_TOOLS = ['Bash', 'Read', 'Grep', 'Glob', 'LS'];
const WEB_RESEARCH_DEFAULT_TOOLS = ['WebSearch', 'WebFetch', 'Read', 'Grep', 'Glob'];
const CODEBASE_MEMORY_TOOLS = [
  'mcp__codebase_memory_mcp__search_graph',
  'mcp__codebase_memory_mcp__trace_path',
  'mcp__codebase_memory_mcp__get_code_snippet',
  'mcp__codebase_memory_mcp__query_graph',
  'mcp__codebase_memory_mcp__get_architecture',
];

function normalizeTools(value: string[] | undefined): string[] {
  return [...new Set((value || []).map((item) => item.trim()).filter(Boolean))];
}

function toPermissionMode(value: string | undefined): AgentDefinition['permissionMode'] | undefined {
  if (!value || !VALID_PERMISSION_MODES.has(value)) {
    return undefined;
  }
  return value as AgentDefinition['permissionMode'];
}

function shouldIncludeTool(tool: string, allowedSet?: Set<string>, disallowedSet?: Set<string>): boolean {
  if (disallowedSet?.has(tool)) {
    return false;
  }
  if (!allowedSet) {
    return true;
  }
  return allowedSet.has(tool);
}

function pickTools(
  candidates: string[],
  allowedSet?: Set<string>,
  disallowedSet?: Set<string>
): string[] | undefined {
  const tools = [...new Set(candidates)].filter((tool) =>
    shouldIncludeTool(tool, allowedSet, disallowedSet)
  );
  return tools.length > 0 ? tools : undefined;
}

function inferExtraWebTools(allowedSet?: Set<string>, disallowedSet?: Set<string>): string[] {
  if (!allowedSet) {
    return [];
  }

  return [...allowedSet].filter((tool) => {
    if (disallowedSet?.has(tool)) {
      return false;
    }
    if (tool.includes('browser_extension')) {
      return false;
    }
    return /(^Web(Search|Fetch)$)|(^mcp__.*(web|search|reader|fetch))/i.test(tool);
  });
}

function hasCodebaseMemoryServer(mcpServers: Record<string, unknown> | undefined): boolean {
  return Object.keys(mcpServers || {}).some((name) => /codebase[-_]?memory/i.test(name));
}

export function buildProgrammaticSubagents(input: {
  allowedTools?: string[];
  disallowedTools?: string[];
  permissionMode?: string;
  mcpServers?: Record<string, unknown>;
}): Record<string, AgentDefinition> | undefined {
  const allowedSet =
    input.allowedTools && input.allowedTools.length > 0 ? new Set(normalizeTools(input.allowedTools)) : undefined;
  const disallowedSet = new Set(normalizeTools(input.disallowedTools));
  const permissionMode = toPermissionMode(input.permissionMode);
  const agents: Record<string, AgentDefinition> = {};
  const repoTools = pickTools(
    hasCodebaseMemoryServer(input.mcpServers)
      ? [...REPO_ANALYZER_TOOLS, ...CODEBASE_MEMORY_TOOLS]
      : REPO_ANALYZER_TOOLS,
    allowedSet,
    disallowedSet
  );

  if (repoTools) {
    agents['repo-analyzer'] = {
      description:
        '用于本地代码库分析、定位函数调用链、理解架构与影响范围；优先处理读代码、找定义、查依赖这类任务。',
      prompt: [
        '你是一个代码库只读分析子代理，目标是高质量、低噪音地理解当前项目。',
        '工作规则：',
        '1. 只做分析，不要修改文件，不要运行有副作用的命令。',
        '2. 优先用 Read/Grep/Glob/LS 和可用的 codebase-memory 工具定位代码、调用链和架构。',
        '3. 先给结论，再给证据；引用文件路径、函数名和关键判断依据。',
        '4. 如果信息不足，明确指出缺口，不要编造。',
      ].join('\n'),
      tools: repoTools,
      maxTurns: 6,
      permissionMode,
    };
  }

  const testRunnerTools = pickTools(TEST_RUNNER_TOOLS, allowedSet, disallowedSet);
  if (testRunnerTools?.includes('Bash')) {
    agents['test-runner'] = {
      description: '用于运行测试、构建、类型检查、复现命令输出，并总结失败原因。',
      prompt: [
        '你是一个测试执行子代理，负责运行命令并解释结果。',
        '工作规则：',
        '1. 仅运行和当前任务直接相关的测试、构建或检查命令。',
        '2. 优先跑最小范围命令，避免无关的全量扫描。',
        '3. 输出必须包含：执行了什么命令、结果如何、失败原因、下一步建议。',
        '4. 如果命令长时间无响应，优先停止扩散式尝试，直接汇报卡点。',
      ].join('\n'),
      tools: testRunnerTools,
      maxTurns: 4,
      permissionMode,
    };
  }

  const webTools = pickTools(
    [...WEB_RESEARCH_DEFAULT_TOOLS, ...inferExtraWebTools(allowedSet, disallowedSet)],
    allowedSet,
    disallowedSet
  );
  if (webTools && webTools.some((tool) => /web|search|fetch|reader/i.test(tool))) {
    agents['web-researcher'] = {
      description: '用于查最新资料、官方文档、网页信息和外部事实核验；不要把本地代码分析任务交给它。',
      prompt: [
        '你是一个外部资料检索子代理，负责联网搜索并压缩成可执行结论。',
        '工作规则：',
        '1. 优先使用搜索/抓取类工具，不要改文件，不要运行与联网无关的命令。',
        '2. 搜到足够证据后及时收敛，不要在多个工具之间无限切换。',
        '3. 返回结果时标注来源、时间性和不确定点。',
        '4. 如果当前环境缺少联网工具，要立即说明，而不是反复尝试其他无关工具。',
      ].join('\n'),
      tools: webTools,
      maxTurns: 6,
      permissionMode,
    };
  }

  return Object.keys(agents).length > 0 ? agents : undefined;
}

export function buildSubagentRoutingPrompt(
  agents: Record<string, AgentDefinition> | undefined
): string | undefined {
  if (!agents || Object.keys(agents).length === 0) {
    return undefined;
  }

  const lines = ['<subagent_routing>'];
  lines.push('你可以调用以下程序化子代理。只要任务匹配，就优先使用这些专用子代理，而不是泛化的 general-purpose / Explore。');

  if (agents['repo-analyzer']) {
    lines.push('- `repo-analyzer`：本地代码分析、找定义、查调用链、做影响面判断。');
  }
  if (agents['web-researcher']) {
    lines.push('- `web-researcher`：查最新资料、官方文档、联网事实核验。');
  }
  if (agents['test-runner']) {
    lines.push('- `test-runner`：运行测试、构建、类型检查、读取命令输出。');
  }

  lines.push('调度要求：');
  lines.push('1. 一次任务尽量委派给最贴合职责的子代理。');
  lines.push('2. 多个独立子任务可以并行委派，但不要为了“看起来忙”而滥用子代理。');
  lines.push('3. 研究完成后由主代理统一汇总，不要让研究子代理无限续跑。');
  lines.push('</subagent_routing>');
  return lines.join('\n');
}
