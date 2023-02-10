import {DOMSerializer, Mark} from "prosemirror-model";
import {MarkViewConstructor} from "prosemirror-view";
import {To} from "react-router-dom";
import {handleContentLinkClick} from "~/client/content/internal/handle_content_link_click";
import {tooltipDelayMs} from "~/client/design/tooltip";
import {isModifiedPointerEvent} from "~/client/helpers/events/is_modified_pointer_event";
import {isOpenLinkInSeparateTabPointerEvent} from "~/client/helpers/events/is_open_link_in_separate_tab_pointer_event";
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

        let isPointerDownAndOver = false;

        dom.addEventListener("pointerdown", event => {
            isPointerDownAndOver = true;

            // Ignore non-left clicks (e.g. right clicks) and ignore clicks with a keyboard
            // modifier. Unless the click was meant to open the link in a separate tab. We
            // need to implement that manually here given the text is editable.
            if (
                (event.button !== 0 || isModifiedPointerEvent(event)) &&
                !isOpenLinkInSeparateTabPointerEvent(event)
            ) {
                return;
            }

            // This will be a navigation click if the pointer stays over our element. Don't
            // select the editable text.
            event.preventDefault();
        });

        dom.addEventListener("pointerup", event => {
            const wasPointerDownAndOver = isPointerDownAndOver;
            isPointerDownAndOver = false;

            // Only process pointer up events that started on our element.
            if (!wasPointerDownAndOver) return;

            handleContentLinkClick(event, onNavigate);
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
            }, tooltipDelayMs);
        });

        dom.addEventListener("pointerleave", () => {
            isPointerDownAndOver = false;

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
