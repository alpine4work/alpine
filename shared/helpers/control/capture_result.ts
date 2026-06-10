import {Result} from "~/shared/helpers/control/result.js";

/**
 * Captures the result of a function which is either a normal return or an error
 * was thrown. This function never throws.
 *
 * To replay a result use `unwrapResult()`.
 */
export function captureResult<T>(action: () => T): Result<T> {
    try {
        const value = action();
        return {ok: true, value};
    } catch (error) {
        return {ok: false, error};
    }
}

/**
 * Unwraps a result by either returning the value or throwing an error.
 *
 * Replays the result of a function passed to `captureResult()`.
 */
export function unwrapResult<T, E = unknown>(result: Result<T, E>): T {
    if (result.ok) {
        return result.value;
    } else {
        throw result.error;
    }
}
