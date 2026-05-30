import type { InteractionDecision, PermissionMode } from './types';

export type ExecutablePermissionMode = Extract<PermissionMode, 'acceptEdits' | 'bypassPermissions'>;

export type PendingContinuation = {
  permissionMode: ExecutablePermissionMode;
  prompt: string;
};

export type PlanApprovalAction = {
  id: 'accept-edits' | 'bypass' | 'clear-accept-edits' | 'clear-bypass' | 'revise';
  label: string;
  nextPermissionMode: ExecutablePermissionMode | null;
  clearContext?: boolean;
};

export function buildPlanApprovalActions(): PlanApprovalAction[] {
  return [
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
  ];
}

export function getInteractionDisplayMeta(kind: 'interactive_prompt' | 'permission_request' | 'plan_approval'): {
  title: string;
  tone: 'warning';
} {
  if (kind === 'interactive_prompt') {
    return { title: '交互提问', tone: 'warning' };
  }
  if (kind === 'plan_approval') {
    return { title: '计划确认', tone: 'warning' };
  }
  return { title: '权限请求', tone: 'warning' };
}

export function resolvePlanApprovalAction(input: {
  nextPermissionMode: ExecutablePermissionMode | null;
  clearContext?: boolean;
  interactionInput: unknown;
  continuationPrompt?: string | null;
}): {
  selectedPermissionMode: ExecutablePermissionMode | null;
  decision: InteractionDecision;
  continuation: PendingContinuation | null;
} {
  const continuation =
    input.nextPermissionMode && input.clearContext && input.continuationPrompt
      ? {
          permissionMode: input.nextPermissionMode,
          prompt: input.continuationPrompt,
        }
      : null;

  return {
    selectedPermissionMode: input.nextPermissionMode,
    decision: input.nextPermissionMode
      ? {
          allow: true,
          nextPermissionMode: input.nextPermissionMode,
          ...(input.clearContext ? { clearContext: true } : {}),
          updatedInput: input.interactionInput,
        }
      : {
          allow: false,
          message: '继续留在计划模式调整方案',
          updatedInput: input.interactionInput,
        },
    continuation,
  };
}
