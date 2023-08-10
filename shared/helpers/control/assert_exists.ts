import {InternalError} from "~/shared/error/error.js";

/**
 * Throws an assertion error if the condition is null or undefined.
 *
 * An assertion is always expected to pass. Assertion failures in production
 * should be a bug.
 */
// TODO(calebmer, #swc-transform): SWC transform that automatically adds an
// error message and inlines this function. A direct `if` condition will be
// faster than a function call for how much this gets used.
//
// Error message should be the stringified expression. For example
// `assert(x === 2)` should be transformed to `assert(x === 2, "x === 2")`.
export function assertExists<T>(value: T | null | undefined, message?: string): T {
    if (value === null || value === undefined) {
        const error = new InternalError(
            message ? `Assertion failure: ${message}` : "Assertion failure",
        );

        // Inlined from `omitFromStackTrace()` since this is a performance critical
        // function. Excludes the `assertExists()` stack frame from the error's stack
        // for better debugging.
        if ((Error as any).captureStackTrace) {
            (Error as any).captureStackTrace(error, assertExists);
        }

        throw error;
    }

    return value;
}
