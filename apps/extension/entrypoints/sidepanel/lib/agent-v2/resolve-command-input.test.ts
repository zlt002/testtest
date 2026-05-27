// @vitest-environment node

import { describe, expect, it, vi } from 'vitest';
import { resolveCommandInput } from './resolve-command-input';

describe('resolveCommandInput', () => {
  it('expands leading skill slash commands through executeCommand', async () => {
    const listCommands = vi.fn(async () => ({
      localUi: [],
      project: [],
      user: [],
      plugin: [],
      skills: [
        {
          name: '/ewankb-server-query',
          description: '查询 ewankb',
          namespace: 'skill' as const,
          path: '/Users/test/.claude/skills/ewankb-server-query/SKILL.md',
          metadata: { type: 'skill' as const, group: 'skills' as const },
        },
      ],
      count: 1,
    }));
    const executeCommand = vi.fn(async () => ({
      type: 'custom' as const,
      command: '/ewankb-server-query',
      content: '展开后的 skill 指令\n\n请使用上面的 skill 完成以下请求：\n查询订单状态',
      metadata: {},
      hasFileIncludes: false,
      hasBashCommands: false,
    }));

    const result = await resolveCommandInput('/ewankb-server-query 查询订单状态', {
      projectPath: '/tmp/project',
      listCommands,
      executeCommand,
    });

    expect(executeCommand).toHaveBeenCalledWith({
      commandName: '/ewankb-server-query',
      commandPath: '/Users/test/.claude/skills/ewankb-server-query/SKILL.md',
      args: ['查询订单状态'],
      context: { projectPath: '/tmp/project' },
    });
    expect(result).toBe('展开后的 skill 指令\n\n请使用上面的 skill 完成以下请求：\n查询订单状态');
  });

  it('keeps unknown leading slash text unchanged', async () => {
    const listCommands = vi.fn(async () => ({
      localUi: [],
      project: [],
      user: [],
      plugin: [],
      skills: [],
      count: 0,
    }));
    const executeCommand = vi.fn();

    const result = await resolveCommandInput('/unknown-command 查询订单状态', {
      projectPath: '/tmp/project',
      listCommands,
      executeCommand,
    });

    expect(result).toBe('/unknown-command 查询订单状态');
    expect(executeCommand).not.toHaveBeenCalled();
  });

  it('does not treat inline slash text in normal prompts as commands', async () => {
    const listCommands = vi.fn();
    const executeCommand = vi.fn();

    const result = await resolveCommandInput('请解释一下 /ewankb-server-query 怎么用', {
      projectPath: '/tmp/project',
      listCommands,
      executeCommand,
    });

    expect(result).toBe('请解释一下 /ewankb-server-query 怎么用');
    expect(listCommands).not.toHaveBeenCalled();
    expect(executeCommand).not.toHaveBeenCalled();
  });
});
