import {isMac} from "~/client/helpers/is_mac";

/**
 * Is this a click event that on an `<a>` element would open the URL in a
 * separate tab? Cmd-click on MacOS does this and ctrl-click on Windows does
 * this.
 */
export function isOpenLinkInSeparateTabPointerEvent(event: PointerEvent | MouseEvent): boolean {
    return event.button === 1 || (isMac ? event.metaKey : event.ctrlKey);
}
