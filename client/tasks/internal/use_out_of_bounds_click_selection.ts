import {MouseEvent, useRef} from "react";
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
    onSelect: () => void;
    onSelectAll: () => void;
    accept?: (event: MouseEvent) => boolean;
}): {
    onClick: (event: MouseEvent) => void;
    onDoubleClick: (event: MouseEvent) => void;
    onMouseDown: (event: MouseEvent) => void;
    onContextMenu: (event: MouseEvent) => void;
} {
    const lastDoubleClickTimeRef = useRef<number | null>(null);

    return {
        onMouseDown: event => {
            if (isDisabled) return;
            if (!accept(event)) return;

            if (
                lastDoubleClickTimeRef.current === null ||
                Date.now() - lastDoubleClickTimeRef.current > doubleClickDelayMs
            ) {
                // If we are the child of a focusable element, don't focus our parent
                // after `mousedown`.
                event.preventDefault();

                onSelect();
            } else {
                // `mousedown` will unfocus whatever is focused. If the user is actively
                // double, triple, whatever clicking don't unfocus.
                event.preventDefault();

                lastDoubleClickTimeRef.current = Date.now();
            }
        },
        onClick: event => {
            if (isDisabled) return;
            if (!accept(event)) return;

            if (
                lastDoubleClickTimeRef.current === null ||
                Date.now() - lastDoubleClickTimeRef.current > doubleClickDelayMs
            ) {
                onSelect();
            } else {
                lastDoubleClickTimeRef.current = Date.now();
            }
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

            onSelect();
        },
    };
}
