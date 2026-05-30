export type PlanRunPhase =
  | 'planning'
  | 'awaiting_plan_approval'
  | 'executing'
  | 'completed'
  | 'aborted';

export type PlanModeDecision =
  | { behavior: 'allow' }
  | {
      behavior: 'ask';
      interactionKind: 'interactive_prompt' | 'permission_request' | 'plan_approval';
      nextPhase: PlanRunPhase;
      title?: string;
    };

function isExitPlanModeTool(toolName: string): boolean {
  return toolName === 'ExitPlanMode';
}

export function classifyPlanModeToolUse(input: {
  permissionMode?: string;
  toolName: string;
  toolInput: Record<string, unknown>;
  requiresApprovalForSideEffects: (toolName: string, toolInput: Record<string, unknown>) => boolean;
}): PlanModeDecision | null {
  if (input.permissionMode !== 'plan') {
    return null;
  }

  if (isExitPlanModeTool(input.toolName)) {
    return {
      behavior: 'ask',
      interactionKind: 'plan_approval',
      nextPhase: 'awaiting_plan_approval',
      title: 'Claude 已完成计划，等待你确认后继续执行',
    };
  }

  if (input.toolName === 'AskUserQuestion') {
    return {
      behavior: 'ask',
      interactionKind: 'interactive_prompt',
      nextPhase: 'planning',
    };
  }

  if (!input.requiresApprovalForSideEffects(input.toolName, input.toolInput)) {
    return { behavior: 'allow' };
  }

  return {
    behavior: 'ask',
    interactionKind: 'permission_request',
    nextPhase: 'planning',
  };
}
