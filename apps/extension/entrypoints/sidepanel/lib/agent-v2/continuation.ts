export type ContinuationPayload = {
  originalGoal: string;
  approvedPlan: string;
};

const APPROVED_PLAN_BLOCK_PATTERN = /<approved_plan>\s*([\s\S]*?)\s*<\/approved_plan>/i;
const LIST_ITEM_PATTERN = /^(?:[-*+]\s+|\d+\.\s+|(?:\d+|[一二三四五六七八九十]+)[、．]\s+)(.+)$/u;
const CHECKBOX_ITEM_PATTERN = /^[-*+]\s+\[[ xX]\]\s+(.+)$/;

function normalizePlanLine(line: string): string {
  return line
    .trim()
    .replace(/^\*\*(.+)\*\*$/u, '$1')
    .replace(/^`(.+)`$/u, '$1')
    .trim();
}

function extractApprovedPlanText(value: string): string {
  const matched = value.match(APPROVED_PLAN_BLOCK_PATTERN);
  return matched?.[1]?.trim() || value.trim();
}

export function deriveContinuationTodos(approvedPlan: string): Array<{ content: string; status: string }> {
  const planText = extractApprovedPlanText(approvedPlan);
  if (!planText) {
    return [];
  }

  const steps = planText
    .split('\n')
    .map(normalizePlanLine)
    .map((line) => {
      const checkboxMatched = line.match(CHECKBOX_ITEM_PATTERN);
      if (checkboxMatched) {
        return checkboxMatched[1]?.trim() || '';
      }
      const listMatched = line.match(LIST_ITEM_PATTERN);
      if (listMatched) {
        return listMatched[1]?.trim() || '';
      }
      return '';
    })
    .filter(Boolean)
    .slice(0, 8);

  return steps.map((content, index) => ({
    content,
    status: index === 0 ? 'in_progress' : 'pending',
  }));
}

export function buildContinuationPrompt(input: ContinuationPayload): string {
  return [
    '系统提示：已开启新执行会话。当前聊天历史已清空，请基于以下目标和已批准计划继续执行。',
    '',
    '<original_user_goal>',
    input.originalGoal.trim(),
    '</original_user_goal>',
    '',
    '<approved_plan>',
    input.approvedPlan.trim(),
    '</approved_plan>',
    '',
    '执行要求：',
    '1. 现在已经进入执行阶段，不要重新做长篇规划。',
    '2. 按已批准计划直接实施。',
    '3. 立即用 TodoWrite 建立并持续维护当前执行待办，先反映已批准计划，再随着进展更新状态。',
    '4. 如需偏离计划，先说明原因。',
  ].join('\n');
}
