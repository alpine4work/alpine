import {RefObject, useState} from "react";
import {unstable_ImmediatePriority, unstable_runWithPriority} from "scheduler";
import {useLayoutEffectWithoutServerSideWarning} from "~/client/helpers/lifecycle/use_layout_effect_without_server_side_warning";
import {scheduleUncaughtError} from "~/shared/helpers/async/schedule_uncaught_error";
import {assertExists} from "~/shared/helpers/control/assert_exists";
import {getOrSetDefaultMapValue} from "~/shared/helpers/map/get_or_set_default_map_value";

/**
 * Watch the size of the provided element with a [`ResizeObserver`][1].
 *
 * On the server and on initial mount, the returned size will be null.
 *
 * If you want to observe a different element then you need to change the
 * reference of the `ref` object passed in. We will only observe a new element
 * when this object changes.
 *
 * [1]: https://developer.mozilla.org/en-US/docs/Web/API/ResizeObserver
 */
export function useResizeObserver<T extends HTMLElement>(
    ref: RefObject<T>,
): {height: number; width: number} | null {
    const [contentRect, setContentRect] = useState<{height: number; width: number} | null>(null);

    // Accept that when server-side rendering there will be a brief flash of
    // content where we don't have dimensions. If navigating entirely on the client
    // then we should never render content without dimensions.
    useLayoutEffectWithoutServerSideWarning(() => {
        const element = assertExists(ref.current);

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
    }, [ref]);

    return contentRect;
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
            unstable_runWithPriority(unstable_ImmediatePriority, () => {
                // HACK(calebmer): In order for React to respect the scheduler priority level
                // we need to be in a message event (since the scheduler callback uses a
                // message event). So trick React into thinking we are in a message event by
                // setting a message event object globally.
                //
                // See how the `requestUpdateLane()` function calls `getCurrentEventPriority()`
                // which calls `getEventPriority()` which then consults the scheduler for
                // `message` events.
                //
                // - https://github.com/facebook/react/blob/9e3b772b8cabbd8cadc7522ebe3dde3279e79d9e/packages/react-reconciler/src/ReactFiberWorkLoop.new.js#L498-L516
                // - https://github.com/facebook/react/blob/9e3b772b8cabbd8cadc7522ebe3dde3279e79d9e/packages/react-dom/src/events/ReactDOMEventListener.js#L493-L512
                const lastWindowEvent = window.event;
                window.event = new MessageEvent("message");

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

                window.event = lastWindowEvent;
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
