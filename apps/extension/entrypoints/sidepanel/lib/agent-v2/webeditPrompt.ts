import type { BrowserContext } from './types';

const WEBEDIT_HOSTS = new Set(['doc.midea.com', 'webedit.midea.com', 'mapnew5.midea.com']);
const WEBEDIT_OUTER_HOST_TOOL_ALIASES: Record<string, string[]> = {
  'doc.midea.com': ['webedit', 'webedit.midea.com'],
};

const WEBEDIT_KEYWORDS = [
  '表格',
  '表头',
  '单元格',
  '工作表',
  '公式',
  '美化',
  '格式化',
  '样式',
  '边框',
  '对齐',
  '选区',
  '选中',
  '框选',
  '列宽',
  '行高',
  '合并',
  '插行',
  '排序',
  '查找',
  '清空',
  '示例表',
  '任务表',
  '销售表',
  '库存表',
  'spreadsheet',
  'sheet',
  'cell',
  'table',
  'header',
  'formula',
  'style',
  'format',
  'border',
  'align',
  'sort',
  'find',
  'selection',
  'selected',
  'range',
];

const WEBEDIT_FLOW_KEYWORDS = [
  '流程图',
  '流程',
  '节点',
  '连线',
  '边',
  '泳道',
  '画布',
  '拓扑',
  '时序图',
  '架构图',
  '脑图',
  '美化布局',
  '自动排版',
  'diagram',
  'flowchart',
  'flow chart',
  'node',
  'nodes',
  'edge',
  'edges',
  'linker',
  'canvas',
  'swimlane',
  'topology',
];

export type WebEditPromptMode = 'none' | 'generic' | 'spreadsheet' | 'flow';

function extractHostname(url?: string) {
  if (!url) {
    return null;
  }

  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return null;
  }
}

export function isWebEditBrowserContext(browserContext?: BrowserContext) {
  const hostname = extractHostname(browserContext?.url);
  return !!hostname && WEBEDIT_HOSTS.has(hostname);
}

export function isWebEditSpreadsheetIntent(prompt: string) {
  const normalized = prompt.trim().toLowerCase();
  return WEBEDIT_KEYWORDS.some((keyword) => normalized.includes(keyword.toLowerCase()));
}

export function isWebEditFlowIntent(prompt: string) {
  const normalized = prompt.trim().toLowerCase();
  return WEBEDIT_FLOW_KEYWORDS.some((keyword) => normalized.includes(keyword.toLowerCase()));
}

export function resolveWebEditPromptMode(
  browserContext: BrowserContext | undefined,
  prompt: string
): WebEditPromptMode {
  if (!isWebEditBrowserContext(browserContext)) {
    return 'none';
  }

  if (isWebEditFlowIntent(prompt)) {
    return 'flow';
  }

  return isWebEditSpreadsheetIntent(prompt) ? 'spreadsheet' : 'generic';
}

export function buildWebEditWorkflowInstruction(
  browserContext?: BrowserContext,
  mode: Exclude<WebEditPromptMode, 'none'> = 'spreadsheet'
) {
  const pageUrl = browserContext?.url || 'unknown';
  const hostname = extractHostname(browserContext?.url);
  const toolAliases = hostname ? WEBEDIT_OUTER_HOST_TOOL_ALIASES[hostname] || [] : [];
  const blocks = [
    '<webedit_workflow_instruction>',
    '当前标签页看起来是 WebEdit/WPS 在线文档或表格场景。',
    `当前页面 URL: ${pageUrl}`,
    '当前场景默认优先选择 webedit_* 工具链；只要已经发现 webedit_*，就不要回退到旧 wps_*、泛化 office skill 或与当前页面无关的工具。',
    '如果需要先理解当前页面、当前工作表或当前文档内容，优先调用 mcp__browser_extension__read_current_page_content，并传入 includeFrames=true、frameStrategy="wps-priority"、includeFrameAnalysis=true。',
    '如果 read_current_page_content 返回 selection 字段，优先把它当成当前编辑位置的快速上下文；没有 selection 也不要退回 outer shell 文本就直接下结论。',
    '先调用 mcp__browser_extension__list_website_tools，优先查看当前活动标签页中名字包含 webedit_ 的工具。',
    '如果 browser_context.url 已经是 webedit.midea.com，优先使用精确 host 查询，例如 domain="webedit.midea.com"；不要只传笼统的 "webedit"。',
    '如果当前外层页面是文档壳页（例如 doc.midea.com），但实际编辑器位于 webedit iframe，除了当前 host 以外，还要尝试查询 webedit / webedit.midea.com 相关工具；优先顺序是当前精确 host，再到别名 host。',
    '优先选择与 browser_context.url 对应域名和 Active Tab 的那组工具，不要只因为 outer host 没有直接命中就断定没有工具。',
    '如果当前 active tab 已经是 webedit.midea.com，优先按该 tab 的 tool list 和 bridge 状态执行，不要再退回 doc.midea.com outer shell 做工具选择。',
    '如果 list_website_tools 与当前实际 bridge 状态不一致，优先调用 mcp__browser_extension__debug_webedit_bridge 核对 mergedToolNames；只要 mergedToolNames 里已有 webedit_*，就按这些 webedit_* 执行。',
    '一旦已经从 list_website_tools 或 debug_webedit_bridge 确认当前 Active Tab 存在所需的 webedit_* 工具，就立即进入对应的读写调用，不要继续反复列工具、分析完整工具清单文件、或读取落盘的 persisted tool-results 文件。',
    '如果 browser_context 已提供 tabId/windowId，不要先调用 list_extension_tools 或 extension_tool_tab_operations.listActiveTabs 重新找页面；只有在 browser_context.tabId 明确失效后，才允许把 extension tabs 查询作为兜底。',
    '如果不得不兜底查询 tabs，返回的 tabId、windowId、url 或 title 与 browser_context 明显不一致时，视为陈旧结果，不要继续拿它去 read_current_page_content、debug_webedit_bridge 或 call_website_tool。',
  ];

  if (toolAliases.length > 0) {
    blocks.push(`当前 host 的工具别名提示: ${toolAliases.join(', ')}。`);
  }

  if (mode === 'spreadsheet') {
    blocks.push(
      '如果用户意图涉及生成表格、读取表格、改单元格、设置公式、表头样式、列宽、行高、合并或清空区域，优先走当前页面暴露的 webedit website tools，而不是凭空输出文本方案。',
      '不要调用当前会话里不存在的泛化 skill 名称，例如 wps-automation；当前场景优先依赖 webedit website tools 和已启用的 webedit-spreadsheet-assistant。',
      '如果当前页面已经暴露 webedit_read_cell、webedit_write_cell、webedit_write_range、webedit_batch_write 等工具，就不要改用旧 wps_read_cell、wps_write_cell 或其他历史别名。',
      '执行表格写入前，先读取上下文：优先调用 webedit_get_context、webedit_get_active_sheet、webedit_get_selection。',
      '如果用户提到“当前选中区域”“我框选的部分”“这一片”“选区”“当前选中的单元格区域”，必须先读取 webedit_get_selection，并检查 selection.address、rowsCount、columnsCount。',
      '如果用户显然想操作多单元格区域，但 webedit_get_selection 返回 1x1，只识别到单个 active cell，则先停止执行并明确提示“当前 runtime 只识别到单格，未稳定识别多选”，不要直接按单格去清空、删除、覆盖或改写。',
      '如果要生成示例表格或模板，先把内容整理成二维数组，再调用 webedit_write_range。不要把整行内容拼成一个长字符串。',
      '如果 selection.address 已是稳定的多单元格区域，且用户要求“在当前选区生成 demo 表格/模板”，优先直接对 selection.address 调用 webedit_write_range，而不是继续探测工具定义或改走其他兜底路径。',
      '如果用户是在做表格美化、统一样式、正式化排版，优先尝试 webedit_apply_table_style；只有当高阶工具缺少必要控制项时，再回退为 webedit_set_font、webedit_set_fill、webedit_set_alignment、webedit_set_border、webedit_set_wrap_text、webedit_set_column_width、webedit_set_row_height 的原子组合。',
      '如果只改一个单元格，调用 webedit_write_cell，并在写入后调用 webedit_read_cell 校验。',
      '如果设置公式，调用 webedit_set_formula，并用 webedit_get_formula 或 webedit_read_cell 校验。',
      '如果做样式，先完成内容写入；能用高阶工具时不要拆成过多串行原子调用，以减少浏览器往返和总耗时。',
      '任何写入完成后，必须回读同一区域或单元格；如果回读与预期不一致，不要声称成功，要明确说明失败。'
    );
  } else if (mode === 'flow') {
    blocks.push(
      '如果用户意图涉及流程图、节点、连线、泳道、拓扑、画布布局或图形美化，优先走当前页面暴露的 webedit flow website tools，而不是伪造“已生成”结果。',
      '先调用 webedit_get_flow_context，再调用 webedit_read_flow_definition 理解当前画布现状；不要跳过现状读取直接覆盖。',
      '如果需要判断页面是否真的支持流程图编排能力，优先调用 webedit_debug_flow_api，检查 Model、Designer、Beautify、smartAiHelpCon 等探针结果。',
      '生成流程图时，优先产出结构化 definition，最少包含 nodes 和 edges；节点里尽量明确 text、shape、x、y、w、h，连线里尽量明确 fromId、toId 或直接给 from/to。',
      '写入时优先调用 webedit_apply_flow_definition；如果用户没有要求保留旧内容，默认 clearExisting=true。',
      '调用 webedit_apply_flow_definition 后，默认再执行 beautify 闭环；如果工具已支持 beautify=true，可直接在同一次调用里完成。',
      '如果用户只想整理现有图，不要重建 definition，直接调用 webedit_beautify_flow。',
      '流程图场景不要误用文档正文工具（如 webedit_replace_selection_text）或表格工具（如 webedit_write_range）。',
      '任何流程图写入后，都要再次调用 webedit_read_flow_definition 或检查工具返回的 afterDefinition，确认节点数、连线数与预期一致；不一致时不要声称成功。'
    );
  } else {
    blocks.push(
      '如果用户是在阅读或编辑正文文档，优先查找并调用 webedit_get_document_context、webedit_read_document_text、webedit_get_document_selection 这一组文档工具。',
      '如果当前页面已暴露 webedit_get_document_selection、webedit_read_document_text、webedit_insert_text_at_cursor、webedit_replace_selection_text，就不要回退为 wps_execute_script、wps_* 表格工具或无关工具。',
      '如果要通过 mcp__browser_extension__call_website_tool 调 website_tool_*，必须把真实业务参数放进嵌套的 arguments 对象里，而不是直接平铺在顶层。',
      '正确示例：mcp__browser_extension__call_website_tool({ toolName: "website_tool_xxx_webedit_insert_text_at_cursor", arguments: { text: "补写内容" } })。',
      '错误示例：mcp__browser_extension__call_website_tool({ toolName: "website_tool_xxx_webedit_insert_text_at_cursor" })。这会因为缺少 arguments.text 导致 text is required。',
      '如果要做正文写入，先调用 webedit_get_document_selection；当 selection.type 为 Caret 时优先用 webedit_insert_text_at_cursor，当 selection.text 非空时优先用 webedit_replace_selection_text。',
      '如果用户意图是删除当前选中的正文、删掉评论锚定的这段内容、或评论明确要求“删掉这里的内容”，并且 webedit_get_document_selection 已返回非空 selection.text，则优先调用 webedit_replace_selection_text，并传入空字符串 { text: "" } 作为删除动作。',
      '不要再把“删除”误解为必须生成临时脚本、手动重选、或改走 extension_tool_execute_user_script；只要当前文档选区已稳定识别，就直接调用 webedit_replace_selection_text({ text: "" })。',
      '如果页面视觉上已经有蓝色高亮选区，但 runtime 元信息仍显示 Caret，只要 webedit_get_document_selection 返回了非空 selection.text，也应按选区替换处理，不要退回“请用户重新选择”这类旧流程。',
      '如果用户要在光标处补写、改写当前选中文本，只有在 list_website_tools 里确实存在 webedit_insert_text_at_cursor 或 webedit_replace_selection_text 时才执行写入；没有这些工具时，必须明确说明当前 runtime 尚未暴露正文写入能力。',
      '如果 list_website_tools 只返回工作表、单元格、Range、Sheet 相关工具，要明确说明“当前 runtime 暴露的是 spreadsheet 工具，尚未发现文档正文写入工具”，不要虚构写入成功。'
    );
  }

  blocks.push('</webedit_workflow_instruction>');

  return blocks.join('\n');
}
