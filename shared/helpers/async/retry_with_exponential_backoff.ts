import {CancelledError, DeadlineExceededError} from "~/shared/error/error.js";

const originalSetTimeout = setTimeout;
const retrySymbol = Symbol("retry");

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
): Promise<Value> {
    const retry = (error?: unknown): never => {
        const retryError = new CancelledError("Retry", {cause: error});
        (retryError as any)[retrySymbol] = true;
        throw retryError;
    };

    const attempt = async (attemptNumber: number): Promise<Value> => {
        try {
            const value = await action(retry);
            return value;
        } catch (error) {
            // Is this an error we should retry?
            if (typeof error !== "object" || error === null || !(error as any)[retrySymbol]) {
                throw error;
            }

            const delayMs = 10 * 2 ** (attemptNumber - 1);

            if (delayMs > 1000 * 10)
                throw new DeadlineExceededError(
                    `Retry with exponential backoff failed after ${attemptNumber} attempts`,
                    {cause: (error as Error).cause},
                );

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
