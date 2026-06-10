/**
 * Schedules a function to run immediately after the next browser paint.
 *
 * Implemented using `MessageChannel.postMessage()` which is the implementation
 * [used by the React scheduler][1].
 *
 * How this differs from other scheduling functions:
 *
 * - `scheduleMicrotask()` schedules your function to run asap. It runs before any
 *   timeouts and browser paints.
 * - `requestAnimationFrame()` schedules your function for right before the next
 *   browser paint.
 * - `setTimeout()` also runs after the next browser paint but it's inconsistent as
 *   to when it will fire.
 *
 * [1]:
 *     https://github.com/facebook/react/blob/8ef3a7c08c55c13995267902859381da8b5985ac/packages/scheduler/src/forks/Scheduler.js#L570-L579
 */
export function scheduleAfterNextBrowserPaint(callback: () => void) {
    // If we are not in a browser context, browser paints don't matter. We still want
    // to schedule a macrotask, though, so use `setTimeout()`.
    if (typeof window === "undefined") {
        setTimeout(callback, 0);
        return;
    }

    const channel = new MessageChannel();
    channel.port1.onmessage = () => callback();
    channel.port2.postMessage(undefined);
}
