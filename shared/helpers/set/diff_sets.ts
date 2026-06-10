/**
 * Creates a set that's the result of removing all values in `set2` from `set1`.
 * The provided sets are not changed.
 */
export function diffSets<Value>(set1: ReadonlySet<Value>, set2: ReadonlySet<Value>): Set<Value> {
    const newSet = new Set<Value>(set1);

    for (const value of set2) {
        newSet.delete(value);
    }

    return newSet;
}
