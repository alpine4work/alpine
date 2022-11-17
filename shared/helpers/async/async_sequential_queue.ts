/**
 * Helper for guaranteeing many async actions run in sequence.
 */
export class AsyncSequentialQueue {
    private _lockPromise: Promise<void> | null = null;

    /**
     * Run an action. If there are any other concurrent runners in this queue, we
     * will wait for it to finish. Only one action may run at a time.
     */
    public async run<Value>(action: () => Promise<Value>): Promise<Value> {
        // Wait for our turn to claim the lock. This will block on any concurrent runners.
        while (this._lockPromise !== null) await this._lockPromise;

        const promise = action();

        // Clear the lock promise when our promise resolves regardless of whether the
        // promise succeeded or failed.
        this._lockPromise = promise.then(
            () => {
                this._lockPromise = null;
            },
            () => {
                this._lockPromise = null;
            },
        );

        return promise;
    }
}
