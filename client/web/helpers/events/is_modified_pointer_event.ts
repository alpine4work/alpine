import {MouseEvent as ReactMouseEvent, PointerEvent as ReactPointerEvent} from "react";

/**
 * Is a modifier key pressed during this pointer event? For example shift key
 * or command key. Will return false if no modifier keys are being pressed.
 */
export function isModifiedPointerEvent(
    event: PointerEvent | ReactPointerEvent | MouseEvent | ReactMouseEvent,
): boolean {
    return event.metaKey || event.altKey || event.ctrlKey || event.shiftKey;
}
