import {createAggregateError} from "~/shared/error/aggregate_error.js";
import {runAllPromises} from "~/shared/helpers/async/run_all_promises.js";
import {assert} from "~/shared/helpers/control/assert.js";

/**
 * Helper that allows you to wait for an arbitrary set of promises. Similar to
 * `ProcessContextModule`'s `waitUntil()` function. Except whereas
 * `ProcessContextModule` will make sure the process doesn't shutdown until all
 * promises complete, with this helper you decide when to wait for the promises
 * added to this helper. If you never call `wait()` then the promises are never
 * handled.
 *
 * This helper can be useful if you have a bunch of tasks that spawn asynchronous
 * work and you need to wait for that work to complete before you can return from a
 * function.
 */
export class PromiseWaiter {
    private _promises = new Set<PromiseLike<unknown>>();
    private _errors: Array<unknown> | null = null;
    private _waitPromise: Promise<void> | null = null;

    /**
     * When `wait()` is called it won't resolve until the provided promise resolves.
     */
    public readonly waitUntil = (
        action: PromiseLike<unknown> | (() => PromiseLike<unknown>),
    ): void => {
        const promise = typeof action === "function" ? action() : action;

        // No unhandled promise exception warnings. Exceptions will be handled when
        // `wait()` is called.
        promise.then(
            () => {
                this._promises.delete(promise);
            },
            error => {
                this._errors ??= [];
                this._errors.push(error);
                this._promises.delete(promise);
            },
        );

        this._promises.add(promise);
    };

    /**
     * Wait for all promises added with `waitUntil()` to resolve. If any of the
     * promises passed into `waitUntil()` reject then this rejects as well.
     */
    public wait(): Promise<void> {
        // Must early return when there are no promises since otherwise
        // `this._waitForTestTasksPromise` won't get cleared since the `finally` which
        // clears `this._waitForTestTasksPromise` will run before the promise is assigned.
        if (!(this._promises.size > 0)) return Promise.resolve();

        if (this._waitPromise === null) {
            let isSync = true;

            this._waitPromise = (async () => {
                try {
                    while (this._promises.size > 0) {
                        try {
                            const promises = this._promises;
                            this._promises = new Set();
                            await runAllPromises(promises);
                        } catch (error) {
                            this._errors ??= [];
                            this._errors.push(error);
                        }
                    }

                    if (this._errors !== null) {
                        const errors = this._errors;
                        this._errors = null;
                        throw createAggregateError(errors);
                    }
                } finally {
                    // Double check that we're not running synchronously when we reach this point.
                    // Otherwise `this._waitPromise` will be not be properly cleared.
                    assert(!isSync);

                    this._waitPromise = null;
                }
            })();

            isSync = false;
        }

        return this._waitPromise;
    }
}
