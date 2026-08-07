import {Result} from "~/shared/helpers/control/result.open_source.js";

/**
 * Captures the result of a function which is either a normal return or an error
 * was thrown. This function never throws.
 *
 * To replay a result use `unwrapResult()`.
 */
export async function captureResultPromise<T>(
    action: Promise<T> | (() => Promise<T>),
): Promise<Result<T>> {
    try {
        const value = await (typeof action === "function" ? action() : action);
        return {ok: true, value};
    } catch (error) {
        return {ok: false, error};
    }
}

/**
 * Unwraps a result by either returning the value or throwing an error.
 *
 * Replays the result of a function passed to `captureResultPromise()`. You could
 * also use `unwrapResult()` if you're ok with synchronously throwing.
 */
export function unwrapResultPromise<T, E = unknown>(result: Result<T, E>): Promise<T> {
    if (result.ok) {
        return Promise.resolve(result.value);
    } else {
        return Promise.reject(result.error);
    }
}
