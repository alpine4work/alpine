/**
 * Serializes async work by chaining promises. Each enqueued function waits for the
 * previous one to finish before starting. A rejection in one task does not prevent
 * subsequent tasks from running.
 */
export class PromiseQueue {
    private _tail: Promise<void> = Promise.resolve();

    enqueue<T>(fn: () => T | Promise<T>): Promise<T> {
        const task = this._tail.then(fn);
        // Swallow rejection so the chain always continues.
        this._tail = task.then(
            () => {},
            () => {},
        );
        return task;
    }
}
