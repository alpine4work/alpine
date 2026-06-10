/**
 * Returns the first value where the predicate function returns true. The same as
 * `Array.find()` but for iterables.
 */
export function iterableFind<Value>(
    iterable: Iterable<Value>,
    find: (value: Value) => boolean,
): Value | undefined {
    for (const value of iterable) {
        if (find(value)) {
            return value;
        }
    }

    return undefined;
}
