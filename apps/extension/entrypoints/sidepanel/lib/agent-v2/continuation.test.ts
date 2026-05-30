// @vitest-environment node

import { describe, expect, it } from 'vitest';
import { buildContinuationPrompt, deriveContinuationTodos } from './continuation';

describe('continuation helpers', () => {
  it('builds a continuation prompt with original goal and approved plan', () => {
    const prompt = buildContinuationPrompt({
      originalGoal: '修复计划模式并补测试',
      approvedPlan: '1. 更新后端\n2. 更新前端\n3. 跑回归',
    });

    expect(prompt).toContain('<original_user_goal>');
    expect(prompt).toContain('修复计划模式并补测试');
    expect(prompt).toContain('<approved_plan>');
    expect(prompt).toContain('1. 更新后端\n2. 更新前端\n3. 跑回归');
    expect(prompt).toContain('已开启新执行会话');
    expect(prompt).toContain('现在已经进入执行阶段');
    expect(prompt).toContain('立即用 TodoWrite 建立并持续维护当前执行待办');
  });

  it('derives initial todos from approved plan content', () => {
    expect(
      deriveContinuationTodos(
        ['实施步骤：', '1. 更新后端计划模式路由', '2. 对齐前端计划确认卡', '3. 跑定向测试'].join(
          '\n'
        )
      )
    ).toEqual([
      { content: '更新后端计划模式路由', status: 'in_progress' },
      { content: '对齐前端计划确认卡', status: 'pending' },
      { content: '跑定向测试', status: 'pending' },
    ]);
  });
});
