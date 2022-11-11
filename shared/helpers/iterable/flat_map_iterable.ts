/**
 * Map each individual value of an iterable into an iterable. Same as
 * `Array.flatMap()` but for iterables.
 */
export function flatMapIterable<Value, NewValue>(
    iterable: Iterable<Value>,
    map: (value: Value, index: number) => Iterable<NewValue>,
): Iterable<NewValue> {
    return {
        [Symbol.iterator]: function* () {
            let index = 0;
            for (const value of iterable) {
                yield* map(value, index++);
            }
        },
    };
}
