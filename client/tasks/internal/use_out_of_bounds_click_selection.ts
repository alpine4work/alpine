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
    onSelect,
    onSelectAll,
}: {
    onSelect: () => void;
    onSelectAll: () => void;
}): {
    onClick: (event: MouseEvent) => void;
    onDoubleClick: (event: MouseEvent) => void;
    onMouseDown: (event: MouseEvent) => void;
    onContextMenu: (event: MouseEvent) => void;
} {
    const lastDoubleClickTimeRef = useRef<number | null>(null);

    return {
        onClick: event => {
            // Only accept direct clicks on the element.
            if (event.target !== event.currentTarget) return;

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
            // Only accept direct clicks on the element.
            if (event.target !== event.currentTarget) return;

            if (
                lastDoubleClickTimeRef.current === null ||
                Date.now() - lastDoubleClickTimeRef.current > doubleClickDelayMs
            ) {
                onSelectAll();
            }

            lastDoubleClickTimeRef.current = Date.now();
        },
        onMouseDown: event => {
            // Only accept direct clicks on the element.
            if (event.target !== event.currentTarget) return;

            // `mousedown` will unfocus whatever is focused. If the user is actively
            // double, triple, whatever clicking don't unfocus.
            if (
                lastDoubleClickTimeRef.current !== null &&
                Date.now() - lastDoubleClickTimeRef.current <= doubleClickDelayMs
            ) {
                event.preventDefault();
            }
        },
        // When the user right-clicks, focus the text input. Just like clicking on the
        // area would. This also will make sure we open up the context menu when the
        // event finishes bubbling up.
        onContextMenu: event => {
            // Only accept direct clicks on the element.
            if (event.target !== event.currentTarget) return;

            onSelect();
        },
    };
}
