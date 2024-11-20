import {ErrorBase, InternalError, getErrorCode} from "~/shared/error/error.js";
import {ErrorCode} from "~/shared/error/error_code.js";
import {isSystemErrorCode} from "~/shared/error/is_system_error_code.js";
import {iterableFirst} from "~/shared/helpers/iterable/iterable_first.js";

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

export function getAggregateErrorPriority(error: unknown): number {
    if (error instanceof AggregateError && error.errors.length > 0) {
        return error.errors.map(getAggregateErrorPriority).reduce((a, b) => Math.max(a, b), 0);
    }

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
 * Create an `AggregateError` instance from multiple errors. We pick the error
 * with the highest priority (according to `getAggregateErrorPriority()`) to be
 * the message of the aggregate error.
 *
 * If there's only one error then we return that error. If there are zero errors
 * we return an `InternalError`. If `AggregateError`s are provided then we
 * flatten them in the resulting `AggregateError`s result list.
 */
export function createAggregateError(errors: Iterable<unknown>): unknown {
    const errorSet = new Set<unknown>();

    const pushError = (error: unknown) => {
        if (!(error instanceof AggregateError) || error.errors.length === 0) {
            errorSet.add(error);
        } else {
            for (const childError of error.errors) {
                pushError(childError);
            }
        }
    };

    for (const error of errors) {
        pushError(error);
    }

    if (errorSet.size === 1) return iterableFirst(errorSet);

    let highestPriority: number | null = null;
    let highestPriorityError: unknown;

    for (const error of errorSet) {
        const priority = getAggregateErrorPriority(error);

        if (highestPriority === null || highestPriority < priority) {
            highestPriority = priority;
            highestPriorityError = error;
        }
    }

    if (highestPriority === null) {
        return new InternalError("Tried to create an `AggregateError` with no errors");
    } else {
        const otherErrorCount = errorSet.size - 1;

        const error = new AggregateError(
            errorSet,
            `${
                highestPriorityError instanceof Error
                    ? highestPriorityError.message
                    : String(highestPriorityError)
            } (and ${otherErrorCount} other ${otherErrorCount === 1 ? "error" : "errors"})`,
        );

        (error as any).code = getErrorCode(highestPriorityError);

        return error;
    }
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
