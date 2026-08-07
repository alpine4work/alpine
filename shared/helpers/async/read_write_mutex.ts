import {Mutex} from "~/shared/helpers/async/mutex.open_source.js";
import {runAllPromises} from "~/shared/helpers/async/run_all_promises.open_source.js";
import {waitMicrotask} from "~/shared/helpers/async/wait_microtask.js";

/**
 * A write-preferring [read write lock][1]. Writers require exclusive access to a
 * lock but readers may run concurrently. This lock is write-preferring so reads
 * don't starve the lock.
 *
 * [1]: https://en.wikipedia.org/wiki/Readers%E2%80%93writer_lock
 */
// Implementation adapted from this gist:
// https://gist.github.com/CMCDragonkai/4de5c1526fc58dac259e321db8cf5331
export class ReadWriteMutex {
    private readonly _readersMutex = new Mutex();
    private readonly _writersMutex = new Mutex();
    private _unlockReaders: (() => void) | null = null;
    private _readerCount = 0;
    private _writerCount = 0;

    /**
     * Lock the mutex for a reader during the action.
     *
     * See `lockRead()` for more on read lock semantics.
     */
    public async withReadLock<Value>(action: () => Promise<Value>): Promise<Value> {
        const unlock = await this.lockRead();
        try {
            const value = await action();
            return value;
        } finally {
            unlock();
        }
    }

    /**
     * Lock the mutex for a writer during the action.
     *
     * See `lockWrite()` for more on write lock semantics.
     */
    public async withWriteLock<Value>(action: () => Promise<Value>): Promise<Value> {
        const unlock = await this.lockWrite();
        try {
            const value = await action();
            return value;
        } finally {
            unlock();
        }
    }

    /**
     * Locks the mutex for a reader. If a writer is locking then we must wait for it to
     * unlock. Read lockers may run concurrently but stop a write lock from being
     * acquired.
     *
     * The `withReadLock()` function is a more convenient function for most cases.
     */
    public async lockRead(): Promise<() => void> {
        if (this._writerCount > 0) {
            await this._writersMutex.waitForUnlock();
        }

        this._readerCount++;

        // The first reader locks
        if (this._readerCount === 1) {
            this._unlockReaders = await this._readersMutex.lock();
        } else {
            // Make sure if we call `lockRead()` twice synchronously the first call returns
            // first and the second call returns second. Since the first call has an `await` it
            // will be delayed one microtask. So wait a microtask in all other reads as well to
            // even this delay out.
            await waitMicrotask();
        }

        return () => {
            this._readerCount--;

            // The last reader unlocks
            if (this._readerCount === 0) {
                this._unlockReaders!();
                this._unlockReaders = null;
            }
        };
    }

    /**
     * Locks the mutex for a writer. Must wait for any other writers to unlock. Must
     * also wait for any active reads to unlock. Readers that call `lockRead()` after a
     * `lockWrite()` is called are blocked until the write finishes. This is because
     * our lock is write-preferring.
     *
     * The `withWriteLock()` function is a more convenient function for most cases.
     */
    public async lockWrite(): Promise<() => void> {
        this._writerCount++;
        const unlockWriters = await this._writersMutex.lock();
        const unlockReaders = await this._readersMutex.lock();
        return () => {
            unlockReaders();
            unlockWriters();
            this._writerCount--;
        };
    }

    /**
     * Wait for all readers and writers to unlock.
     */
    public async waitForUnlock(): Promise<void> {
        await runAllPromises([
            this._readersMutex.waitForUnlock(),
            this._writersMutex.waitForUnlock(),
        ]);
    }
}
