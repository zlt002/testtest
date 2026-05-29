// @vitest-environment node

import { describe, expect, it } from 'vitest';
import { localizeUserFacingMessage } from './user-facing-error';

describe('localizeUserFacingMessage', () => {
  it('将扩展连接异常转成中文提示', () => {
    expect(
      localizeUserFacingMessage('Could not establish connection. Receiving end does not exist.')
    ).toBe('无法连接到目标页面，请刷新页面或重新打开侧边栏后重试。');
  });

  it('将常见请求失败提示转成中文并保留状态码', () => {
    expect(localizeUserFacingMessage('Failed to load MCP registry: 503')).toBe(
      '加载 MCP 注册表失败（状态码 503）。'
    );
  });

  it('保留已经是中文的提示', () => {
    expect(localizeUserFacingMessage('当前模型需先配置')).toBe('当前模型需先配置');
  });
});
