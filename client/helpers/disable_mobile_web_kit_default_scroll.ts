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

    let initialTouches: Array<Touch> = [];
    let isHorizontalScrollGesture: boolean | null = null;

    const handleTouchStart = (event: TouchEvent) => {
        initialTouches = [...event.touches];
        isHorizontalScrollGesture = null;
    };

    const handleTouchMove = (event: TouchEvent) => {
        if (!(event.target instanceof Node)) {
            event.preventDefault();
            return;
        }

        // Try to infer if native iOS will interpret this as a horizontal scroll
        // gesture.
        //
        // This is not based on any principles, this is purely based off heuristics
        // from testing. If iOS can scroll both vertically and horizontally, it'll pick
        // the direction the scroll scrolled more in the first touch move.
        if (isHorizontalScrollGesture === null) {
            const touches = [...event.touches];

            isHorizontalScrollGesture =
                initialTouches.length === 1 &&
                touches.length === 1 &&
                Math.abs(initialTouches[0]!.clientX - touches[0]!.clientX) >
                    Math.abs(initialTouches[0]!.clientY - touches[0]!.clientY);
        }

        // We cache the scrollable parent for the event target because this handler
        // needs to run very fast given `{passive: false}` is set. Otherwise
        // interaction performance (e.g. scroll performance) will be hurt.
        let scrollableParent = scrollableParentCache.get(event.target);
        if (scrollableParent === undefined) {
            scrollableParent = getScrollableParent(event.target);
            scrollableParentCache.set(event.target, scrollableParent);
        }

        const hasScrollableOverflowXParent =
            scrollableParent &&
            (scrollableParent.overflowX === "scroll" ||
                (scrollableParent.overflowX === "auto" &&
                    scrollableParent.element.scrollWidth > scrollableParent.element.clientWidth));

        const hasScrollableOverflowYParent =
            scrollableParent &&
            (scrollableParent.overflowY === "scroll" ||
                (scrollableParent.overflowY === "auto" &&
                    scrollableParent.element.scrollHeight > scrollableParent.element.clientHeight));

        const shouldAllowEvent =
            hasScrollableOverflowYParent ||
            // Make sure we don't break horizontal scrolling. If we're in a horizontally
            // scrollable element, allow horizontal scroll gestures. Vertical scroll
            // gestures are still problematic when the iOS keyboard is open so we still
            // need to prevent vertical scrolls.
            (hasScrollableOverflowXParent && isHorizontalScrollGesture);

        if (!shouldAllowEvent) {
            event.preventDefault();
            return;
        }
    };

    const scrollableParentCache = new WeakMap<
        Node,
        {
            element: HTMLElement;
            overflowX: string;
            overflowY: string;
        } | null
    >();

    const getScrollableParent = (
        node: Node,
    ): {
        element: HTMLElement;
        overflowX: string;
        overflowY: string;
    } | null => {
        let element = node instanceof HTMLElement ? node : node.parentElement;

        while (element) {
            const {position, overflowX, overflowY} = getComputedStyle(element);

            if (
                overflowX === "scroll" ||
                overflowX === "auto" ||
                overflowY === "scroll" ||
                overflowY === "auto"
            ) {
                return {
                    element,
                    overflowX,
                    overflowY,
                };
            }

            element = position === "fixed" ? document.body : element.parentElement;
        }

        return null;
    };

    document.addEventListener("touchstart", handleTouchStart, {passive: false});
    document.addEventListener("touchmove", handleTouchMove, {passive: false});
    return () => {
        document.removeEventListener("touchstart", handleTouchStart);
        document.removeEventListener("touchmove", handleTouchMove);
    };
}
