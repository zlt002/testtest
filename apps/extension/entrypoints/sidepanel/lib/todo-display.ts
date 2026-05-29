import type { RunCardStatus } from './agent-v2/run-cards';

export function deriveDisplayedTodoStatus(
  todoStatus: string,
  cardStatus: RunCardStatus
): string {
  if (
    (cardStatus === 'completed' || cardStatus === 'failed' || cardStatus === 'aborted') &&
    (todoStatus === 'pending' || todoStatus === 'in_progress')
  ) {
    return 'ended';
  }

  return todoStatus;
}

export function formatDisplayedTodoStatus(status: string) {
  const labels: Record<string, string> = {
    in_progress: '进行中',
    pending: '待处理',
    completed: '已完成',
    cancelled: '已取消',
    ended: '已结束',
  };
  return labels[status] || status;
}
