/**
 * Map each individual value of an async iterator. Same as `Array.map()` but
 * for async iterators.
 */
export async function* asyncIterableIteratorMap<Value, NewValue>(
    iterator: AsyncIterableIterator<Value>,
    map: (value: Value) => NewValue,
): AsyncIterableIterator<NewValue> {
    for await (const value of iterator) {
        yield map(value);
    }
}
