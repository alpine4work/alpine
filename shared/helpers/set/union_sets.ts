/**
 * Creates a new set that's the union of the two provided sets. The provided sets
 * are not changed.
 */
export function unionSets<T>(set1: ReadonlySet<T>, set2: ReadonlySet<T>): Set<T> {
    const newSet = new Set<T>();

    for (const item of set1) {
        newSet.add(item);
    }

    for (const item of set2) {
        newSet.add(item);
    }

    return newSet;
}
