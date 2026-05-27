// @vitest-environment node

import { describe, expect, it, vi } from 'vitest';

import { createHistoryManager } from '../../public/page-edit/vendor/app/features/history.js';

function createCommand(overrides: Partial<{ undo: () => void; redo: () => void }> = {}) {
  return {
    undo: vi.fn(),
    redo: vi.fn(),
    ...overrides,
  };
}

describe('createHistoryManager', () => {
  it('record 后可以 undo', () => {
    const history = createHistoryManager();
    const command = createCommand();

    history.record(command);

    expect(history.canUndo()).toBe(true);

    history.undo();

    expect(command.undo).toHaveBeenCalledTimes(1);
    expect(history.canUndo()).toBe(false);
    expect(history.canRedo()).toBe(true);
  });

  it('undo 后可以 redo', () => {
    const history = createHistoryManager();
    const command = createCommand();

    history.record(command);
    history.undo();
    history.redo();

    expect(command.redo).toHaveBeenCalledTimes(1);
    expect(history.canUndo()).toBe(true);
    expect(history.canRedo()).toBe(false);
  });

  it('新记录会清空 redoStack', () => {
    const history = createHistoryManager();
    const first = createCommand();
    const second = createCommand();

    history.record(first);
    history.undo();

    expect(history.canRedo()).toBe(true);

    history.record(second);

    expect(history.canRedo()).toBe(false);
  });

  it('空历史 undo 和 redo 会静默忽略', () => {
    const history = createHistoryManager();

    expect(() => {
      history.undo();
      history.redo();
    }).not.toThrow();

    expect(history.canUndo()).toBe(false);
    expect(history.canRedo()).toBe(false);
  });

  it('回放历史时 nested record 不会生效', () => {
    const history = createHistoryManager();
    const nested = createCommand();
    const command = createCommand({
      undo: () => {
        history.record(nested);
      },
      redo: () => {
        history.record(nested);
      },
    });

    history.record(command);
    history.undo();

    expect(history.canUndo()).toBe(false);
    expect(history.canRedo()).toBe(true);

    history.redo();

    expect(history.canUndo()).toBe(true);
    expect(history.canRedo()).toBe(false);
  });
});
