import jsonStableStringify from "json-stable-stringify";
import {CancelledError} from "~/shared/error/error";
import {PromiseResolver, createPromiseResolver} from "~/shared/helpers/async/promise_resolver";
import {assert} from "~/shared/helpers/control/assert";
import {SchemaSerializedValue} from "~/shared/schema/schema";

/**
 * A test helper for emulating race conditions. You can add a `waitForTest()`
 * checkpoint call to your code and then in a test call `pauseForTest()`. The
 * request will wait until your test unpauses.
 */
export class TestCheckpoint<
    // We set `SchemaSerializedValue` as the bound so that `Key` is
    // JSON stringifiable.
    Key extends SchemaSerializedValue,
> {
    private _promiseResolverByKey = new Map<string, PromiseResolver<PromiseResolver<void>>>();

    constructor() {
        // At the end of every test, cancel all our checkpoint promises if they haven't
        // settled yet and clear our checkpoint map so we don't have a memory leak.
        if (typeof jest !== "undefined") {
            afterEach(() => {
                for (const promiseResolver1 of this._promiseResolverByKey.values()) {
                    if (!promiseResolver1.isSettled()) {
                        promiseResolver1.reject(new CancelledError("Test finished"));
                    } else {
                        void promiseResolver1.promise.then(promiseResolver2 => {
                            if (!promiseResolver2.isSettled()) {
                                promiseResolver2.reject(new CancelledError("Test finished"));
                            }
                        });
                    }
                }

                this._promiseResolverByKey.clear();
            });
        }
    }

    /**
     * Call this at the point in your code where you want to emulate a race
     * condition. If a test has paused the code then we'll only resolve when the
     * test unpauses.
     */
    public async waitForTest(key: Key): Promise<void> {
        const keyString = jsonStableStringify(key);
        const promiseResolver1 = this._promiseResolverByKey.get(keyString);
        if (!promiseResolver1) return;

        // Don't create a new promise resolver if our first promise resolver is
        // already settled. Instead await the promise resolver we settled with.
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
     * Pause the checkpoint for a request with a matching request id. Call unpause
     * when you want the checkpoint to resume.
     *
     * This promise will resolve when `waitForTest()` is called for the
     * provided request.
     *
     * Will throw if called outside of a test environment.
     */
    public async pauseForTest(key: Key): Promise<{unpause: () => void}> {
        const keyString = jsonStableStringify(key);

        assert(typeof jest !== "undefined");
        assert(!this._promiseResolverByKey.has(keyString), "Request already paused");

        const promiseResolver1 = createPromiseResolver<PromiseResolver<void>>();
        this._promiseResolverByKey.set(keyString, promiseResolver1);

        const promiseResolver2 = await promiseResolver1.promise;

        return {
            unpause: () => {
                assert(this._promiseResolverByKey.get(keyString) === promiseResolver1);
                this._promiseResolverByKey.delete(keyString);
                promiseResolver2.resolve();
            },
        };
    }
}
