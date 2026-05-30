import assert from 'node:assert/strict';
import test from 'node:test';
import { classifyPlanModeToolUse } from './plan-mode.ts';

test('plan mode allows readonly tools but marks exit-plan interactions as plan approval', () => {
  assert.deepEqual(
    classifyPlanModeToolUse({
      permissionMode: 'plan',
      toolName: 'Read',
      toolInput: { file_path: '/tmp/README.md' },
      requiresApprovalForSideEffects: () => false,
    }),
    { behavior: 'allow' }
  );

  assert.deepEqual(
    classifyPlanModeToolUse({
      permissionMode: 'plan',
      toolName: 'ExitPlanMode',
      toolInput: {
        plan: '1. 修改权限流\n2. 增加前端确认卡\n3. 回归测试',
      },
      requiresApprovalForSideEffects: () => true,
    }),
    {
      behavior: 'ask',
      interactionKind: 'plan_approval',
      nextPhase: 'awaiting_plan_approval',
      title: 'Claude 已完成计划，等待你确认后继续执行',
    }
  );
});

test('plan mode keeps write tools on permission requests', () => {
  assert.deepEqual(
    classifyPlanModeToolUse({
      permissionMode: 'plan',
      toolName: 'Write',
      toolInput: { file_path: '/tmp/a.txt', content: 'hello' },
      requiresApprovalForSideEffects: () => true,
    }),
    {
      behavior: 'ask',
      interactionKind: 'permission_request',
      nextPhase: 'planning',
    }
  );
});
