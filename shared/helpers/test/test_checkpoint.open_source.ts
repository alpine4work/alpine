import {
    PromiseResolver,
    createPromiseResolver,
} from "~/shared/helpers/async/promise_resolver.open_source.js";
import {assert} from "~/shared/helpers/control/assert.open_source.js";
import {
    StringifiableValueForDeepEqualCheck,
    stringifyForDeepEqualCheck,
} from "~/shared/helpers/control/stringify_for_deep_equal_check.open_source.js";

/**
 * A test helper for emulating race conditions. You can add a `waitForTest()`
 * checkpoint call to your code and then in a test call `pauseForTest()`. The
 * request will wait until your test unpauses.
 */
export class TestCheckpoint<Key extends StringifiableValueForDeepEqualCheck> {
    private _promiseResolverByKey = new Map<string, PromiseResolver<PromiseResolver<void>>>();

    constructor() {
        // At the end of every test, resolve all our checkpoint promises if they haven't
        // settled yet and clear our checkpoint map so we don't have a memory leak.
        //
        // Rejecting the checkpoints can cause unhandled promise exceptions we don't want
        // tests to need to think about.
        if (typeof afterEach !== "undefined") {
            assert(import.meta.jest);

            afterEach(() => {
                for (const [, promiseResolver1] of this._promiseResolverByKey) {
                    if (!promiseResolver1.isSettled()) {
                        const promiseResolver2 = createPromiseResolver();
                        promiseResolver1.resolve(promiseResolver2);
                        promiseResolver2.resolve();
                    } else {
                        void promiseResolver1.promise.then(promiseResolver2 => {
                            if (!promiseResolver2.isSettled()) {
                                promiseResolver2.resolve();
                            }
                        });
                    }
                }

                this._promiseResolverByKey.clear();
            });
        }
    }

    /**
     * Call this at the point in your code where you want to emulate a race condition.
     * If a test has paused the code then we'll only resolve when the test unpauses.
     */
    public async waitForTest(key: Key): Promise<void> {
        if (!import.meta.jest) return;

        const keyString = stringifyForDeepEqualCheck(key);
        const promiseResolver1 = this._promiseResolverByKey.get(keyString);
        if (!promiseResolver1) return;

        // Don't create a new promise resolver if our first promise resolver is already
        // settled. Instead await the promise resolver we settled with.
        if (promiseResolver1.isSettled()) {
            const promiseResolver2 = await promiseResolver1.promise;
            await promiseResolver2.promise;
            return;
        }

        const promiseResolver2 = createPromiseResolver();
        promiseResolver1.resolve(promiseResolver2);
        await promiseResolver2.promise;
    }

    /**
     * Pause the checkpoint for a request with a matching request id. Call unpause when
     * you want the checkpoint to resume.
     *
     * This promise will resolve when `waitForTest()` is called for the provided
     * request.
     *
     * Will throw if called outside of a test environment.
     *
     * `unpause` will resume any code paused at this checkpoint. Future code that
     * reaches this checkpoint will not be paused. `stopPausing` will not resume any
     * code paused at this checkpoint but it will stop future code from being paused at
     * this checkpoint.
     */
    public async pauseForTest(key: Key): Promise<{
        unpause: () => void;
        stopPausing: () => void;
    }> {
        const keyString = stringifyForDeepEqualCheck(key);

        assert(import.meta.jest);
        assert(!this._promiseResolverByKey.has(keyString), "Request already paused");

        const promiseResolver1 = createPromiseResolver<PromiseResolver<void>>();
        this._promiseResolverByKey.set(keyString, promiseResolver1);

        const promiseResolver2 = await promiseResolver1.promise;

        let hasStoppedPausing = false;

        return {
            unpause: () => {
                if (!hasStoppedPausing) {
                    assert(this._promiseResolverByKey.get(keyString) === promiseResolver1);
                    this._promiseResolverByKey.delete(keyString);
                    hasStoppedPausing = true;
                }
                promiseResolver2.resolve();
            },
            stopPausing: () => {
                if (!hasStoppedPausing) {
                    assert(this._promiseResolverByKey.get(keyString) === promiseResolver1);
                    this._promiseResolverByKey.delete(keyString);
                    hasStoppedPausing = true;
                }
            },
        };
    }
}
