// @vitest-environment node

import { describe, expect, it } from 'vitest';
import { resolveInjectionPlan } from './WebMCPInjector';

const WEBEDIT_FILES = [
  'webedit/runtime-adapter.js',
  'webedit/result-helpers.js',
  'webedit/tools/context.js',
  'webedit/tools/probe.js',
  'webedit/tools/document.js',
  'webedit/tools/flow.js',
  'webedit/tools/cells.js',
  'webedit/tools/formula.js',
  'webedit/tools/format.js',
  'webedit/tools/structure.js',
  'webedit/tools/search.js',
  'webedit/tools/data.js',
  'webedit/tools/presets.js',
  'webedit-mcp-server.js',
];

describe('resolveInjectionPlan', () => {
  it('为 doc.midea.com 父页只注入主 frame polyfill', () => {
    expect(
      resolveInjectionPlan(
        'https://doc.midea.com/teamKnowledge/detail/docOnline/2054164112972349441?id=1'
      )
    ).toEqual({
      polyfillTarget: 'main-frame',
      scripts: [],
      scriptTarget: 'matched-frame',
    });
  });

  it('为 webedit.midea.com iframe 注入 polyfill 和 WebEdit MCP server', () => {
    expect(
      resolveInjectionPlan('https://webedit.midea.com/moewebv7/document-cloud?editId=abc')
    ).toEqual({
      polyfillTarget: 'matched-frame',
      scripts: WEBEDIT_FILES,
      scriptTarget: 'matched-frame',
    });
  });

  it('为 webedit.midea.com 的内层 weboffice 文档 iframe 也注入 WebEdit MCP server', () => {
    expect(
      resolveInjectionPlan(
        'https://webedit.midea.com/weboffice/office/w/379590652477440?_w_appid=abc&lang=zh-CN'
      )
    ).toEqual({
      polyfillTarget: 'matched-frame',
      scripts: WEBEDIT_FILES,
      scriptTarget: 'matched-frame',
    });
  });

  it('为 webedit.midea.com 的内层 weboffice 表格 iframe 也注入 WebEdit MCP server', () => {
    expect(
      resolveInjectionPlan(
        'https://webedit.midea.com/weboffice/office/s/379699874299904?_w_appid=abc&lang=zh-CN'
      )
    ).toEqual({
      polyfillTarget: 'matched-frame',
      scripts: WEBEDIT_FILES,
      scriptTarget: 'matched-frame',
    });
  });

  it('为 webedit.midea.com 的流程图 iframe 也注入 WebEdit MCP server', () => {
    expect(
      resolveInjectionPlan(
        'https://webedit.midea.com/c/backendservice/flow/pom/index.html?chartId=abc'
      )
    ).toEqual({
      polyfillTarget: 'matched-frame',
      scripts: WEBEDIT_FILES,
      scriptTarget: 'matched-frame',
    });
  });

  it('为其他页面保持现有 WPS server 路线', () => {
    expect(resolveInjectionPlan('https://www.kdocs.cn/l/abcdef')).toEqual({
      polyfillTarget: 'main-frame',
      scripts: ['wps-mcp-server.js'],
      scriptTarget: 'all-frames',
    });
  });

  it('跳过浏览器内部页面', () => {
    expect(resolveInjectionPlan('chrome://extensions')).toBeNull();
    expect(resolveInjectionPlan('edge://settings')).toBeNull();
  });

  it('无法解析的地址回退到现有 WPS server 路线', () => {
    expect(resolveInjectionPlan('not-a-valid-url')).toEqual({
      polyfillTarget: 'main-frame',
      scripts: ['wps-mcp-server.js'],
      scriptTarget: 'all-frames',
    });
  });
});
