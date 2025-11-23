import {DragEvent, MouseEvent, PointerEvent, useRef} from "react";
import {doubleClickDelayMs} from "~/shared/design/core/timing.js";

/**
 * When a user clicks out of bounds on a document it selects the nearest line
 * of text. When they double click it selects the entire paragraph. If they
 * furiously click the full paragraph selection stays.
 *
 * This hook implements the timing logic for selection.
 */
export function useOutOfBoundsClickSelection({
    isDisabled,
    onSelect,
    onSelectAll,
    accept = event => event.target === event.currentTarget,
}: {
    isDisabled?: boolean;
    onSelect: (event: PointerEvent | MouseEvent) => void;
    onSelectAll: () => void;
    accept?: (event: MouseEvent) => boolean;
}): {
    onPointerDown: (event: PointerEvent) => void;
    onPointerUp: (event: PointerEvent) => void;
    onPointerLeave: (event: PointerEvent) => void;
    onPointerCancel: (event: PointerEvent) => void;
    onDragStart: (event: DragEvent) => void;
    onDoubleClick: (event: MouseEvent) => void;
    onContextMenu: (event: MouseEvent) => void;
} {
    const isPointerDownAndOverRef = useRef(false);
    const lastDoubleClickTimeRef = useRef<number | null>(null);
    const removeScrollEventListenersRef = useRef<(() => void) | null>(null);

    return {
        onPointerDown: event => {
            if (event.button !== 0) return;

            if (isDisabled) return;
            if (!accept(event)) return;

            isPointerDownAndOverRef.current = true;
            removeScrollEventListenersRef.current?.();
            removeScrollEventListenersRef.current = null;

            // Focus on `pointerdown` if this is the mouse. Focus on `pointerup` if this is
            // touch. Because a touch press gesture might actually be a scroll. If the user
            // starts scrolling that cancels our press.
            if (event.pointerType === "mouse") {
                if (
                    lastDoubleClickTimeRef.current === null ||
                    Date.now() - lastDoubleClickTimeRef.current > doubleClickDelayMs
                ) {
                    // If we are the child of a focusable element, don't focus our parent
                    // after `mousedown`.
                    event.preventDefault();

                    onSelect(event);
                } else {
                    // `mousedown` will unfocus whatever is focused. If the user is actively
                    // double, triple, whatever clicking don't unfocus.
                    event.preventDefault();

                    lastDoubleClickTimeRef.current = Date.now();
                }
            }
            // If this is a non-mouse pointer then we'll focus on `pointerup`. If a scroll
            // happens between `pointerdown` and `pointerup` we want to cancel the press
            // and not focus. Otherwise the keyboard may open while the user is scrolling
            // which is weird.
            //
            // Watch all parent elements of our content editor for scroll events. When a
            // scroll event occurs we set `isPointerDownAndOverRef.current = false`.
            //
            // This replicates the behavior in `@react-aria/interactions` where a press is
            // cancelled when a parent element scrolls. This behavior is important for
            // mobile since the user must press somewhere on the screen to scroll. Normally
            // `pointercancel` should be dispatched when the user scrolls while pressing on
            // some element but when the CSS `touch-action: manipulation` is set the press
            // is not cancelled.
            else {
                const handleScroll = () => {
                    isPointerDownAndOverRef.current = false;
                    removeScrollEventListenersRef.current?.();
                    removeScrollEventListenersRef.current = null;
                };

                const scrollEventTargets: Array<EventTarget> = [window];

                {
                    let parentElement = event.currentTarget.parentElement;
                    while (parentElement) {
                        const {overflowX, overflowY} = getComputedStyle(parentElement);

                        if (
                            overflowX === "auto" ||
                            overflowX === "scroll" ||
                            overflowY === "auto" ||
                            overflowY === "scroll"
                        ) {
                            scrollEventTargets.push(parentElement);
                        }

                        parentElement =
                            parentElement.parentElement !== document.body
                                ? parentElement.parentElement
                                : null;
                    }
                }

                for (const scrollEventTarget of scrollEventTargets) {
                    scrollEventTarget.addEventListener("scroll", handleScroll, true);
                }

                removeScrollEventListenersRef.current = () => {
                    for (const scrollEventTarget of scrollEventTargets) {
                        scrollEventTarget.removeEventListener("scroll", handleScroll, true);
                    }
                };
            }
        },
        onPointerUp: event => {
            const wasPointerDownAndOver = isPointerDownAndOverRef.current;
            isPointerDownAndOverRef.current = false;
            removeScrollEventListenersRef.current?.();
            removeScrollEventListenersRef.current = null;

            if (!wasPointerDownAndOver) return;
            if (isDisabled) return;

            // Focus on `pointerdown` if this is the mouse. Focus on `pointerup` if this is
            // touch. Because a touch press gesture might actually be a scroll. If the user
            // starts scrolling that cancels our press.
            if (event.pointerType !== "mouse") {
                if (
                    lastDoubleClickTimeRef.current === null ||
                    Date.now() - lastDoubleClickTimeRef.current > doubleClickDelayMs
                ) {
                    // If we are the child of a focusable element, don't focus our parent
                    // after `mousedown`.
                    event.preventDefault();

                    onSelect(event);
                } else {
                    // `mousedown` will unfocus whatever is focused. If the user is actively
                    // double, triple, whatever clicking don't unfocus.
                    event.preventDefault();

                    lastDoubleClickTimeRef.current = Date.now();
                }
            }
        },
        onPointerLeave: () => {
            isPointerDownAndOverRef.current = false;
            removeScrollEventListenersRef.current?.();
            removeScrollEventListenersRef.current = null;
        },
        onPointerCancel: () => {
            isPointerDownAndOverRef.current = false;
            removeScrollEventListenersRef.current?.();
            removeScrollEventListenersRef.current = null;
        },
        onDragStart: () => {
            isPointerDownAndOverRef.current = false;
            removeScrollEventListenersRef.current?.();
            removeScrollEventListenersRef.current = null;
        },
        onDoubleClick: event => {
            if (isDisabled) return;
            if (!accept(event)) return;

            if (
                lastDoubleClickTimeRef.current === null ||
                Date.now() - lastDoubleClickTimeRef.current > doubleClickDelayMs
            ) {
                onSelectAll();
            }

            lastDoubleClickTimeRef.current = Date.now();
        },
        // When the user right-clicks, focus the text input. Just like clicking on the
        // area would. This also will make sure we open up the context menu when the
        // event finishes bubbling up.
        onContextMenu: event => {
            if (isDisabled) return;
            if (!accept(event)) return;

            onSelect(event);
        },
    };
}
