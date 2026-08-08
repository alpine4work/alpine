/**
 * Map each individual value of an iterable. Same as `Array.map()` but for
 * iterables.
 */
export function mapIterable<Value, NewValue>(
    iterable: Iterable<Value>,
    map: (value: Value, index: number) => NewValue,
): Iterable<NewValue> {
    return {
        [Symbol.iterator]: function* () {
            let index = 0;
            for (const value of iterable) {
                yield map(value, index++);
            }
        },
    };
}
