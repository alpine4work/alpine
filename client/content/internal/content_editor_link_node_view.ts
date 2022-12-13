import {DOMSerializer, Mark} from "prosemirror-model";
import {MarkViewConstructor} from "prosemirror-view";
import {To} from "react-router-dom";
import {presentExtraContextAfterDelayMs} from "~/client/design/timing_constants";
import {isMac} from "~/client/helpers/is_mac";
import {Timeout, createTimeout} from "~/shared/helpers/async/timeout";
import {assert} from "~/shared/helpers/control/assert";

/**
 * Opens the link when the node is clicked instead of selecting text. We're
 * optimizing for reading content here over writing.
 */
export function createContentEditorMarkNodeViewConstructor({
    onPointerEnterAfterDelay,
    onPointerEnter,
    onPointerLeave,
    onNavigate,
}: {
    onPointerEnterAfterDelay: (options: {mark: Mark; range: {from: number; to: number}}) => void;
    onPointerEnter: (mark: Mark) => void;
    onPointerLeave: (mark: Mark) => void;
    onNavigate: (to: To) => void;
}): MarkViewConstructor {
    return (mark, view, inline) => {
        const {dom, contentDOM: contentDom} = DOMSerializer.renderSpec(
            document,
            mark.type.spec.toDOM!(mark, inline),
        );

        assert(dom instanceof HTMLAnchorElement);

        dom.addEventListener("pointerdown", event => {
            const isModifiedEvent =
                event.metaKey || event.altKey || event.ctrlKey || event.shiftKey;
            const isOpenInSeparateTabClick =
                event.button === 1 || (isMac ? event.metaKey : event.ctrlKey);

            // Ignore non-left clicks (e.g. right clicks) and ignore clicks with a keyboard
            // modifier. Unless the click was meant to open the link in a separate tab. We
            // need to implement that manually here given the text is editable.
            if ((event.button !== 0 || isModifiedEvent) && !isOpenInSeparateTabClick) return;

            // Don't select the editable text. Instead we want to open the URL.
            event.preventDefault();

            const oldUrl = new URL(window.location.href);

            let newUrl: URL | null;
            try {
                newUrl = new URL(dom.href);
            } catch {
                newUrl = null;
            }

            // For URLs in the same space, open the link in the current tab instead of a
            // new tab. Unless this click was a cmd-click on MacOS or other shortcut for
            // opening links in a new tab.
            if (!isOpenInSeparateTabClick && newUrl && oldUrl.host === newUrl.host) {
                const spaceIdRegExp = /^\/s\/([a-zA-Z0-9]{26})(?:\/|$)/;
                const oldUrlSpaceIdMatch = oldUrl.pathname.match(spaceIdRegExp);
                const newUrlSpaceIdMatch = newUrl.pathname.match(spaceIdRegExp);
                if (
                    oldUrlSpaceIdMatch &&
                    newUrlSpaceIdMatch &&
                    oldUrlSpaceIdMatch[1] === newUrlSpaceIdMatch[1]
                ) {
                    onNavigate({
                        pathname: newUrl.pathname,
                        search: newUrl.search,
                        hash: newUrl.hash,
                    });
                    return;
                }
            }

            window.open(
                dom.href,
                "_blank",
                // Important security measure. See:
                // https://mathiasbynens.github.io/rel-noopener
                "noopener noreferrer",
            );
        });

        let pointerEnterDelayTimeout: Timeout | null = null;

        dom.addEventListener("pointerenter", event => {
            if (pointerEnterDelayTimeout) {
                pointerEnterDelayTimeout.clear();
                pointerEnterDelayTimeout = null;
            }

            const posResult = view.posAtCoords({left: event.clientX, top: event.clientY});
            if (!posResult) return;

            const $pos = view.state.doc.resolve(posResult.pos);

            // We do this form instead of `$pos.node()` to find the inline text
            // node the mark is on.
            let index = $pos.index();
            let node = $pos.parent.maybeChild(index);

            // Double check that node has the mark we're rendering.
            if (!node || !mark.isInSet(node.marks)) {
                // If the mark was not present on our node, sometimes that means we found the
                // position of the index after our text node. So try adjusting the index and
                // checking if that node has our mark.
                if (index > 0) {
                    index = index - 1;
                    node = $pos.parent.child(index);
                    if (!mark.isInSet(node.marks)) return;
                } else {
                    return;
                }
            }

            // Find the first node in a sequence to have our mark. In case some text in the
            // middle of the link is bolded.
            while (index > 0) {
                const previousNode = $pos.parent.child(index - 1);
                if (!mark.isInSet(previousNode.marks)) break;
                index = index - 1;
                node = previousNode;
            }

            onPointerEnter(mark);

            pointerEnterDelayTimeout = createTimeout(() => {
                // If the node was removed from the DOM, don't proceed with the timeout. We
                // don't get a destroy callback for the mark so we have to be defensive here.
                if (!document.body.contains(dom)) return;

                onPointerEnterAfterDelay({
                    mark,
                    range: {
                        from: $pos.posAtIndex(index),
                        to: $pos.posAtIndex(index + 1),
                    },
                });
            }, presentExtraContextAfterDelayMs);
        });

        dom.addEventListener("pointerleave", () => {
            if (pointerEnterDelayTimeout) {
                pointerEnterDelayTimeout.clear();
                pointerEnterDelayTimeout = null;
            }

            onPointerLeave(mark);
        });

        return {
            dom,
            contentDOM: contentDom,
        };
    };
}
