/**
 * Convert an async iterable into an array. Same as `Array.from()` but
 * asynchronous.
 */
export async function arrayFromAsyncIterable<Value>(
    iterable: AsyncIterable<Value>,
): Promise<Array<Value>> {
    const array: Array<Value> = [];

    for await (const item of iterable) {
        array.push(item);
    }

    return array;
}
