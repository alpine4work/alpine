import {isSystemError} from "~/shared/error/is_system_error_code";

/**
 * Map every value in the async iterable in parallel and return the result as
 * an array. The mapper functions can be asynchronous themselves.
 *
 * This function only completes when we've seen every item from the iterable
 * and all the mapper functions have resolved.
 */
export async function parallelMapAsyncIterableToArray<Value, NewValue>(
    iterable: AsyncIterable<Value>,
    map: (value: Value, index: number) => Promise<NewValue>,
): Promise<Array<NewValue>> {
    let hasRejection = false;
    let firstRejectionReason;
    let hasSystemError = false;
    let firstSystemError;

    const array: Array<any> = [];
    const promises = new Set<Promise<unknown>>();

    try {
        for await (const item of iterable) {
            // If we have an error, stop iterating!
            if (hasRejection) break;

            const index = array.length;

            // Allocate space in the array for the item when it resolves.
            array.push(null);

            // Call our mapper function and note the promise. We need to wait for the
            // promise to resolve before returning.
            const promise = map(item, index);
            promises.add(promise);

            // When the promise resolves, add the new value to the array. If the promise
            // rejected then make sure to record the error if it's our first error.
            promise.then(
                newValue => {
                    promises.delete(promise);
                    array[index] = newValue;
                },
                // eslint-disable-next-line no-loop-func
                error => {
                    promises.delete(promise);

                    // TODO(calebmer): Log all rejections in our telemetry, not just the first one.
                    if (!hasRejection) firstRejectionReason = error;
                    hasRejection = true;

                    if (!hasSystemError && isSystemError(error)) {
                        hasSystemError = true;
                        firstSystemError = error;
                    }
                },
            );
        }
    } finally {
        // Make sure we always wait for any promise we started to resolve. If any
        // promise threw while we were awaiting, rethrow that error.
        await Promise.allSettled(promises);

        // If we had a system error, prioritize throwing that. Otherwise throw the
        // first error we saw.
        if (hasSystemError) throw firstSystemError;
        if (hasRejection) throw firstRejectionReason;
    }

    return array;
}
