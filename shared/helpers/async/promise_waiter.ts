import {createAggregateError} from "~/shared/error/aggregate_error.js";
import {runAllPromises} from "~/shared/helpers/async/run_all_promises.js";

/**
 * Helper that allows you to wait for an arbitrary set of promises. Similar to
 * `ProcessContextModule`'s `waitUntil()` function. Except whereas
 * `ProcessContextModule` will make sure the process doesn't shutdown until all
 * promises complete, with this helper you decide when to wait for the promises
 * added to this helper. If you never call `wait()` then the promises are never
 * handled.
 *
 * This helper can be useful if you have a bunch of tasks that spawn
 * asynchronous work and you need to wait for that work to complete before you
 * can return from a function.
 */
export class PromiseWaiter {
    private _promises: Array<PromiseLike<unknown>> = [];

    /**
     * When `wait()` is called it won't resolve until the provided promise
     * resolves.
     */
    public waitUntil(action: PromiseLike<unknown> | (() => PromiseLike<unknown>)): void {
        const promise = typeof action === "function" ? action() : action;

        // No unhandled promise exception warnings. Exceptions will be handled when
        // `wait()` is called.
        promise.then(
            () => {},
            () => {},
        );

        this._promises.push(promise);
    }

    /**
     * Wait for all promises added with `waitUntil()` to resolve. If any of the
     * promises passed into `waitUntil()` reject then this rejects as well.
     */
    public async wait() {
        const errors: Array<unknown> = [];

        try {
            while (this._promises.length > 0) {
                const promises = this._promises;
                this._promises = [];
                await runAllPromises(promises);
            }
        } catch (error) {
            errors.push(error);
        }

        if (errors.length > 0) {
            throw createAggregateError(errors);
        }
    }
}
