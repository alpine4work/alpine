import {DragEvent, MouseEvent, PointerEvent, useRef} from "react";
import {doubleClickDelayMs} from "~/client/design/timing_constants.js";

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

    return {
        onPointerDown: event => {
            if (event.button !== 0) return;

            if (isDisabled) return;
            if (!accept(event)) return;

            isPointerDownAndOverRef.current = true;

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
        },
        onPointerUp: event => {
            const wasPointerDownAndOver = isPointerDownAndOverRef.current;
            isPointerDownAndOverRef.current = false;

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
        },
        onPointerCancel: () => {
            isPointerDownAndOverRef.current = false;
        },
        onDragStart: () => {
            isPointerDownAndOverRef.current = false;
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
