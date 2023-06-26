import {Memo, RefCallback, useCallback, useRef} from "react";
import {scheduleMicrotask} from "~/shared/helpers/async/schedule_microtask.js";
import {scheduleUncaughtError} from "~/shared/helpers/async/schedule_uncaught_error.js";

let scheduledMicrotaskCallbacks: Array<() => void> = [];

/**
 * A convenient helper for defining refs that add event listeners or attributes
 * imperatively to the referenced element.
 *
 * We expect this to be useful in conjunction with `useElementWithRef()`.
 *
 * If a sub-component re-renders and the ref changes then we will cleanup the
 * old ref's listeners and subscribe new ones without re-rendering the component
 * this hook lives in. You can kind of think of this as a `useLayoutEffect()`
 * for refs.
 *
 * Use sparingly! Like `useLayoutEffect()` this does not work during server-side
 * rendering.
 *
 * Example:
 *
 * ```
 * const ref = useLifecycleRef(element => {
 *   element.addEventListener('focus', handleFocus);
 *   return () => {
 *     element.removeEventListener('focus', handleFocus);
 *   };
 * });
 *
 * return useElementWithRef(children, ref);
 * ```
 */
export function useLifecycleRef<T>(
    ref: Memo<(value: T) => (() => void) | undefined>,
): RefCallback<T> {
    const valueRef = useRef<{
        value: T;
        cleanup: (() => void) | undefined;
        hasScheduledCleanup: boolean;
    } | null>(null);

    return useCallback(
        value => {
            if (value !== null) {
                if (valueRef.current) {
                    valueRef.current.hasScheduledCleanup = false;
                    valueRef.current.cleanup?.();
                }
                valueRef.current = {
                    value,
                    cleanup: ref(value),
                    hasScheduledCleanup: false,
                };
            } else {
                // Wait a microtask before cleaning up. Unless the ref function is called again
                // before that then we will cleanup immediately.
                //
                // React interleaves layout effects with refs. Scheduling ref cleanup for later
                // means we won't have a non-initialized ref when a layout effect occurs.
                if (valueRef.current) {
                    const currentValue = valueRef.current;
                    currentValue.hasScheduledCleanup = true;

                    if (scheduledMicrotaskCallbacks.length === 0) {
                        scheduleMicrotask(() => {
                            const callbacks = scheduledMicrotaskCallbacks;
                            scheduledMicrotaskCallbacks = [];

                            for (const callback of callbacks) {
                                try {
                                    callback();
                                } catch (error) {
                                    scheduleUncaughtError(error);
                                }
                            }
                        });
                    }

                    // Optimization: Instead of calling `scheduleMicrotask()` every time, we batch
                    // into one scheduled microtask.
                    //
                    // When profiling `<PostListView>` (which uses `<VirtualizedScrollView>`), we
                    // found that the `scheduleMicrotask()` function was taking ~87% (~215ms) of the
                    // time it took to render a jump scroll!
                    scheduledMicrotaskCallbacks.push(() => {
                        if (valueRef.current === currentValue) valueRef.current = null;
                        if (currentValue.hasScheduledCleanup) currentValue.cleanup?.();
                    });
                }
            }
        },
        [ref],
    );
}
