let applyUndoStackEntryCount = 0;

export function isTaskGridViewApplyingUndoStackEntry(): boolean {
    return applyUndoStackEntryCount > 0;
}

export function withApplyTaskGridViewUndoStackEntry<Value>(action: () => Value): Value {
    applyUndoStackEntryCount++;
    try {
        const value = action();
        return value;
    } finally {
        applyUndoStackEntryCount--;
    }
}
