/**
 * Map each individual value of an iterable. Same as `Array.map()` but
 * for iterables.
 */
export function iterableMap<Value, NewValue>(
    iterable: Iterable<Value>,
    map: (value: Value) => NewValue,
): Iterable<NewValue> {
    return {
        [Symbol.iterator]: function* () {
            for (const value of iterable) {
                yield map(value);
            }
        },
    };
}
