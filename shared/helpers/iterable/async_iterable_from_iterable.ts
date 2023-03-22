/**
 * Hoist a synchronous iterable into an asynchronous iterable.
 */
export async function* asyncIterableFromIterable<Value>(
    iterable: Iterable<Value>,
): AsyncIterableIterator<Value> {
    for (const value of iterable) {
        yield value;
    }
}
