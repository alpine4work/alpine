import {InternalError} from "~/shared/error/error";
import {omitFromStackTrace} from "~/shared/helpers/control/omit-from-stack-trace";

/**
 * Throws an assertion error if the condition is falsy.
 *
 * An assertion is always expected to be true on every execution of the program. Assertion failures
 * in production should be a bug.
 *
 * Integrates with the type system so that assertions refine the type. We have a Babel plugin that
 * automatically generates a message for these function calls.
 */
export const assert: (condition: unknown, message?: string) => asserts condition =
    omitFromStackTrace((condition, message) => {
        if (!condition) {
            throw new InternalError(
                message ? `Assertion failure: ${message}` : "Assertion failure",
            );
        }
    });
