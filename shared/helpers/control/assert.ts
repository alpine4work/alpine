import {InternalError} from "~/shared/error/error.js";

/**
 * Throws an assertion error if the condition is falsy.
 *
 * An assertion is always expected to be true on every execution of the
 * program. Assertion failures in production should always be a bug.
 *
 * Integrates with the type system so that assertions refine the type.
 */
// TODO(calebmer): Lint rule that the right `assert()` is being imported.
// TODO(calebmer): Transform that automatically adds error message.
export function assert(condition: unknown, message?: string): asserts condition {
    if (!condition) {
        const error = new InternalError(
            message ? `Assertion failure: ${message}` : "Assertion failure",
        );

        // Inlined from `omitFromStackTrace()` since this is a performance critical
        // function. Excludes the `assert()` stack frame from the error's stack for
        // better debugging.
        if ((Error as any).captureStackTrace) {
            (Error as any).captureStackTrace(error, assert);
        }

        throw error;
    }
}
