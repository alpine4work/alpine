import {RefCallback, useCallback, useState} from "react";
import {useLifecycleRef} from "~/client/helpers/refs/use_lifecycle_ref";
import {runWithImmediatePriority} from "~/client/helpers/run_with_immediate_priority";
import {scheduleUncaughtError} from "~/shared/helpers/async/schedule_uncaught_error";
import {getOrSetDefaultMapValue} from "~/shared/helpers/map/get_or_set_default_map_value";

/**
 * Watch the size of the provided element with a [`ResizeObserver`][1].
 *
 * On the server and on initial mount, the returned size will be null. If the
 * element is unmounted then the returned size will also be null.
 *
 * If you want to observe a different element then you need to change the
 * reference of the `ref` object passed in. We will only observe a new element
 * when this object changes.
 *
 * [1]: https://developer.mozilla.org/en-US/docs/Web/API/ResizeObserver
 */
export function useResizeObserver(): [
    RefCallback<HTMLElement>,
    {height: number; width: number} | null,
] {
    const [contentRect, setContentRect] = useState<{height: number; width: number} | null>(null);

    const ref = useLifecycleRef<HTMLElement>(
        useCallback(element => {
            const listener = () => {
                const newContentRect = {
                    height: element.offsetHeight,
                    width: element.offsetWidth,
                };
                setContentRect(contentRect => {
                    return newContentRect.height !== contentRect?.height ||
                        newContentRect.width !== contentRect.width
                        ? newContentRect
                        : contentRect;
                });
            };

            // Immediately populate the content rect with our element's dimensions
            // on mount.
            listener();

            addResizeListenerForElement(element, listener);
            return () => {
                removeResizeListenerForElement(element, listener);
            };
        }, []),
    );

    return [ref, contentRect];
}

const resizeListenersByElement = new Map<Element, Set<(entry: ResizeObserverEntry) => void>>();
const lastResizeObserverEntryByElement = new WeakMap<Element, ResizeObserverEntry>();
let resizeObserver: ResizeObserver | undefined;

/**
 * Adds a resize listener for the provided element.
 *
 * We will construct a single `ResizeObserver` for all elements who want to
 * listen to resizes.
 */
export function addResizeListenerForElement(
    element: Element,
    listener: (entry: ResizeObserverEntry) => void,
) {
    if (!resizeObserver) {
        resizeObserver = new ResizeObserver(entries => {
            // Run resize observer listeners with immediate priority. React component
            // updates made in resize listeners should happen in the same browser paint
            // where they were dispatched so the user doesn't see a tear in the UI.
            runWithImmediatePriority(() => {
                for (const entry of entries) {
                    lastResizeObserverEntryByElement.set(entry.target, entry);
                    const resizeListeners = resizeListenersByElement.get(entry.target);
                    if (resizeListeners) {
                        for (const listener of resizeListeners) {
                            try {
                                listener(entry);
                            } catch (error) {
                                scheduleUncaughtError(error);
                            }
                        }
                    }
                }
            });
        });
    }

    const resizeListeners = getOrSetDefaultMapValue(
        resizeListenersByElement,
        element,
        () => new Set(),
    );

    resizeListeners.add(listener);

    if (resizeListeners.size === 1) resizeObserver.observe(element, {box: "border-box"});

    const lastEntry = lastResizeObserverEntryByElement.get(element);
    if (lastEntry) {
        try {
            listener(lastEntry);
        } catch (error) {
            scheduleUncaughtError(error);
        }
    }
}

/**
 * Remove a resize listener for the provided element.
 */
export function removeResizeListenerForElement(
    element: Element,
    listener: (entry: ResizeObserverEntry) => void,
) {
    const resizeListeners = resizeListenersByElement.get(element);
    if (!resizeListeners) return;

    resizeListeners.delete(listener);

    if (resizeListeners.size === 0) {
        resizeListenersByElement.delete(element);
        resizeObserver?.unobserve(element);
    }
}
