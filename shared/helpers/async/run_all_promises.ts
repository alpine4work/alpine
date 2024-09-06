import {ErrorBase} from "~/shared/error/error.js";
import {ErrorCode} from "~/shared/error/error_code.js";
import {isSystemErrorCode} from "~/shared/error/is_system_error_code.js";

/**
 * Runs multiple promises in parallel. Should generally be used instead of
 * `Promise.all()`.
 *
 * Advantages over `Promise.all()`:
 *
 * - If an error occurs, we still wait for all promises to resolve. Under the
 *   hood we implement this function with `Promise.allSettled()`. This is safer
 *   than `Promise.all()` since you won't get dangling promises.
 * - You can pass in a function instead of a promise and we will call the
 *   function for you.
 * - If there were multiple errors and one error has a higher severity than
 *   another error then we will throw the highest severity error. If all errors
 *   are of the same severity then we will throw the first error.
 * - We log all errors to telemetry even though we can only throw one.
 */
// TODO(calebmer): Lint rule banning `Promise.all()` and recommending this
// utility.
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

    let hasError = false;
    let errorPriority = 0;
    let error;
    const values: Array<Awaited<Value>> = [];

    for (const result of results) {
        // TODO(calebmer, #aggregate-error): Log all rejections in our telemetry, not
        // just the first one. Probably by using an `AggregateError`.
        //
        // `retryWithExponentialBackoff()` and `context.dynamo.retryTransaction()`
        // should maybe still be able to detect retries from a `runAllPromises()`
        // `AggregateError`.
        if (result.status === "rejected") {
            const newError = result.reason;
            const newErrorPriority = getAggregateErrorPriority(newError);

            if (!hasError) {
                hasError = true;
                errorPriority = newErrorPriority;
                error = newError;
            } else if (newErrorPriority > errorPriority) {
                errorPriority = newErrorPriority;
                error = newError;
            }
            continue;
        }

        if (!hasError) values.push(result.value);
    }

    // Throw the first error with the highest priority we saw.
    if (hasError) throw error;

    return values;
}

export function getAggregateErrorPriority(error: unknown) {
    const isErrorBase = error instanceof ErrorBase;

    let priority = 2;

    // Errors with a display message are higher priority than errors without a
    // display message.
    if (isErrorBase && error.displayMessage !== undefined) {
        priority = 3;
    }
    // Cancelled errors (e.g. from `AbortSignal`s) are lower priority than other
    // errors.
    else if (isErrorBase && error.code === ErrorCode.Cancelled) {
        priority = 1;
    }

    // System errors are highest priority. If an error doesn't have a code then its
    // code is `ErrorCode.Unknown` which is a system error.
    if (!isErrorBase || isSystemErrorCode(error.code)) priority += 4;

    return priority;
}

/**
 * Runs multiple promises in parallel. Same as `runAllPromises()` but you can
 * write the promise as a thunk and we will call the thunk as a function.
 */
export function runAllPromiseThunks<PromiseThunks extends ReadonlyArray<() => Promise<unknown>>>(
    ...promiseThunks: PromiseThunks
): Promise<{-readonly [K in keyof PromiseThunks]: Awaited<ReturnType<PromiseThunks[K]>>}> {
    return runAllPromises(promiseThunks.map(thunk => thunk())) as any;
}

/**
 * Run all promises in an object in parallel. Returns an object of the same
 * shape. Returns `runAllPromises()` under the hood.
 */
export async function runAllObjectPromises<const Promises extends {}>(
    promises: Promises,
): Promise<{[K in keyof Promises]: Awaited<Promises[K]>}> {
    const entries = Object.entries(promises);
    const values = await runAllPromises(entries.map(([, promise]) => promise));
    return Object.fromEntries(entries.map(([key], index) => [key, values[index]!])) as any;
}
