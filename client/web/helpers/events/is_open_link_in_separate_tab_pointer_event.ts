import {PressEvent} from "@react-types/shared";

/**
 * Is this a click event that on an `<a>` element would open the URL in a
 * separate tab? Cmd-click on MacOS does this and ctrl-click on Windows does
 * this.
 */
export function isOpenLinkInSeparateTabPointerEvent(
    event: PointerEvent | MouseEvent | PressEvent,
    clientInfo: {isAppleDevice: boolean},
): boolean {
    return (
        ("button" in event && event.button === 1) ||
        (clientInfo.isAppleDevice ? event.metaKey : event.ctrlKey)
    );
}
