/**
 * Throws the provided error value. Useful when you need to throw an error but
 * syntactically you're in an expression context. Since in JavaScript the `throw`
 * keyword must be used in a statement. Prefer the `throw` keyword whenever
 * possible but this is useful in certain situations.
 *
 * For example:
 *
 * ```ts
 * const answer = condition ? 42 : throwError(new UnimplementedError("..."));
 *
 * const action = () => throwError(new PermissionDeniedError("..."));
 * ```
 *
 * Without the `throwError()` utility you'd need to write:
 *
 * ```ts
 * const answer = condition
 *     ? 42
 *     : (() => {
 *           throw new UnimplementedError("...");
 *       })();
 *
 * const action = () => {
 *     throw new PermissionDeniedError("...");
 * };
 * ```
 */
export function throwError(error: unknown): never {
    // Inlined from `omitFromStackTrace()`.
    if (error instanceof Error && (Error as any).captureStackTrace) {
        (Error as any).captureStackTrace(error, throwError);
    }

    throw error;
}
