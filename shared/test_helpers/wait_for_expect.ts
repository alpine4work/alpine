import {MaybePromise} from "~/shared/helpers/types/maybe_promise.js";

// We can't use `wait()` or `setTimeout()` since Jest will override `setTimeout()`
// when `jest.useFakeTimers()` is on. But we want to wait the timeout anyway.
const originalSetTimeout = setTimeout;

/**
 * Retry the provided expectation every 50ms until it passes without an error. If
 * the expectation never passes then this function rejects after 4.5s (just under
 * the default Jest test timeout).
 *
 * IMPORTANT: Use this sparingly! It makes it harder to debug test failures if we
 * have to wait 4.5s before the test can fail. Prefer waiting for some
 * deterministic promise to resolve whenever possible. You may like the
 * `TestCheckpoint` helper which helps with this.
 *
 * Derived from the [`wait-for-expect` library][1].
 *
 * [1]: https://www.npmjs.com/package/wait-for-expect
 */
export function waitForExpect<Value>(
    expectation: () => MaybePromise<Value>,
    {timeout = 4500, interval = 50}: {timeout?: number; interval?: number} = {},
): Promise<Value> {
    const maxAttemptCount = Math.ceil(timeout / interval);
    let attemptCount = 0;

    return new Promise((resolve, reject) => {
        const rejectOrRetry = (error: unknown) => {
            if (attemptCount > maxAttemptCount) {
                reject(error);
                return;
            }
            originalSetTimeout(runExpectation, interval);
        };

        function runExpectation() {
            attemptCount += 1;
            try {
                Promise.resolve(expectation()).then(resolve).catch(rejectOrRetry);
            } catch (error) {
                rejectOrRetry(error);
            }
        }

        runExpectation();
    });
}
