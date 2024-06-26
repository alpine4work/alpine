import {RefCallback, useCallback, useState} from "react";
import {useLifecycleRef} from "~/client/helpers/refs/use_lifecycle_ref.js";
import {runWithImmediatePriority} from "~/client/helpers/run_with_immediate_priority.js";
import {scheduleUncaughtError} from "~/shared/helpers/async/schedule_uncaught_error.js";
import {iterableEvery} from "~/shared/helpers/iterable/iterable_every.js";
import {getOrSetDefaultMapValue} from "~/shared/helpers/map/get_or_set_default_map_value.js";

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
    {readonly height: number; readonly width: number} | null,
] {
    const [contentRect, setContentRect] = useState<{height: number; width: number} | null>(null);

    const ref = useLifecycleRef<HTMLElement>(
        useCallback(element => {
            const listener = () => {
                // We must use `getBoundingClientRect()` so we get sub-pixel sizes.
                // `offsetHeight` is rounded to an integer.
                const {height, width} = element.getBoundingClientRect();

                const newContentRect = {height, width};
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
const suppressingResizeLoopErrorNotificationForElements = new WeakMap<Element, number>();
let resizeObserver: ResizeObserver | undefined;

function createResizeObserver() {
    let lastEntryTargets = new Set<Element>();

    const resizeObserver = new ResizeObserver(entries => {
        const entryTargets = new Set<Element>();

        // Run resize observer listeners with immediate priority. React component
        // updates made in resize listeners should happen in the same browser paint
        // where they were dispatched so the user doesn't see a tear in the UI.
        runWithImmediatePriority(() => {
            for (const entry of entries) {
                entryTargets.add(entry.target);

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

        lastEntryTargets = entryTargets;
    });

    const handleWindowError = (event: ErrorEvent) => {
        // Handle errors from the "deliver resize loop error notification" procedure.
        // https://www.w3.org/TR/resize-observer/#deliver-resize-error
        if (event.message !== "ResizeObserver loop completed with undelivered notifications.") {
            return;
        }

        // If every target from the last `ResizeObserver` notification has requested
        // resize observer loop errors to be suppressed then we can safely suppress the
        // error.
        if (
            lastEntryTargets.size > 0 &&
            iterableEvery(lastEntryTargets, entryTarget =>
                suppressingResizeLoopErrorNotificationForElements.has(entryTarget),
            )
        ) {
            event.preventDefault();
        } else if (process.env.NODE_ENV !== "production") {
            // eslint-disable-next-line no-console
            console.error(
                "Resized element(s) that generated the below ResizeObserver error:",
                Array.from(lastEntryTargets, entryTarget => [
                    entryTarget,
                    {
                        suppressed:
                            suppressingResizeLoopErrorNotificationForElements.has(entryTarget),
                    },
                ]),
            );
        }
    };

    window.addEventListener("error", handleWindowError, true);

    return {
        resizeObserver,
        dispose: () => {
            window.removeEventListener("error", handleWindowError, true);
            resizeObserver.disconnect();
        },
    };
}

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
        resizeObserver = createResizeObserver().resizeObserver;
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

/**
 * Suppress the error message "ResizeObserver loop completed with undelivered
 * notifications" for resizes that affect the provided element. Sometimes we
 * change the layout of other elements in a resize observer and that's
 * expected.
 *
 * If you suppress errors for an element, document why it's fine.
 */
export function addSuppressResizeLoopErrorNotificationForElement(element: Element) {
    const count = suppressingResizeLoopErrorNotificationForElements.get(element) ?? 0;
    const newCount = count + 1;
    suppressingResizeLoopErrorNotificationForElements.set(element, newCount);
}

/**
 * Remove error suppression added by
 * `addSuppressResizeLoopErrorNotificationForElement()` for the provided
 * element.
 */
export function removeSuppressResizeLoopErrorNotificationForElement(element: Element) {
    const count = suppressingResizeLoopErrorNotificationForElements.get(element) ?? 0;
    const newCount = count - 1;

    if (newCount <= 0) {
        suppressingResizeLoopErrorNotificationForElements.delete(element);
    } else {
        suppressingResizeLoopErrorNotificationForElements.set(element, newCount);
    }
}
