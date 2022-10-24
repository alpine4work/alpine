import {ErrorBase} from "~/shared/error/error";
import {isHttp500ErrorCode} from "~/shared/error/is-http-500-error-code";

type AwaitedThunk<T> = T extends () => infer U ? Awaited<U> : Awaited<T>;

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
export async function runAllPromises<
    Promises extends ReadonlyArray<Promise<unknown> | (() => Promise<unknown>)>,
>(promises: Promises): Promise<{-readonly [K in keyof Promises]: AwaitedThunk<Promises[K]>}> {
    const results = await Promise.allSettled(
        promises.map(promise => (typeof promise === "function" ? promise() : promise)),
    );

    let hasRejection = false;
    let internalError: ErrorBase | null = null;
    let firstRejectionReason;
    const values = [];

    for (const result of results) {
        // TODO(calebmer): Log all rejections in our telemetry, not just the first one.
        if (result.status === "rejected") {
            if (!hasRejection) firstRejectionReason = result.reason;
            hasRejection = true;

            if (
                result.reason instanceof ErrorBase &&
                // Maybe we should rank errors by severity instead of a binary "is internal
                // server error or user error" ranking.
                isHttp500ErrorCode(result.reason.code)
            ) {
                internalError = result.reason;
                break;
            }

            continue;
        }

        if (!hasRejection) values.push(result.value);
    }

    if (internalError) throw internalError;
    if (hasRejection) throw firstRejectionReason;

    return values as any;
}
