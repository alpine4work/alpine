import {scheduleUncaughtError} from "~/shared/helpers/async/schedule_uncaught_error.open_source.js";

const microtaskPromise = Promise.resolve();

/**
 * Run some callback later in a [microtask][1].
 *
 * Microtasks are run as soon as possible after the current stack. They run before
 * `setTimeout()`, `setImmediate()`, `process.nextTick()`,
 * `requestAnimationFrame()`, and browser paints. You should prefer using a
 * microtask over `setTimeout(() => {}, 0)` most of the time since `setTimeout()`
 * runs after a browser paint.
 *
 * [1]:
 *     https://developer.mozilla.org/en-US/docs/Web/API/HTML_DOM_API/Microtask_guide/In_depth
 */
export function scheduleMicrotask(callback: () => void) {
    microtaskPromise
        .then(callback)
        // We want to throw outside of our promise context so that the error is an uncaught
        // exception instead of an uncaught promise exception.
        .catch(scheduleUncaughtError);
}
