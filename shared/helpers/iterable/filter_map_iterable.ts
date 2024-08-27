/**
 * Map each individual value of an iterable and remove null values. Same as a
 * combination of `Array.filter()` and `Array.map()` but for iterables.
 */
export function filterMapIterable<Value, NewValue>(
    iterable: Iterable<Value>,
    filterMap: (value: Value, index: number) => NewValue | undefined,
): Iterable<NewValue> {
    return {
        [Symbol.iterator]: function* () {
            let index = 0;
            for (const value of iterable) {
                const newValue = filterMap(value, index++);
                if (newValue !== undefined) yield newValue;
            }
        },
    };
}
