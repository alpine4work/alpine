import {DOMSerializer, Mark} from "prosemirror-model";
import {MarkViewConstructor} from "prosemirror-view";
import {To} from "react-router-dom";
import {handleContentLinkClick} from "~/client/web/content/internal/handle_content_link_click.js";
import {addParentScrollWhenPointerDownAndOverListener} from "~/client/web/content/state/parent_scroll_when_pointer_down_and_over_event.js";
import {tooltipDelayMs} from "~/client/web/design/tooltip.js";
import {isModifiedPointerEvent} from "~/client/web/helpers/events/is_modified_pointer_event.js";
import {isOpenLinkInSeparateTabPointerEvent} from "~/client/web/helpers/events/is_open_link_in_separate_tab_pointer_event.js";
import {getClientInfo} from "~/client/web/remix/client_info_context.js";
import {contentStyles} from "~/client/web/styles/styles.js";
import {Timeout, createTimeout} from "~/shared/helpers/async/timeout.js";
import {assert} from "~/shared/helpers/control/assert.js";

const {linkPressedClassName} = contentStyles;

/**
 * Opens the link when the node is clicked instead of selecting text. We're
 * optimizing for reading content here over writing.
 */
export function createContentEditorLinkMarkViewConstructor({
    canPrimaryInputHover,
    onPointerEnterAfterDelay,
    onPointerEnter,
    onPointerLeave,
    onNavigate,
}: {
    canPrimaryInputHover: () => boolean;
    onPointerEnterAfterDelay: (options: {
        mark: Mark;
        range: {from: number; to: number};
        wasPointerDown: boolean;
    }) => void;
    onPointerEnter: (mark: Mark) => void;
    onPointerLeave: (mark: Mark) => void;
    onNavigate: (to: To) => Promise<void>;
}): MarkViewConstructor {
    return (mark, view, inline) => {
        const {dom, contentDOM: contentDom} = DOMSerializer.renderSpec(
            document,
            mark.type.spec.toDOM!(mark, inline),
        );

        assert(dom instanceof HTMLAnchorElement);

        const isInert = (): boolean => {
            if (canPrimaryInputHover()) return false;
            return view.dom.isContentEditable;
        };

        let isPointerDownAndOver = false;

        const maybeUpdateStyle = () => {
            if (isPointerDownAndOver && !isInert()) {
                dom.classList.add(linkPressedClassName);
            } else {
                dom.classList.remove(linkPressedClassName);
            }
        };

        dom.addEventListener("click", event => {
            const isOpenLinkInSeparateTabEvent = isOpenLinkInSeparateTabPointerEvent(
                event,
                getClientInfo(),
            );

            // Ignore non-left clicks (e.g. right clicks) and ignore clicks with a keyboard
            // modifier. Unless the click was meant to open the link in a separate tab. We need
            // to implement that manually here given the text is editable.
            if (
                (event.button !== 0 || isModifiedPointerEvent(event)) &&
                !isOpenLinkInSeparateTabEvent
            ) {
                return;
            }

            // Must call prevent default here in addition to `pointerdown` to stop mobile
            // WebKit from following a link after click.
            event.preventDefault();
        });

        dom.addEventListener("pointerdown", event => {
            isPointerDownAndOver =
                event.button === 0 &&
                (!isModifiedPointerEvent(event) ||
                    isOpenLinkInSeparateTabPointerEvent(event, getClientInfo()));

            maybeUpdateStyle();

            // If the user interacts with the link, don't open a floater after a delay.
            pointerEnterDelayTimeout?.clear();
            pointerEnterDelayTimeout = null;

            if (isInert()) return;

            // Ignore non-left clicks (e.g. right clicks) and ignore clicks with a keyboard
            // modifier. Unless the click was meant to open the link in a separate tab. We need
            // to implement that manually here given the text is editable.
            if (
                (event.button !== 0 || isModifiedPointerEvent(event)) &&
                !isOpenLinkInSeparateTabPointerEvent(event, getClientInfo())
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
            maybeUpdateStyle();

            if (isInert()) return;

            // Only process pointer up events that started on our element.
            if (!wasPointerDownAndOver) return;

            handleContentLinkClick(event, dom.href, onNavigate);
        });

        let pointerEnterDelayTimeout: Timeout | null = null;

        dom.addEventListener("pointerenter", event => {
            pointerEnterDelayTimeout?.clear();
            pointerEnterDelayTimeout = null;

            if (isInert()) return;

            const posResult = view.posAtCoords({left: event.clientX, top: event.clientY});
            if (!posResult) return;

            const $pos = view.state.doc.resolve(posResult.pos);

            // We do this form instead of `$pos.node()` to find the inline text node the mark
            // is on.
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

            // We check `event.buttons` since it tells us if the pointer was down prior to
            // entering the link. The `pointerdown` won't tell us if the user started pressing
            // on one element then dragged over our link (which the user does when making a
            // selection).
            //
            // https://developer.mozilla.org/en-US/docs/Web/API/MouseEvent/buttons
            const isPointerDown = event.buttons !== 0;

            pointerEnterDelayTimeout = createTimeout(() => {
                // If the node was removed from the DOM, don't proceed with the timeout. We don't
                // get a destroy callback for the mark so we have to be defensive here.
                if (!document.body.contains(dom)) return;

                onPointerEnterAfterDelay({
                    mark,
                    range: {
                        from: $pos.posAtIndex(index),
                        to: $pos.posAtIndex(index + 1),
                    },
                    wasPointerDown: isPointerDown,
                });
            }, tooltipDelayMs);
        });

        dom.addEventListener("pointerleave", () => {
            isPointerDownAndOver = false;
            maybeUpdateStyle();

            pointerEnterDelayTimeout?.clear();
            pointerEnterDelayTimeout = null;

            if (isInert()) return;

            onPointerLeave(mark);
        });

        dom.addEventListener("pointercancel", () => {
            isPointerDownAndOver = false;
            maybeUpdateStyle();

            pointerEnterDelayTimeout?.clear();
            pointerEnterDelayTimeout = null;
        });

        dom.addEventListener("dragstart", () => {
            isPointerDownAndOver = false;
            maybeUpdateStyle();

            pointerEnterDelayTimeout?.clear();
            pointerEnterDelayTimeout = null;
        });

        addParentScrollWhenPointerDownAndOverListener(dom, () => {
            isPointerDownAndOver = false;
            maybeUpdateStyle();

            pointerEnterDelayTimeout?.clear();
            pointerEnterDelayTimeout = null;
        });

        return {
            dom,
            contentDOM: contentDom,
        };
    };
}
