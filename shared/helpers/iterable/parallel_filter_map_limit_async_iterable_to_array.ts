import {isSystemError} from "~/shared/error/is_system_error_code.js";
import {PromiseResolver, createPromiseResolver} from "~/shared/helpers/async/promise_resolver.js";

/**
 * Function that allows the user to perform a couple transformations on an
 * async iterable at once:
 *
 * 1. Map values into new values (same as `Array.map()`)
 * 2. Filter out values (same as `Array.filter()`)
 * 3. Limit the number of items pulled from the async iterable (similar to
 *    `Array.slice(0, limit)`)
 * 4. Convert the async iterable into an array (same as
 *    `arrayFromAsyncIterable()`)
 *
 * Importantly, unlike many async iterable map implementations the map function
 * may return a promise and all promises are run in parallel. Instead of
 * waiting for promises to resolve in sequence.
 *
 * We also don't return from the function on first rejection, instead waiting
 * for all parallel executed promises to settle.
 *
 * Ideally we could get behavior like this from a composable async iterator
 * combinator library but writing a high quality `parallelMap()` combinator
 * that returns an async iterator is tricky and you want each promise to be
 * awaited even if one rejects (or a consumer breaks out of a loop). It's
 * easier when you're returning a promise of an array. Which is why this all
 * gets clumped together.
 */
export async function parallelFilterMapLimitAsyncIterableToArray<Value, NewValue>(
    iterable: AsyncIterable<Value>,
    limit: number,
    filterMap: (value: Value, index: number) => Promise<NewValue | null>,
): Promise<Array<NewValue>> {
    let hasRejection = false;
    let firstRejectionReason;
    let hasSystemError = false;
    let firstSystemError;

    const array: Array<{index: number; value: NewValue}> = [];
    const promises = new Set<Promise<unknown>>();
    let limitStallPromiseResolver: PromiseResolver<{done: boolean}> | null = null;
    let filteredValueCount = 0;

    let currentIndex = 0;

    try {
        for await (const value of iterable) {
            // If we have an error, stop iterating!
            if (hasRejection) break;

            const index = currentIndex;
            currentIndex += 1;

            const newValuePromise = filterMap(value, index);
            promises.add(newValuePromise);

            newValuePromise.then(
                // eslint-disable-next-line no-loop-func
                newValue => {
                    promises.delete(newValuePromise);

                    // If the value was filtered out then we want to see the next item in the
                    // iteration. Unblock iteration.
                    if (newValue === null) {
                        filteredValueCount += 1;
                        limitStallPromiseResolver?.resolve({done: false});
                        limitStallPromiseResolver = null;
                    } else {
                        array.push({index, value: newValue});

                        // We've reached our limit! We can stop iterating.
                        if (array.length === limit) {
                            limitStallPromiseResolver?.resolve({done: true});
                            limitStallPromiseResolver = null;
                        }
                    }
                },
                // eslint-disable-next-line no-loop-func
                error => {
                    promises.delete(newValuePromise);

                    // Once an error is thrown we want to break out of the loop.
                    limitStallPromiseResolver?.resolve({done: true});
                    limitStallPromiseResolver = null;

                    // TODO(calebmer): Log all rejections in our telemetry, not just the first one.
                    if (!hasRejection) firstRejectionReason = error;
                    hasRejection = true;

                    if (!hasSystemError && isSystemError(error)) {
                        hasSystemError = true;
                        firstSystemError = error;
                    }
                },
            );

            // Stall iteration when going to the next item would surpass our limit. If
            // later a mapped item is filtered out then we'll resume iteration trying to
            // find a new value.
            if (index + 1 === limit + filteredValueCount) {
                limitStallPromiseResolver = createPromiseResolver();
                const {done} = await limitStallPromiseResolver.promise;
                if (done) break;
            }
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

    return array.sort((a, b) => a.index - b.index).map(({value}) => value);
}
