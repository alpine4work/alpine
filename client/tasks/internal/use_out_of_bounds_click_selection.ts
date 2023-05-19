import {MouseEvent, useRef} from "react";

const doubleClickSelectThrottleMs = 500;

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
    onSelect: (event: MouseEvent) => void;
    onSelectAll: (event: MouseEvent) => void;
}): {
    onClick: (event: MouseEvent) => void;
    onDoubleClick: (event: MouseEvent) => void;
} {
    const lastDoubleClickTimeRef = useRef<number | null>(null);

    return {
        onClick: event => {
            if (
                lastDoubleClickTimeRef.current === null ||
                Date.now() - lastDoubleClickTimeRef.current > doubleClickSelectThrottleMs
            ) {
                onSelect(event);
            } else {
                lastDoubleClickTimeRef.current = Date.now();
            }
        },
        onDoubleClick: event => {
            if (
                lastDoubleClickTimeRef.current === null ||
                Date.now() - lastDoubleClickTimeRef.current > doubleClickSelectThrottleMs
            ) {
                onSelectAll(event);
            }

            lastDoubleClickTimeRef.current = Date.now();
        },
    };
}
