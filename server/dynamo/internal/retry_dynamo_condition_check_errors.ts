import {isDynamoConditionCheckError} from "~/server/dynamo/internal/is_dynamo_condition_check_error";
import {DeadlineExceededError} from "~/shared/error/error";
import {wait} from "~/shared/helpers/async/wait";

/**
 * Executes the provided action and if it fails because a DynamoDB condition
 * failed then we will retry the action with exponential backoff.
 *
 * We will keep retrying until the action either succeeds or the wait becomes
 * excessive.
 *
 * Useful if you want to update a value using some form of [optimistic
 * concurrency control][1].
 *
 * [1]: https://en.wikipedia.org/wiki/Optimistic_concurrency_control
 */
export function retryDynamoConditionCheckErrors<Value>(
    action: () => Promise<Value>,
): Promise<Value> {
    const attempt = async (attemptNumber: number): Promise<Value> => {
        try {
            const value = await action();
            return value;
        } catch (error) {
            if (!isDynamoConditionCheckError(error)) throw error;

            const delayMs = 10 * 2 ** (attemptNumber - 1);

            if (delayMs > 1000 * 10)
                throw new DeadlineExceededError(
                    `Condition checks kept failing after ${attemptNumber} attempts`,
                );

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
