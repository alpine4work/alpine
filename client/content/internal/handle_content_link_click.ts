import {To} from "react-router-dom";
import {isModifiedPointerEvent} from "~/client/helpers/events/is_modified_pointer_event.js";
import {isOpenLinkInSeparateTabPointerEvent} from "~/client/helpers/events/is_open_link_in_separate_tab_pointer_event.js";
import {getClientInfo} from "~/client/remix/client_info_context.js";
import {assert} from "~/shared/helpers/control/assert.js";

const pendingUrlByElement = new Map<HTMLAnchorElement, URL>();

/**
 * Handle when a link is clicked. If the link points to a URL in our space then
 * we want to navigate directly there instead of opening the link in a new tab.
 */
export function handleContentLinkClick(
    event: PointerEvent | MouseEvent,
    onNavigate: (to: To) => Promise<void>,
) {
    const element = event.currentTarget;
    assert(element instanceof HTMLAnchorElement);

    const isOpenLinkInSeparateTabEvent = isOpenLinkInSeparateTabPointerEvent(
        event,
        getClientInfo(),
    );

    // Ignore non-left clicks (e.g. right clicks) and ignore clicks with a keyboard
    // modifier. Unless the click was meant to open the link in a separate tab. We
    // need to implement that manually here given the text is editable.
    if ((event.button !== 0 || isModifiedPointerEvent(event)) && !isOpenLinkInSeparateTabEvent) {
        return;
    }

    // Don't select the editable text. Instead we want to open the URL.
    event.preventDefault();

    const oldUrl = new URL(window.location.href);

    let newUrl: URL | null;
    try {
        newUrl = new URL(element.href);
    } catch {
        newUrl = null;
    }

    // For URLs in the same space, open the link in the current tab instead of a
    // new tab. Unless this click was a cmd-click on MacOS or other shortcut for
    // opening links in a new tab.
    if (!isOpenLinkInSeparateTabEvent && newUrl && oldUrl.host === newUrl.host) {
        const spaceIdRegExp = /^\/s\/([^/]+)(?:\/|$)/;
        const oldUrlSpaceIdMatch = oldUrl.pathname.match(spaceIdRegExp);
        const newUrlSpaceIdMatch = newUrl.pathname.match(spaceIdRegExp);
        if (
            oldUrlSpaceIdMatch &&
            newUrlSpaceIdMatch &&
            oldUrlSpaceIdMatch[1] === newUrlSpaceIdMatch[1]
        ) {
            // If we are already waiting on a navigation for this link, don't perform a
            // new navigation.
            if (pendingUrlByElement.get(element)?.toString() === newUrl.toString()) {
                return;
            }

            const navigationPromise = onNavigate({
                pathname: newUrl.pathname,
                search: newUrl.search,
                hash: newUrl.hash,
            });

            pendingUrlByElement.set(element, newUrl);
            void navigationPromise.finally(() => {
                pendingUrlByElement.delete(element);
            });
            return;
        }
    }

    window.open(
        element.href,
        "_blank",
        // Important security measure. See:
        // https://mathiasbynens.github.io/rel-noopener
        "noopener noreferrer",
    );
}
