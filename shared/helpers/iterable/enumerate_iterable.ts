/**
 * Enumerate each value of the given iterable and include the index of the value.
 */
export function enumerateIterable<Value>(iterable: Iterable<Value>): Iterable<[number, Value]> {
    return {
        [Symbol.iterator]: function* () {
            let index = 0;
            for (const value of iterable) {
                yield [index++, value];
            }
        },
    };
}
