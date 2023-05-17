import {KeyboardEvent as ReactKeyboardEvent} from "react";

/**
 * Is a modifier key pressed during this keyboard event? For example shift key
 * or command key. Will return false if no modifier keys are being pressed.
 */
export function isModifiedKeyboardEvent(event: KeyboardEvent | ReactKeyboardEvent): boolean {
    return event.metaKey || event.altKey || event.ctrlKey || event.shiftKey;
}
