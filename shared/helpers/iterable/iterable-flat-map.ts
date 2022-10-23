/**
 * Map each individual value of an iterable into an iterable. Same as
 * `Array.flatMap()` but for iterables.
 */
export function iterableFlatMap<Value, NewValue>(
    iterable: Iterable<Value>,
    map: (value: Value) => Iterable<NewValue>,
): Iterable<NewValue> {
    return {
        [Symbol.iterator]: function* () {
            for (const value of iterable) {
                yield* map(value);
            }
        },
    };
}
