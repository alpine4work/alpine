/**
 * Convert an async iterable into an array. Same as `Array.from()` but
 * asynchronous.
 */
export async function arrayFromAsyncIterable<Value, NewValue = Value>(
    iterable: AsyncIterable<Value>,
    map?: (item: Value) => NewValue,
): Promise<Array<NewValue>> {
    const array: Array<NewValue> = [];

    for await (const item of iterable) {
        array.push(map !== undefined ? map(item) : (item as NewValue));
    }

    return array;
}
