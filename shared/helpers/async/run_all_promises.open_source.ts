import {createAggregateError} from "~/shared/error/aggregate_error.open_source.js";

/**
 * Runs multiple promises in parallel. Should generally be used instead of
 * `Promise.all()`.
 *
 * Advantages over `Promise.all()`:
 *
 * - If an error occurs, we still wait for all promises to resolve. Under the hood
 *   we implement this function with `Promise.allSettled()`. This is safer than
 *   `Promise.all()` since you won't get dangling promises.
 * - You can pass in a function instead of a promise and we will call the function
 *   for you.
 * - If there were multiple errors and one error has a higher severity than another
 *   error then we will throw the highest severity error. If all errors are of the
 *   same severity then we will throw the first error.
 * - We log all errors to telemetry even though we can only throw one.
 */
// TODO(calebmer): Lint rule banning `Promise.all()` and recommending this utility.
export async function runAllPromises<const Promises extends ReadonlyArray<unknown>>(
    promises: Promises,
): Promise<{-readonly [K in keyof Promises]: Awaited<Promises[K]>}>;
export async function runAllPromises<Value>(
    promises: Iterable<Value>,
): Promise<Array<Awaited<Value>>>;
export async function runAllPromises<Value>(
    promises: Iterable<Value>,
): Promise<Array<Awaited<Value>>> {
    const results = await Promise.allSettled(promises);

    const errors: Array<unknown> = [];
    const values: Array<Awaited<Value>> = [];

    for (const result of results) {
        if (result.status === "rejected") {
            errors.push(result.reason);
            continue;
        }

        if (errors.length === 0) values.push(result.value);
    }

    if (errors.length > 0) throw createAggregateError(errors);

    return values;
}

/**
 * Runs multiple promises in parallel. Same as `runAllPromises()` but you can write
 * the promise as a thunk and we will call the thunk as a function.
 */
export function runAllPromiseThunks<PromiseThunks extends ReadonlyArray<() => Promise<unknown>>>(
    ...promiseThunks: PromiseThunks
): Promise<{-readonly [K in keyof PromiseThunks]: Awaited<ReturnType<PromiseThunks[K]>>}> {
    return runAllPromises(promiseThunks.map(thunk => thunk())) as any;
}

/**
 * Run all promises in an object in parallel. Returns an object of the same shape.
 * Returns `runAllPromises()` under the hood.
 */
export async function runAllObjectPromises<const Promises extends {}>(
    promises: Promises,
): Promise<{[K in keyof Promises]: Awaited<Promises[K]>}> {
    const entries = Object.entries(promises);
    const values = await runAllPromises(entries.map(([, promise]) => promise));
    return Object.fromEntries(entries.map(([key], index) => [key, values[index]!])) as any;
}
