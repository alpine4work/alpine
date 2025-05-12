/**
 * Creates a new set that's the intersection of the provided sets. The provided
 * sets are not changed.
 */
export function intersectSets<Value>(
    set1: ReadonlySet<Value>,
    set2: ReadonlySet<Value>,
): Set<Value> {
    const newSet = new Set<Value>();

    for (const value of set1) {
        if (set2.has(value)) {
            newSet.add(value);
        }
    }

    return newSet;
}
