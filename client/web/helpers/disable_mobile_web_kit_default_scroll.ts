import {isMobileWebKit} from "~/client/web/helpers/browser/is_mobile_web_kit.js";
import {disableScrollInteractions} from "~/client/web/helpers/disable_scroll_interactions.js";
import {noop} from "~/shared/helpers/control/noop.js";

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
 * or `overflow-x: scroll` element they're still scrollable. We only disable
 * scrolling for elements which shouldn't be scrollable according to CSS but
 * the browser still wants to dispatch scroll events for.
 *
 * IMPORTANT: Works by adding a `{passive: false}` `touchmove` event handler.
 * This is bad for performance! Only disabled default scroll if absolutely
 * necessary and only in the states where it's necessary.
 */
export function disableMobileWebKitDefaultScroll() {
    if (!isMobileWebKit) return noop;

    let initialTouches: Array<Touch> = [];
    let isHorizontalScrollGesture: boolean | null = null;

    const handleTouchStart = (event: TouchEvent) => {
        initialTouches = [...event.touches];
        isHorizontalScrollGesture = null;
    };

    document.addEventListener("touchstart", handleTouchStart, {passive: false});

    const cleanup = disableScrollInteractions(document.body, (event, targetScrollableParent) => {
        if (event instanceof WheelEvent) return true;

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

        const hasScrollableOverflowXParent = !!targetScrollableParent?.overflowX;
        const hasScrollableOverflowYParent = !!targetScrollableParent?.overflowY;

        return (
            hasScrollableOverflowYParent ||
            // Make sure we don't break horizontal scrolling. If we're in a horizontally
            // scrollable element, allow horizontal scroll gestures. Vertical scroll
            // gestures are still problematic when the iOS keyboard is open so we still
            // need to prevent vertical scrolls.
            (hasScrollableOverflowXParent && isHorizontalScrollGesture)
        );
    });

    return () => {
        document.removeEventListener("touchstart", handleTouchStart);
        cleanup();
    };
}
