// @vitest-environment node

import { describe, expect, it } from 'vitest';
import { deriveDisplayedTodoStatus, formatDisplayedTodoStatus } from './todo-display';

describe('deriveDisplayedTodoStatus', () => {
  it('keeps active todo statuses while a run is still executing', () => {
    expect(deriveDisplayedTodoStatus('in_progress', 'running')).toBe('in_progress');
    expect(deriveDisplayedTodoStatus('pending', 'waiting_for_input')).toBe('pending');
  });

  it('maps unfinished todos to ended after the run has already finished', () => {
    expect(deriveDisplayedTodoStatus('in_progress', 'completed')).toBe('ended');
    expect(deriveDisplayedTodoStatus('pending', 'failed')).toBe('ended');
    expect(deriveDisplayedTodoStatus('pending', 'aborted')).toBe('ended');
  });

  it('preserves explicit terminal todo statuses', () => {
    expect(deriveDisplayedTodoStatus('completed', 'completed')).toBe('completed');
    expect(deriveDisplayedTodoStatus('cancelled', 'aborted')).toBe('cancelled');
  });
});

describe('formatDisplayedTodoStatus', () => {
  it('formats ended status in chinese', () => {
    expect(formatDisplayedTodoStatus('ended')).toBe('已结束');
  });
});
