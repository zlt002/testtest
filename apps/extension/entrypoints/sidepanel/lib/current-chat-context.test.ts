// @vitest-environment node

import { describe, expect, it } from 'vitest';
import {
  deriveCurrentChatContext,
  deriveSessionTitleFromMessage,
} from './current-chat-context';

describe('deriveCurrentChatContext', () => {
  it('优先显示当前会话标题和工作区目录名', () => {
    expect(
      deriveCurrentChatContext({
        sessionTitle: '定位信息：选择器 tbody...',
        projectPath: '/Users/demo/Desktop/ccu',
      })
    ).toEqual({
      sessionTitle: '定位信息：选择器 tbody...',
      workspaceName: 'ccu',
      workspacePath: '/Users/demo/Desktop/ccu',
    });
  });

  it('缺少会话标题和工作区时使用兜底文案', () => {
    expect(
      deriveCurrentChatContext({
        sessionTitle: '   ',
        projectPath: undefined,
      })
    ).toEqual({
        sessionTitle: '新会话',
        workspaceName: '请选择工作区',
        workspacePath: null,
      });
  });

  it('兼容 Windows 风格路径', () => {
    expect(
      deriveCurrentChatContext({
        sessionTitle: null,
        projectPath: 'C:\\Users\\Administrator\\Desktop\\mpcb',
      })
    ).toEqual({
      sessionTitle: '新会话',
      workspaceName: 'mpcb',
      workspacePath: 'C:\\Users\\Administrator\\Desktop\\mpcb',
    });
  });
});

describe('deriveSessionTitleFromMessage', () => {
  it('会把首条消息整理成适合展示的会话标题', () => {
    expect(deriveSessionTitleFromMessage('  帮我分析  这个页面 的接口  \n\n并找出清关中的来源  '))
      .toBe('帮我分析 这个页面 的接口 并找出清关中的来源');
  });

  it('会过滤 project_workspace 等自动上下文块', () => {
    expect(
      deriveSessionTitleFromMessage([
        '<project_workspace>',
        '当前项目根目录：C:\\Users\\Administrator\\Desktop\\tst',
        '</project_workspace>',
        '',
        '<user_original_request>',
        '帮我创建一个 html 页面',
        '</user_original_request>',
      ].join('\n'))
    ).toBe('帮我创建一个 html 页面');
  });

  it('会过滤 attachments 附件元数据块', () => {
    expect(
      deriveSessionTitleFromMessage([
        '<attachments>',
        '- name=image.png | mimeType=image/png | kind=image',
        '</attachments>',
        '',
        '<user_original_request>',
        '请分析这张图片',
        '</user_original_request>',
      ].join('\n'))
    ).toBe('请分析这张图片');
  });

  it('会过滤显式 skill 包裹并保留用户原始请求', () => {
    expect(
      deriveSessionTitleFromMessage([
        '<webmcp_explicit_skill name="/ewankb-server-query">',
        '你必须优先遵循下面这个 skill，严格按其中要求执行：',
        '# /ewankb-server-query',
        '</webmcp_explicit_skill>',
        '',
        '<user_original_request>',
        '查询订单状态',
        '</user_original_request>',
      ].join('\n'))
    ).toBe('查询订单状态');
  });

  it('只有显式 skill 时会回退显示命令名', () => {
    expect(
      deriveSessionTitleFromMessage([
        '<webmcp_explicit_skill name="/ewankb-server-query">',
        '你必须优先遵循下面这个 skill，严格按其中要求执行：',
        '# /ewankb-server-query',
        '</webmcp_explicit_skill>',
      ].join('\n'))
    ).toBe('/ewankb-server-query');
  });

  it('会截断过长标题', () => {
    expect(deriveSessionTitleFromMessage('a'.repeat(100))).toBe(`${'a'.repeat(77)}...`);
  });

  it('空白内容返回空值', () => {
    expect(deriveSessionTitleFromMessage('   \n\t  ')).toBeUndefined();
  });
});
