/**
 * An iterable that includes the index of each item as the second element in the
 * tuple.
 */
export function iterableWithIndex<Value>(iterable: Iterable<Value>): Iterable<[Value, number]> {
    return {
        [Symbol.iterator]: function* () {
            let index = 0;
            for (const value of iterable) {
                yield [value, index++];
            }
        },
    };
}
