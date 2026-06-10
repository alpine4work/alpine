/**
 * Flattens a nested iterable into one iterable. Same as `Array.flat()` but for
 * iterables.
 */
export function flatIterable<Value>(iterable: Iterable<Iterable<Value>>): Iterable<Value> {
    return {
        [Symbol.iterator]: function* () {
            for (const value of iterable) {
                yield* value;
            }
        },
    };
}
