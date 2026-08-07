/**
 * Combines multiple iterables together into one. Each iterable running after the
 * other in sequence. Same as `Array.concat()` but for iterables.
 */
export function concatIterables<Value>(...iterables: Array<Iterable<Value>>): Iterable<Value> {
    return {
        [Symbol.iterator]: function* () {
            for (const iterable of iterables) {
                for (const value of iterable) {
                    yield value;
                }
            }
        },
    };
}
