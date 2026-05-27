// @vitest-environment node

import { describe, expect, it } from 'vitest';
import {
  buildWebEditWorkflowInstruction,
  isWebEditBrowserContext,
  isWebEditFlowIntent,
  isWebEditSpreadsheetIntent,
  resolveWebEditPromptMode,
} from './webeditPrompt';

describe('webeditPrompt', () => {
  it('识别 doc.midea.com 为 WebEdit 表格上下文', () => {
    expect(
      isWebEditBrowserContext({
        url: 'https://doc.midea.com/teamKnowledge/detail/docOnline/2054164112972349441?id=1',
      })
    ).toBe(true);
  });

  it('忽略普通网站上下文', () => {
    expect(
      isWebEditBrowserContext({
        url: 'https://example.com/page',
      })
    ).toBe(false);
  });

  it('识别中文表格意图', () => {
    expect(isWebEditSpreadsheetIntent('帮我生成一个项目任务表示例')).toBe(true);
    expect(isWebEditSpreadsheetIntent('把 J13 单元格改成 OK')).toBe(true);
    expect(isWebEditSpreadsheetIntent('把当前表格美化一下，加边框并居中对齐')).toBe(true);
    expect(isWebEditSpreadsheetIntent('清空我当前框选的区域')).toBe(true);
  });

  it('识别英文表格意图', () => {
    expect(isWebEditSpreadsheetIntent('create a spreadsheet template')).toBe(true);
  });

  it('识别流程图意图', () => {
    expect(isWebEditFlowIntent('帮我生成一个流程图')).toBe(true);
    expect(isWebEditFlowIntent('把这些 nodes 和 edges 画到当前画布')).toBe(true);
    expect(isWebEditFlowIntent('整理一下当前拓扑图布局')).toBe(true);
  });

  it('在 WebEdit 文档页也会注入通用 workflow 提示', () => {
    expect(
      resolveWebEditPromptMode(
        {
          url: 'https://doc.midea.com/teamKnowledge/detail/docOnline/2054164112972349441?id=1',
        },
        '请读取当前文档正文，并总结前两段'
      )
    ).toBe('generic');
  });

  it('在 WebEdit 页面识别流程图模式', () => {
    expect(
      resolveWebEditPromptMode(
        {
          url: 'https://doc.midea.com/teamKnowledge/detail/docOnline/2054164112972349441?id=1',
        },
        '请根据这段说明生成流程图，并把节点和连线写到当前画布'
      )
    ).toBe('flow');
  });

  it('生成包含关键闭环约束的工作流提示', () => {
    const prompt = buildWebEditWorkflowInstruction({
      url: 'https://doc.midea.com/teamKnowledge/detail/docOnline/2054164112972349441?id=1',
    }, 'spreadsheet');

    expect(prompt).toContain('webedit_write_range');
    expect(prompt).toContain('webedit_apply_table_style');
    expect(prompt).toContain('wps-automation');
    expect(prompt).toContain('includeFrames=true');
    expect(prompt).toContain('frameStrategy="wps-priority"');
    expect(prompt).toContain('domain="webedit.midea.com"');
    expect(prompt).toContain('不要只传笼统的 "webedit"');
    expect(prompt).toContain('selection 字段');
    expect(prompt).toContain('不要把整行内容拼成一个长字符串');
    expect(prompt).toContain('必须回读同一区域或单元格');
    expect(prompt).toContain('rowsCount');
    expect(prompt).toContain('只识别到单个 active cell');
    expect(prompt).toContain('不要先调用 list_extension_tools');
    expect(prompt).toContain('如果 browser_context 已提供 tabId/windowId');
    expect(prompt).toContain('返回的 tabId、windowId、url 或 title 与 browser_context 明显不一致');
    expect(prompt).toContain('不要继续反复列工具');
    expect(prompt).toContain('persisted tool-results');
    expect(prompt).toContain('优先直接对 selection.address 调用 webedit_write_range');
  });

  it('为文档场景生成 iframe 读取和能力降级提示', () => {
    const prompt = buildWebEditWorkflowInstruction(
      {
        url: 'https://doc.midea.com/teamKnowledge/detail/docOnline/2054164112972349441?id=1',
      },
      'generic'
    );

    expect(prompt).toContain('includeFrames=true');
    expect(prompt).toContain('webedit / webedit.midea.com');
    expect(prompt).toContain('webedit_get_document_context');
    expect(prompt).toContain('webedit_read_document_text');
    expect(prompt).toContain('webedit_get_document_selection');
    expect(prompt).toContain('webedit_insert_text_at_cursor');
    expect(prompt).toContain('webedit_replace_selection_text');
    expect(prompt).toContain('{ text: "" }');
    expect(prompt).toContain('删掉这里的内容');
    expect(prompt).toContain('extension_tool_execute_user_script');
    expect(prompt).toContain('蓝色高亮选区');
    expect(prompt).toContain('当前 runtime 暴露的是 spreadsheet 工具');
    expect(prompt).toContain('domain="webedit.midea.com"');
    expect(prompt).toContain('不要只传笼统的 "webedit"');
    expect(prompt).toContain('不要先调用 list_extension_tools');
    expect(prompt).not.toContain('webedit_write_range');
  });

  it('为流程图场景生成 definition 读写闭环提示', () => {
    const prompt = buildWebEditWorkflowInstruction(
      {
        url: 'https://webedit.midea.com/c/backendservice/flow/pom/index.html?chartId=abc',
      },
      'flow'
    );

    expect(prompt).toContain('webedit_get_flow_context');
    expect(prompt).toContain('webedit_read_flow_definition');
    expect(prompt).toContain('webedit_debug_flow_api');
    expect(prompt).toContain('webedit_apply_flow_definition');
    expect(prompt).toContain('webedit_beautify_flow');
    expect(prompt).toContain('clearExisting=true');
    expect(prompt).toContain('afterDefinition');
    expect(prompt).toContain('不要误用文档正文工具');
    expect(prompt).toContain('webedit_write_range');
  });
});
