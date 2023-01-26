import {RefObject, useState} from "react";
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

        const listener = (entry: {contentRect: {height: number; width: number}}) => {
            const newContentRect = {
                height: entry.contentRect.height,
                width: entry.contentRect.width,
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
        listener({
            contentRect: {
                height: element.offsetHeight,
                width: element.offsetWidth,
            },
        });

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
