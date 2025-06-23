import {testSharedHooks} from "~/server/dynamo/test_helpers/test_shared_hooks.js";
import {InternalError} from "~/shared/error/error.js";
import {MaybePromise} from "~/shared/helpers/types/maybe_promise.js";

let callbacks: Array<() => MaybePromise<void>> = [];

let isTestRunning = false;

testSharedHooks.beforeEach(async () => {
    isTestRunning = true;
});

testSharedHooks.afterEach(async () => {
    isTestRunning = false;

    let hasError = false;
    let error;

    while (callbacks.length > 0) {
        const currentCallbacks = callbacks;
        callbacks = [];

        for (const callback of currentCallbacks) {
            try {
                await callback();
            } catch (_error) {
                hasError = true;
                error = _error;
            }
        }
    }

    if (hasError) {
        throw error;
    }
});

/**
 * Schedules a callback to be run when the current test ends. Useful for adding
 * cleanup for resources constructed dynamically in a test. Callbacks are run
 * in the order this function is called.
 */
export function afterTestEnds(callback: () => MaybePromise<void>) {
    if (!isTestRunning) {
        throw new InternalError(
            "Can’t register callback for after test ends when no test is running",
        );
    }

    callbacks.push(callback);
}
