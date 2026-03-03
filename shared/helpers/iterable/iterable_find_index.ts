/**
 * Returns the index of the first value where the predicate function returns true.
 * The same as `Array.findIndex()` but for iterables.
 */
export function iterableFindIndex<Value>(
    iterable: Iterable<Value>,
    find: (value: Value) => boolean,
): number {
    let index = 0;

    for (const value of iterable) {
        if (find(value)) {
            return index;
        }

        index++;
    }

    return -1;
}
