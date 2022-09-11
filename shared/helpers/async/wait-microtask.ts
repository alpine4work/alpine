const microtaskPromise = Promise.resolve();

/**
 * Wait a single microtask.
 *
 * Same as `scheduleMicrotask()` but for use with async/await.
 */
export function waitMicrotask(): Promise<void> {
    return microtaskPromise;
}
