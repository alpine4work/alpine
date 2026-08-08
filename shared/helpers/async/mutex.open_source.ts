import {createPromiseResolver} from "~/shared/helpers/async/promise_resolver.open_source.js";

/**
 * A [mutual exclusion lock][1]. Helps manage concurrency by making sure only a
 * single async function can access a resource at a given time.
 *
 * [1]: https://en.wikipedia.org/wiki/Lock_(computer_science)
 */
export class Mutex {
    private _lockPromise: Promise<void> | null = null;

    /**
     * Locks the mutex for the entirety of the provided action. If the mutex is already
     * locked you must wait for the mutex to unlock before the function runs.
     */
    public async withLock<Value>(action: () => Promise<Value>): Promise<Value> {
        const unlock = await this.lock();
        try {
            const value = await action();
            return value;
        } finally {
            unlock();
        }
    }

    /**
     * Locks the mutex. If the mutex is currently locked you must wait for the mutex to
     * unlock.
     *
     * The `withLock()` function is a more convenient function for most cases.
     */
    public async lock(): Promise<() => void> {
        // Wait for our turn to claim the lock. This will block on any concurrent runners.
        while (this._lockPromise !== null) await this._lockPromise;

        const promiseResolver = createPromiseResolver();

        this._lockPromise = promiseResolver.promise.finally(() => {
            this._lockPromise = null;
        });

        return promiseResolver.resolve;
    }

    /**
     * If the mutex is locked, wait for it to unlock.
     */
    public async waitForUnlock() {
        while (this._lockPromise !== null) await this._lockPromise;
    }
}
