/**
 * Map each individual value of an async iterator. Same as `Array.map()` but for
 * async iterators.
 */
export async function* mapAsyncIterableIterator<Value, NewValue>(
    iterator: AsyncIterableIterator<Value>,
    map: (value: Value, index: number) => NewValue,
): AsyncIterableIterator<NewValue> {
    let index = 0;
    for await (const value of iterator) {
        yield map(value, index++);
    }
}
