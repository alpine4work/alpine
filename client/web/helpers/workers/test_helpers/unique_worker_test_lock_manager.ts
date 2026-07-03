// Test-only in-memory `navigator.locks` replacement. Implements the subset the
// unique worker system uses: exclusive/shared modes, FIFO granting, abort signals,
// and — for simulating tab death — force-releasing held locks.

interface UniqueWorkerTestLockHolder {
    readonly mode: "exclusive" | "shared";
    released: boolean;
}

interface UniqueWorkerTestLockWaiter {
    readonly mode: "exclusive" | "shared";
    removed: boolean;
    grant(): void;
}

interface UniqueWorkerTestLockState {
    readonly holders: Array<UniqueWorkerTestLockHolder>;
    readonly queue: Array<UniqueWorkerTestLockWaiter>;
}

type UniqueWorkerTestLockCallback = (lock: Lock | null) => unknown;

export class UniqueWorkerTestLockManager {
    private readonly locks = new Map<string, UniqueWorkerTestLockState>();

    request(
        name: string,
        optionsOrCallback: LockOptions | UniqueWorkerTestLockCallback,
        maybeCallback?: UniqueWorkerTestLockCallback,
    ): Promise<unknown> {
        const options = typeof optionsOrCallback === "function" ? {} : optionsOrCallback;
        const callback =
            typeof optionsOrCallback === "function" ? optionsOrCallback : maybeCallback!;
        const mode = options.mode ?? "exclusive";
        const signal = options.signal ?? undefined;

        return new Promise((resolve, reject) => {
            if (signal?.aborted) {
                reject(uniqueWorkerTestAbortError());
                return;
            }

            const state = this.stateFor(name);
            const waiter: UniqueWorkerTestLockWaiter = {
                mode,
                removed: false,
                grant: () => {
                    waiter.removed = true;
                    const holder: UniqueWorkerTestLockHolder = {mode, released: false};
                    state.holders.push(holder);
                    const release = () => {
                        if (holder.released) return;
                        holder.released = true;
                        const index = state.holders.indexOf(holder);
                        if (index !== -1) state.holders.splice(index, 1);
                        this.pump(name);
                    };
                    // The callback runs asynchronously, like the real API. The lock is held until the
                    // callback's result settles.
                    queueMicrotask(() => {
                        Promise.resolve()
                            .then(() => callback({name, mode} as Lock))
                            .then(resolve, reject)
                            .finally(release);
                    });
                },
            };
            state.queue.push(waiter);
            signal?.addEventListener("abort", () => {
                // Aborting after the grant is ignored, like the real API.
                if (waiter.removed) return;
                waiter.removed = true;
                reject(uniqueWorkerTestAbortError());
                this.pump(name);
            });
            this.pump(name);
        });
    }

    /**
     * Release every current holder of `name`, as the browser does when the holding tab
     * dies. The holder's own eventual release becomes a no-op; the next queued request
     * is granted.
     */
    forceRelease(name: string): void {
        const state = this.stateFor(name);
        for (const holder of state.holders) {
            holder.released = true;
        }
        state.holders.length = 0;
        this.pump(name);
    }

    private stateFor(name: string): UniqueWorkerTestLockState {
        let state = this.locks.get(name);
        if (state === undefined) {
            state = {holders: [], queue: []};
            this.locks.set(name, state);
        }
        return state;
    }

    // Grant queued requests in FIFO order while compatible: an exclusive request needs
    // no holders at all; shared requests only conflict with an exclusive holder
    // (consecutive shared requests are granted together).
    private pump(name: string): void {
        const state = this.stateFor(name);
        while (state.queue.length > 0) {
            const head = state.queue[0]!;
            if (head.removed) {
                state.queue.shift();
                continue;
            }
            if (head.mode === "exclusive") {
                if (state.holders.length > 0) break;
            } else if (state.holders.some(holder => holder.mode === "exclusive")) {
                break;
            }
            state.queue.shift();
            head.grant();
        }
    }
}

function uniqueWorkerTestAbortError(): DOMException {
    return new DOMException("The lock request was aborted", "AbortError");
}
