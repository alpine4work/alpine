import {InternalError} from "~/shared/error/error.js";

/**
 * Throws an assertion error if the condition is falsy.
 *
 * An assertion is always expected to be true on every execution of the program.
 * Assertion failures in production should always be a bug.
 *
 * Integrates with the type system so that assertions refine the type.
 *
 * Generally prefer `assert()` over `assertExists()` since it's more flexible.
 * `assertExists(value)` and `assert(value)` usually do the same thing (unless
 * `value` is `false`, `0`, or `""`). `assertExists()` is mostly useful in some
 * cases for writing cleaner code.
 *
 * For example, say you have an arrow function that returns an expression
 * (`() => value` instead of the block syntax `() => { return value }`):
 *
 * ```ts
 * () => functionCall(assertExists(nullableValue));
 * ```
 *
 * The above is slightly neater than:
 *
 * ```ts
 * () => {
 *     assert(nullableValue);
 *     return functionCall(nullableValue);
 * };
 * ```
 *
 * Another example, you have some code that returns a nullable value you're
 * assigning to a variable you want to assert is non-null (this happens a lot with
 * React refs):
 *
 * ```ts
 * const value = assertExists(valueRef.current);
 * ```
 *
 * The above is slightly neater than:
 *
 * ```ts
 * assert(valueRef.current);
 * const value = valueRef.current;
 * ```
 */
// TODO(calebmer): Lint rule that the right `assert()` is being imported.
//
// TODO(calebmer, #swc-transform): SWC transform that automatically adds an error
// message and inlines this function. A direct `if` condition will be faster than a
// function call for how much this gets used.
//
// Error message should be the stringified expression. For example
// `assert(x === 2)` should be transformed to `assert(x === 2, "\\`x === 2\\`")`.
export function assert(condition: unknown, message?: string): asserts condition {
    if (!condition) {
        const error = new InternalError(
            message ? `Assertion failure: ${message}` : "Assertion failure",
        );

        // Inlined from `omitFromStackTrace()` since this is a performance critical
        // function. Excludes the `assert()` stack frame from the error's stack for better
        // debugging.
        if ((Error as any).captureStackTrace) {
            (Error as any).captureStackTrace(error, assert);
        }

        throw error;
    }
}
