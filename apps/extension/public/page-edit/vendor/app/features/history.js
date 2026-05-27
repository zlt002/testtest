export function createHistoryManager() {
  const undoStack = []
  const redoStack = []
  let isApplyingHistory = false

  function applyHistory(methodName, sourceStack, targetStack) {
    const command = sourceStack.pop()
    if (!command) return

    isApplyingHistory = true

    try {
      command[methodName]?.()
      targetStack.push(command)
    } finally {
      isApplyingHistory = false
    }
  }

  return {
    get undoStack() {
      return undoStack
    },
    get redoStack() {
      return redoStack
    },
    get isApplyingHistory() {
      return isApplyingHistory
    },
    record(command) {
      if (!command || isApplyingHistory) return

      undoStack.push(command)
      redoStack.length = 0
    },
    undo() {
      applyHistory('undo', undoStack, redoStack)
    },
    redo() {
      applyHistory('redo', redoStack, undoStack)
    },
    clear() {
      undoStack.length = 0
      redoStack.length = 0
    },
    canUndo() {
      return undoStack.length > 0
    },
    canRedo() {
      return redoStack.length > 0
    },
  }
}
