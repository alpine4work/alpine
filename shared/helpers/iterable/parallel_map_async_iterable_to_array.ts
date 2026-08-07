import {createAggregateError} from "~/shared/error/aggregate_error.open_source.js";

/**
 * Map every value in the async iterable in parallel and return the result as an
 * array. The mapper functions can be asynchronous themselves.
 *
 * This function only completes when we've seen every item from the iterable and
 * all the mapper functions have resolved.
 */
export async function parallelMapAsyncIterableToArray<Value, NewValue>(
    iterable: AsyncIterable<Value>,
    map: (value: Value, index: number) => Promise<NewValue>,
): Promise<Array<NewValue>> {
    const array: Array<any> = [];
    const promises = new Set<Promise<unknown>>();
    const errors: Array<unknown> = [];

    try {
        for await (const item of iterable) {
            // If we have an error, stop iterating!
            if (errors.length > 0) break;

            const index = array.length;

            // Allocate space in the array for the item when it resolves.
            array.push(null);

            // Call our mapper function and note the promise. We need to wait for the promise
            // to resolve before returning.
            const promise = map(item, index);
            promises.add(promise);

            // When the promise resolves, add the new value to the array. If the promise
            // rejected then make sure to record the error if it's our first error.
            promise.then(
                newValue => {
                    promises.delete(promise);
                    array[index] = newValue;
                },
                error => {
                    promises.delete(promise);
                    errors.push(error);
                },
            );
        }
    } finally {
        // Make sure we always wait for any promise we started to resolve. If any promise
        // threw while we were awaiting, rethrow that error.
        await Promise.allSettled(promises);

        if (errors.length > 0) throw createAggregateError(errors);
    }

    return array;
}
