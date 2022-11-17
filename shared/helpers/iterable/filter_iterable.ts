/**
 * Filters values out of an iterable. Same as `Array.filter()` but
 * for iterables.
 */
export function filterIterable<Value>(
    iterable: Iterable<Value>,
    filter: (value: Value, index: number) => boolean,
): Iterable<Value> {
    return {
        [Symbol.iterator]: function* () {
            let index = 0;
            for (const value of iterable) {
                const include = filter(value, index++);
                if (include) yield value;
            }
        },
    };
}
