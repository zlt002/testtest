import assert from 'node:assert/strict';
import test from 'node:test';
import {
  classifyInteractionIntent,
  classifyInteractionResource,
} from './interaction-policy-classifier.ts';

test('classifyInteractionResource returns local_file_url for file protocol pages', () => {
  const result = classifyInteractionResource({
    prompt: '请分析当前 index.html 的源码结构',
    browserContext: {
      url: 'file:///Users/zhanglt21/Desktop/gjwl/index.html',
      tabId: 12,
      windowId: 3,
    },
  });

  assert.equal(result.kind, 'local_file_url');
  assert.equal(result.usesBrowserContext, true);
});

test('classifyInteractionResource returns active_web_page for normal current tabs', () => {
  const result = classifyInteractionResource({
    prompt: '总结当前页面内容',
    browserContext: {
      url: 'https://www.qq.com/',
      tabId: 88,
      windowId: 6,
    },
  });

  assert.equal(result.kind, 'active_web_page');
});

test('classifyInteractionResource returns remote_url_without_active_tab when prompt only contains a remote URL', () => {
  const result = classifyInteractionResource({
    prompt: '帮我分析 https://example.com 的首页结构',
  });

  assert.equal(result.kind, 'remote_url_without_active_tab');
});

test('classifyInteractionIntent marks screenshot and layout prompts as visual_inspect', () => {
  assert.equal(classifyInteractionIntent('对比一下当前页面截图布局差异'), 'visual_inspect');
});

test('classifyInteractionIntent marks source-code prompts as source_read', () => {
  assert.equal(classifyInteractionIntent('直接读取 index.html 源文件并解释结构'), 'source_read');
});

test('classifyInteractionIntent keeps JSON extraction prompts as structured_extract', () => {
  assert.equal(classifyInteractionIntent('请提取当前页面里的 JSON 字段'), 'structured_extract');
  assert.equal(classifyInteractionIntent('请抓取页面数据并导出 JSON'), 'structured_extract');
});

test('classifyInteractionResource keeps remote target when visual prompt includes a URL', () => {
  const result = classifyInteractionResource({
    prompt: '对比一下 https://example.com 首页截图布局',
  });

  assert.equal(result.kind, 'remote_url_without_active_tab');
  assert.equal(result.usesBrowserContext, false);
});

test('classifyInteractionResource returns workspace_file for explicit file paths', () => {
  const result = classifyInteractionResource({
    prompt: '读取这个工作区文件',
    explicitFilePath: '/Users/zhanglt21/Desktop/accrnew/WebMCP/index.html',
  });

  assert.equal(result.kind, 'workspace_file');
  assert.equal(result.usesBrowserContext, false);
});

test('classifyInteractionResource returns visual_only_task for pure visual prompts without URLs', () => {
  const result = classifyInteractionResource({
    prompt: '帮我检查这个页面截图的布局和样式问题',
  });

  assert.equal(result.kind, 'visual_only_task');
  assert.equal(result.usesBrowserContext, false);
});

test('classifyInteractionResource returns unknown when prompt has no url or visual clue', () => {
  const result = classifyInteractionResource({
    prompt: '总结一下这个任务',
  });

  assert.equal(result.kind, 'unknown');
  assert.equal(result.usesBrowserContext, false);
});
