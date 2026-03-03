/**
 * Returns the first non-undefined value from the `findMap` function. A combination
 * of `Array.find()` and `Array.map()`.
 *
 * This is the same as `iterableFirst(filterMapIterable(iterable, findMap))` but
 * with one function.
 */
export function findMapIterable<Value, NewValue>(
    iterable: Iterable<Value>,
    findMap: (value: Value, index: number) => NewValue | undefined,
): NewValue | undefined {
    let index = 0;
    for (const value of iterable) {
        const newValue = findMap(value, index++);
        if (newValue !== undefined) return newValue;
    }
}
