import {testSharedHooks} from "~/server/dynamo/test_helpers/test_shared_hooks.js";
import {createAggregateError} from "~/shared/error/aggregate_error.js";
import {InternalError} from "~/shared/error/error.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {MaybePromise} from "~/shared/helpers/types/maybe_promise.js";

let callbacks: Array<() => MaybePromise<void>> = [];
let capturingCallbacks: Array<() => MaybePromise<void>> | null = null;

let isTestRunning = false;

testSharedHooks.beforeEach(async () => {
    isTestRunning = true;
});

testSharedHooks.afterEach(async () => {
    isTestRunning = false;

    const errors: Array<unknown> = [];

    while (callbacks.length > 0) {
        const currentCallbacks = callbacks;
        callbacks = [];

        for (const callback of currentCallbacks) {
            try {
                await callback();
            } catch (error) {
                errors.push(error);
            }
        }
    }

    if (errors.length > 0) {
        throw createAggregateError(errors);
    }
});

/**
 * Schedules a callback to be run when the current test ends. Useful for adding
 * cleanup for resources constructed dynamically in a test. Callbacks are run
 * in the order this function is called.
 */
export function afterTestEnds(callback: () => MaybePromise<void>) {
    if (capturingCallbacks !== null) {
        capturingCallbacks.push(callback);
        return;
    }

    if (!isTestRunning) {
        throw new InternalError(
            "Can’t register callback for after test ends when no test is running",
        );
    }

    callbacks.push(callback);
}

/**
 * If you need to run some code in tests after a test block (e.g. in
 * `beforeAll()`) then use this to capture callbacks passed into
 * `afterTestEnds()`.
 *
 * Returns a function you call to run the `afterTestEnds()` callbacks.
 */
export async function captureAfterTestEndsCallbacks(
    action: () => Promise<void>,
): Promise<() => Promise<void>> {
    assert(capturingCallbacks === null);
    capturingCallbacks = [];

    try {
        await action();

        const capturedCallbacks = capturingCallbacks;

        return async () => {
            const errors: Array<unknown> = [];

            for (const callback of capturedCallbacks) {
                try {
                    await callback();
                } catch (error) {
                    errors.push(error);
                }
            }

            if (errors.length > 0) {
                throw createAggregateError(errors);
            }
        };
    } finally {
        capturingCallbacks = null;
    }
}
