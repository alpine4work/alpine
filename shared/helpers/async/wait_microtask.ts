const microtaskPromise = Promise.resolve();

/**
 * Wait a single microtask.
 *
 * Same as `scheduleMicrotask()` but for use with async/await.
 *
 * For more information see "[Event loop: microtasks and macrotasks][1]".
 *
 * [1]: https://javascript.info/event-loop
 */
export function waitMicrotask(): Promise<void> {
    return microtaskPromise;
}
