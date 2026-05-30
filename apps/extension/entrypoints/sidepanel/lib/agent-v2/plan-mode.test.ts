// @vitest-environment node

import { describe, expect, it } from 'vitest';
import {
  buildPlanApprovalActions,
  getInteractionDisplayMeta,
  resolvePlanApprovalAction,
} from './plan-mode';

describe('plan-mode helpers', () => {
  it('builds clear-context plan approval actions', () => {
    expect(buildPlanApprovalActions()).toEqual([
      {
        id: 'accept-edits',
        label: '按计划继续并允许编辑',
        nextPermissionMode: 'acceptEdits',
      },
      {
        id: 'bypass',
        label: '按计划继续并允许所有',
        nextPermissionMode: 'bypassPermissions',
      },
      {
        id: 'clear-accept-edits',
        label: '清空上下文并允许编辑后继续',
        nextPermissionMode: 'acceptEdits',
        clearContext: true,
      },
      {
        id: 'clear-bypass',
        label: '清空上下文并允许所有后继续',
        nextPermissionMode: 'bypassPermissions',
        clearContext: true,
      },
      {
        id: 'revise',
        label: '留在计划模式继续调整',
        nextPermissionMode: null,
      },
    ]);
  });

  it('returns plan approval display metadata', () => {
    expect(getInteractionDisplayMeta('plan_approval')).toEqual({
      title: '计划确认',
      tone: 'warning',
    });
  });

  it('derives a unified plan approval resolution for clear-context continuation', () => {
    expect(
      resolvePlanApprovalAction({
        nextPermissionMode: 'bypassPermissions',
        clearContext: true,
        interactionInput: { plan: '1. 更新后端\n2. 更新前端' },
        continuationPrompt: '继续执行',
      })
    ).toEqual({
      selectedPermissionMode: 'bypassPermissions',
      decision: {
        allow: true,
        nextPermissionMode: 'bypassPermissions',
        clearContext: true,
        updatedInput: { plan: '1. 更新后端\n2. 更新前端' },
      },
      continuation: {
        permissionMode: 'bypassPermissions',
        prompt: '继续执行',
      },
    });
  });
});
