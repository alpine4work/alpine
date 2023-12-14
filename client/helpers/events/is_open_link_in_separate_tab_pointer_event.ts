import {PressEvent} from "@react-types/shared";
import {getClientInfoWithoutListening} from "~/client/remix/client_info_context.js";

/**
 * Is this a click event that on an `<a>` element would open the URL in a
 * separate tab? Cmd-click on MacOS does this and ctrl-click on Windows does
 * this.
 */
export function isOpenLinkInSeparateTabPointerEvent(
    event: PointerEvent | MouseEvent | PressEvent,
): boolean {
    return (
        ("button" in event && event.button === 1) ||
        (getClientInfoWithoutListening().isAppleDevice ? event.metaKey : event.ctrlKey)
    );
}
