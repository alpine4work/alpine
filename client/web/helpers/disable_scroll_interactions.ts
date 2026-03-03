export type ScrollableParent = {
    readonly element: HTMLElement;
    readonly overflowX: "scroll" | "auto" | null;
    readonly overflowY: "scroll" | "auto" | null;
};

/**
 * Disable scrolling by user interaction for a target element.
 *
 * Disables the following interactions:
 *
 * - Mouse wheel scrolling
 * - Touch pan gesture scrolling
 *
 * You may provide a `shouldAllowEvent()` function to allow some scroll events to
 * be allowed. You may want to allow scroll events in certain child elements but
 * not parent elements.
 *
 * IMPORTANT: Works by adding a `{passive: false}` `touchmove` event handler. This
 * is bad for performance! Only disabled default scroll if absolutely necessary and
 * only in the states where it's necessary.
 */
export function disableScrollInteractions(
    target: HTMLElement,
    shouldAllowEvent: (
        event: WheelEvent | TouchEvent,
        targetScrollableParent: ScrollableParent | null,
    ) => boolean = () => true,
): () => void {
    const handleScroll = (event: WheelEvent | TouchEvent) => {
        if (!(event.target instanceof Node)) {
            event.preventDefault();
            return;
        }

        // We cache the scrollable parent for the event target because this handler needs
        // to run very fast given `{passive: false}` is set. Otherwise interaction
        // performance (e.g. scroll performance) will be hurt.
        let targetScrollableParent = scrollableParentCache.get(event.target);
        if (targetScrollableParent === undefined) {
            targetScrollableParent = getScrollableParent(event.target);
            scrollableParentCache.set(event.target, targetScrollableParent);
        }

        if (shouldAllowEvent(event, targetScrollableParent) !== true) {
            event.preventDefault();
            return;
        }
    };

    const scrollableParentCache = new WeakMap<Node, ScrollableParent | null>();

    const getScrollableParent = (node: Node): ScrollableParent | null => {
        let element = node instanceof HTMLElement ? node : node.parentElement;

        while (element) {
            const {position, overflowX, overflowY} = getComputedStyle(element);

            if (
                overflowX === "scroll" ||
                (overflowX === "auto" && element.scrollWidth > element.clientWidth) ||
                overflowY === "scroll" ||
                (overflowY === "auto" && element.scrollHeight > element.clientHeight)
            ) {
                return {
                    element,
                    overflowX: overflowX === "scroll" || overflowX === "auto" ? overflowX : null,
                    overflowY: overflowY === "scroll" || overflowY === "auto" ? overflowY : null,
                };
            }

            element = position === "fixed" ? document.body : element.parentElement;
        }

        return null;
    };

    target.addEventListener("wheel", handleScroll, {passive: false});
    target.addEventListener("touchmove", handleScroll, {passive: false});

    return () => {
        target.removeEventListener("wheel", handleScroll);
        target.removeEventListener("touchmove", handleScroll);
    };
}
