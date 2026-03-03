/**
 * Map each individual value of an async iterable and remove null values. Same as a
 * combination of `Array.filter()` and `Array.map()` but for iterables.
 */
export async function* filterMapAsyncIterableIterator<Value, NewValue>(
    iterator: AsyncIterableIterator<Value>,
    map: (value: Value, index: number) => NewValue | null,
): AsyncIterableIterator<NewValue> {
    let index = 0;
    for await (const value of iterator) {
        const newValue = map(value, index++);
        if (newValue !== null) yield newValue;
    }
}
