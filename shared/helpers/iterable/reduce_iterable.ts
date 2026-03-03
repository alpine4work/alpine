/**
 * Reduce an iterable into a single value. Same as `Array.reduce()` but for
 * iterables.
 */
export function reduceIterable<Item, Value>(
    iterable: Iterable<Item>,
    reduce: (value: Value, item: Item, index: number) => Value,
    initialValue: Value,
): Value {
    let value = initialValue;

    let index = 0;
    for (const item of iterable) {
        value = reduce(value, item, index++);
    }

    return value;
}
