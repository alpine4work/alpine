import {InternalError} from "~/shared/error/error.js";

/**
 * Throws an assertion error if the condition is null or undefined.
 *
 * An assertion is always expected to pass. Assertion failures in production
 * should be a bug.
 */
// TODO(calebmer): Transform that automatically adds error message.
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
