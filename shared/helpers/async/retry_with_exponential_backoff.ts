import {CancelledError, DeadlineExceededError} from "~/shared/error/error.js";
import {emptyObject} from "~/shared/helpers/object/empty_object.js";

/**
 * The default number of times we'll retry in `retryWithExponentialBackoff()`.
 * The delay between attempts maxes out at 10s.
 */
export const defaultMaxRetryAttemptCount = 15;

const originalSetTimeout = setTimeout;

const retryKeySymbol = Symbol("retry");

/**
 * If this is an error thrown by calling the `retry()` function in
 * `retryWithExponentialBackoff()`?
 */
export function isRetryError(error: unknown): error is CancelledError {
    if (!(error instanceof CancelledError)) return false;
    return !!(error as any)[retryKeySymbol];
}

/**
 * Retries an action with exponential backoff with jitter. Since we use
 * exponential backoff, retry delays can get quite long.
 *
 * Only retry actions when it is safe to do so. A retry should not appear to
 * the user as if the action executed twice. If your action is idempotent
 * that's a great way to ensure retries are safe.
 *
 * There are two ways to trigger a retry:
 *
 * 1. We pass a `retry()` function to your action. If you call this function
 *    then an error will be thrown that causes a retry.
 * 2. You may pass a function that looks at errors thrown by the action. If the
 *    function returns true then we will retry.
 *
 * The `retry()` function only applies to the `retryWithExponentialBackoff()`
 * call it is from. So nested `retryWithExponentialBackoff()` calls won't get
 * mixed up.
 *
 * This is a [great article on retries from AWS][1]. This article from [AWS
 * explains why adding jitter is also important][2] and a good jitter strategy.
 *
 * Carefully designed so that nested calls to this function don't create
 * exponential blow up in failure scenarios. If a nested retry loop times out
 * then parent retry loops won't retry. (Since their `retry()` function wasn't
 * called.)
 *
 * [1]: https://aws.amazon.com/builders-library/timeouts-retries-and-backoff-with-jitter/
 * [2]: https://aws.amazon.com/blogs/architecture/exponential-backoff-and-jitter/
 */
export function retryWithExponentialBackoff<Value>(
    action: (retry: (error?: unknown) => never) => Promise<Value>,
    {maxAttemptCount = defaultMaxRetryAttemptCount}: {maxAttemptCount?: number} = emptyObject,
): Promise<Value> {
    // Important that this retry symbol is local to this function call. That way
    // when you have nested `retryWithExponentialBackoff()`s we correctly retry the
    // one whose `retry()` function was called.
    const retryValueSymbol = Symbol();

    const retry = (error?: unknown): never => {
        const retryError = new CancelledError("Retry", {cause: error});
        (retryError as any)[retryKeySymbol] = retryValueSymbol;
        throw retryError;
    };

    const shouldRetry = (error: unknown): boolean => {
        return (
            typeof error === "object" &&
            error !== null &&
            ((error as any)[retryKeySymbol] === retryValueSymbol ||
                (error instanceof AggregateError &&
                    error.errors.length > 0 &&
                    error.errors.every(shouldRetry)))
        );
    };

    const attempt = async (attemptNumber: number): Promise<Value> => {
        try {
            const value = await action(retry);
            return value;
        } catch (error) {
            if (!shouldRetry(error)) {
                throw error;
            }

            const delayMs = Math.min(2 ** attemptNumber, 1000 * 10);

            // Help developers debug retry loops. If we reach ~12 attempts during tests
            // then there's probably a bug in the developer's code! That's causing them to
            // retry forever without terminating. We log an error so a stack trace is
            // included and the developer can find the offending code.
            if (process.env.NODE_ENV === "test" && delayMs >= 4 * 1000) {
                // eslint-disable-next-line no-console
                console.error(
                    new DeadlineExceededError(
                        `\`retryWithExponentialBackoff()\` has made ${attemptNumber} attempts and is about to wait for ${delayMs}ms`,
                    ),
                );
            }

            if (attemptNumber >= maxAttemptCount) {
                throw new DeadlineExceededError(
                    `Retry with exponential backoff failed after ${attemptNumber} attempts`,
                    {cause: (error as Error).cause},
                );
            }

            // We add jitter to our exponential backoff so that many requests retried at
            // the same time do not cause the same resource contention which may have
            // caused the errors in the first place.
            // See: https://aws.amazon.com/blogs/architecture/exponential-backoff-and-jitter
            const delayMsWithJitter = Math.floor(Math.random() * delayMs);

            // We can't use `wait()` or `setTimeout()` since Jest will override
            // `setTimeout()` when `jest.useFakeTimers()` is on. But we want to wait the
            // timeout anyway.
            await new Promise(resolve => originalSetTimeout(resolve, delayMsWithJitter));
            return attempt(attemptNumber + 1);
        }
    };

    return attempt(1);
}
