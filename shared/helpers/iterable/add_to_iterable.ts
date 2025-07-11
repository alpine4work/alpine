/**
 * Adds individual values at the end of an iterable. Similar to `Array.push()`
 * or `Set.add()`.
 */
export function addToIterable<Value>(
    iterable: Iterable<Value>,
    ...values: Array<Value>
): Iterable<Value> {
    return {
        [Symbol.iterator]: function* () {
            for (const value of iterable) {
                yield value;
            }
            for (const value of values) {
                yield value;
            }
        },
    };
}
