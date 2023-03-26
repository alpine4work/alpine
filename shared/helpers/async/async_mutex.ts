import {assert} from "~/shared/helpers/control/assert";

/**
 * Helper for guaranteeing exclusive access to a resource when there are
 * multiple concurrent runners.
 *
 * JavaScript is a single-threaded language so you won't have multiple threads
 * competing for the same resource at once. Synchronous code will not be
 * interrupted. However, JavaScript does have asynchronous code that runs
 * concurrently. You may have two asynchronous operations that want exclusive
 * access to a resource, this utility provides it.
 */
export class AsyncMutex<Value> {
    private _value: Value;
    private _lockPromise: Promise<void> | null = null;

    constructor(value: Value) {
        this._value = value;
    }

    /**
     * Get the current value in the mutex.
     */
    public get(): Value {
        return this._value;
    }

    /**
     * Run an action. If there are any other concurrent actions then we will wait
     * for them to finish. Only one action may run against this mutex at a time.
     *
     * You may update the mutex's value with the `set()` function. We only save the
     * value once the action completes. You will not observe the new value when you
     * call `get()`. If an error is thrown from the action then we don't update the
     * value. Because of this, generally the value should be immutable.
     */
    public async run<Result>(
        action: (value: Value, set: (value: Value) => void) => Promise<Result>,
    ): Promise<Result> {
        // Wait for our turn to claim the lock. This will block on any concurrent runners.
        while (this._lockPromise !== null) await this._lockPromise;

        let isFinished = false;
        let value: Value = this._value;

        const set = (newValue: Value) => {
            assert(!isFinished, "Can not set value after action has finished");
            value = newValue;
        };

        const promise = action(value, set);

        // Clear the lock promise when our promise resolves regardless of whether the
        // promise succeeded or failed.
        this._lockPromise = promise.then(
            () => {
                isFinished = true;
                this._value = value;
                this._lockPromise = null;
            },
            () => {
                isFinished = true;
                this._lockPromise = null;
            },
        );

        return promise;
    }
}
