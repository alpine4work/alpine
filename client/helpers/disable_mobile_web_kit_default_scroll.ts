import {isMobileWebKit} from "~/client/helpers/browser/is_mobile_web_kit.js";

/**
 * Disable the default scroll behavior when touch moves on a non-scrollable
 * element in mobile WebKit (iOS). Useful in the following cases:
 *
 * - When the virtual keyboard is open WebKit makes the page scrollable even if
 *   `overflow: hidden` is set on `body`. Disabling default scroll makes the
 *   page not scrollable again.
 *
 * - When a `position: fixed` modal is open and the user's finger scrolls the
 *   scroll event "falls through" to a scroll view covered by the element.
 *   Disabling default scroll means scroll events are stopped.
 *
 * With default scroll disabled, if you have an `overflow-y: scroll` element
 * it's still scrollable.
 *
 * IMPORTANT: Works by adding a `{passive: false}` `touchmove` event handler.
 * This is bad for performance! Only disabled default scroll if absolutely
 * necessary and only in the states where it's necessary.
 */
export function disableMobileWebKitDefaultScroll(): () => void {
    if (!isMobileWebKit) return () => {};

    const handleTouchMove = (event: TouchEvent) => {
        if (!(event.target instanceof Node)) {
            event.preventDefault();
            return;
        }

        // We cache the `overflow-y` parent for the event target because this handler
        // needs to run very fast given `{passive: false}` is set. Otherwise
        // interaction performance (e.g. scroll performance) will be hurt.
        let overflowYParent = overflowYParentCache.get(event.target);
        if (overflowYParent === undefined) {
            overflowYParent = getOverflowYParent(event.target);
            overflowYParentCache.set(event.target, overflowYParent);
        }

        const hasScrollableOverflowYParent =
            !!overflowYParent &&
            (overflowYParent.overflowY !== "auto" ||
                overflowYParent.element.scrollHeight > overflowYParent.element.clientHeight);

        if (!hasScrollableOverflowYParent) {
            event.preventDefault();
            return;
        }
    };

    const overflowYParentCache = new WeakMap<
        Node,
        {element: HTMLElement; overflowY: "scroll" | "auto"} | null
    >();

    const getOverflowYParent = (
        node: Node,
    ): {element: HTMLElement; overflowY: "scroll" | "auto"} | null => {
        let element = node instanceof HTMLElement ? node : node.parentElement;

        while (element) {
            const {position, overflowY} = getComputedStyle(element);

            if (overflowY === "scroll" || overflowY === "auto") {
                return {element, overflowY};
            }

            element = position === "fixed" ? document.body : element.parentElement;
        }

        return null;
    };

    document.addEventListener("touchmove", handleTouchMove, {passive: false});
    return () => {
        document.removeEventListener("touchmove", handleTouchMove);
    };
}
