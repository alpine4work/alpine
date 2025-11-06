import {To} from "react-router-dom";
import {dispatchOutsideInteractionEvent} from "~/client/design/helpers/use_outside_interaction.js";
import {isModifiedPointerEvent} from "~/client/helpers/events/is_modified_pointer_event.js";
import {isOpenLinkInSeparateTabPointerEvent} from "~/client/helpers/events/is_open_link_in_separate_tab_pointer_event.js";
import {getClientInfo} from "~/client/remix/client_info_context.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.js";

const pendingUrlByEventTarget = new Map<EventTarget, URL>();

/**
 * Handle when a link is clicked. If the link points to a URL in our space then
 * we want to navigate directly there instead of opening the link in a new tab.
 *
 * The `href` should be the same string as what would go in the `<a href>`
 * attribute for the link we're clicking.
 */
export function handleContentLinkClick(
    event: PointerEvent | MouseEvent,
    href: string,
    onNavigate: (to: To) => Promise<void>,
) {
    const eventTarget = assertExists(event.currentTarget);

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

    // Always treat link click events as outside interactions. Since navigating
    // opens "outside" content the user may then want to interact with via the
    // keyboard or mouse (e.g. they might want to press "Escape" to close a peek
    // which instead cancels editing).
    //
    // Fixes this bug:
    // https://alpine.inc/s/c2pwxmpv3z7b3db19tsn6y1qfg/tasks/887mqr54v2jh8kkg8qz8mt16y4
    dispatchOutsideInteractionEvent(event);

    // If `event.preventDefault()` was called (perhaps by a
    // `useOutsideInteraction()` listener) then don't navigate.
    if (event.defaultPrevented) return;

    // Don't select the editable text. Instead we want to open the URL.
    event.preventDefault();

    const oldUrl = new URL(window.location.href);

    let newUrl: URL | null;
    try {
        newUrl = new URL(href, oldUrl);
    } catch {
        newUrl = null;
    }

    // For URLs in the same space, open the link in the current tab instead of a
    // new tab. Unless this click was a cmd-click on MacOS or other shortcut for
    // opening links in a new tab.
    if (
        !isOpenLinkInSeparateTabEvent &&
        newUrl &&
        (oldUrl.host === newUrl.host ||
            // NOTE(calebmer, 2025-02-20): Support links from before we migrated from
            // https://cyberworlds.dev to https://alpine.inc.
            (oldUrl.host === "alpine.inc" && newUrl.host === "cyberworlds.dev"))
    ) {
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
            if (pendingUrlByEventTarget.get(eventTarget)?.toString() === newUrl.toString()) {
                return;
            }

            const navigationPromise = onNavigate({
                pathname: newUrl.pathname,
                search: newUrl.search,
                hash: newUrl.hash,
            });

            pendingUrlByEventTarget.set(eventTarget, newUrl);
            void navigationPromise.finally(() => {
                // Make sure the URL in `pendingUrlByEventTarget` hasn't changed before we
                // delete it.
                if (pendingUrlByEventTarget.get(eventTarget) === newUrl) {
                    pendingUrlByEventTarget.delete(eventTarget);
                }
            });
            return;
        }
    }

    window.open(
        href,
        "_blank",
        // Important security measure. See:
        // https://mathiasbynens.github.io/rel-noopener
        "noopener noreferrer",
    );
}
