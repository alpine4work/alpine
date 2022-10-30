import {createPromiseResolver} from "~/shared/helpers/async/promise-resolver";

/**
 * Interleave the values of multiple async iterators together. Values from each
 * iterator appears in the combined iterator when it's ready. The values from
 * the iterators have no order relative to each other.
 *
 * Resolves once all iterators we're merging together resolve. If one iterator
 * errors before the others finish, we wait for the others to finish before
 * rejecting the entire iterator.
 */
export async function* interleaveAsyncIterableIterators<Value>(
    ...iterators: Array<AsyncIterableIterator<Value>>
): AsyncIterableIterator<Value> {
    let stepPromiseResolver = createPromiseResolver<{done: false; value: Value} | {done: true}>();

    void (async () => {
        const results = await Promise.allSettled(
            iterators.map(async iterator => {
                for await (const value of iterator) {
                    stepPromiseResolver.resolve({done: false, value});
                    stepPromiseResolver = createPromiseResolver();
                }
            }),
        );

        for (const result of results) {
            if (result.status === "rejected") {
                stepPromiseResolver.reject(result.reason);
                return;
            }
        }

        stepPromiseResolver.resolve({done: true});
    })();

    while (true) {
        const step = await stepPromiseResolver.promise;
        if (step.done) break;
        yield step.value;
    }
}
