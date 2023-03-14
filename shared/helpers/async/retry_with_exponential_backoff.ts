import {CancelledError, DeadlineExceededError} from "~/shared/error/error";
import {wait} from "~/shared/helpers/async/wait";

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
 * [1]: https://aws.amazon.com/builders-library/timeouts-retries-and-backoff-with-jitter/
 * [2]: https://aws.amazon.com/blogs/architecture/exponential-backoff-and-jitter/
 */
export function retryWithExponentialBackoff<Value>(
    action: (retry: () => never) => Promise<Value>,
    shouldRetryError?: (error: unknown) => boolean,
): Promise<Value> {
    const retryError = new CancelledError("Retry");
    const retry = (): never => {
        throw retryError;
    };

    const attempt = async (attemptNumber: number): Promise<Value> => {
        try {
            const value = await action(retry);
            return value;
        } catch (error) {
            // Is this an error we should retry?
            if (error !== retryError && !shouldRetryError?.(error)) throw error;

            const delayMs = 10 * 2 ** (attemptNumber - 1);

            if (delayMs > 1000 * 10)
                throw new DeadlineExceededError(
                    `Retry with exponential backoff failed after ${attemptNumber} attempts`,
                    {cause: error},
                );

            // We add jitter to our exponential backoff so that many requests retried at
            // the same time do not cause the same resource contention which may have
            // caused the errors in the first place.
            // See: https://aws.amazon.com/blogs/architecture/exponential-backoff-and-jitter
            const delayMsWithJitter = Math.floor(Math.random() * delayMs);

            // In Jest, don't wait for some milliseconds, immediately retry.
            //
            // Unit test timing should be predictable. And all unit tests should be
            // isolated on a single thread. So there's concurrency but no parallelism. We
            // don't have real world load in unit tests that depend on an exponential
            // backoff to perform well. So to save some time, skip the backoff.
            //
            // This also means when you're faking timers in Jest, you don't need to
            // remember to advance a timer for an exponential backoff. That allows this
            // function to be transparent. Developers don't need to think about advancing
            // exponential backoff timers. (This is the original reason we removed the
            // wait, then expanded it to all unit tests not just unit tests with timer
            // mocking on.)
            if (typeof jest !== "undefined") {
                return attempt(attemptNumber + 1);
            }

            await wait(delayMsWithJitter);
            return attempt(attemptNumber + 1);
        }
    };

    return attempt(1);
}
