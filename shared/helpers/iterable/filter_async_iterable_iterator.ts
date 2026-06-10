/**
 * For each individual value of an async iterator, decide if we should remove it
 * from the iterable. Same as `Array.filter()` but for async iterators.
 */
export async function* filterAsyncIterableIterator<Value>(
    iterator: AsyncIterableIterator<Value>,
    filter: (value: Value, index: number) => boolean,
): AsyncIterableIterator<Value> {
    let index = 0;
    for await (const value of iterator) {
        if (filter(value, index++)) {
            yield value;
        }
    }
}
