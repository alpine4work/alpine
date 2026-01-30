// We grab the original `setTimeout` here since we don't want this function to be
// affected by Jest fake timers.
const originalSetTimeout = globalThis.setTimeout;

/**
 * Wait a single macrotask.
 *
 * For more information see "[Event loop: microtasks and macrotasks][1]".
 *
 * [1]: https://javascript.info/event-loop
 */
export function scheduleMacrotask(callback: () => void) {
    originalSetTimeout(callback);
}
