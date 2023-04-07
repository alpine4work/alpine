import {DOMSerializer} from "prosemirror-model";
import {MarkViewConstructor} from "prosemirror-view";
import {isModifiedPointerEvent} from "~/client/helpers/events/is_modified_pointer_event";
import {UnimplementedError} from "~/shared/error/error";
import {assert} from "~/shared/helpers/control/assert";
import {DocumentCommentThreadId} from "~/shared/id/types/id_types";
import {contentSchemaStyles} from "~/shared/styles/styles";

export function createContentEditorCommentMarkViewConstructor({}: {}): MarkViewConstructor {
    return (mark, view, inline) => {
        const commentThreadId: DocumentCommentThreadId = mark.attrs.commentThreadId;

        const {dom, contentDOM} = DOMSerializer.renderSpec(
            document,
            mark.type.spec.toDOM!(mark, inline),
        );

        assert(dom instanceof HTMLElement);

        function isChildOfOurCommentMarkWithoutOverridingParentCommentMark(targetNode: Node) {
            let node: Node | null = targetNode;
            while (node !== null) {
                if (node === dom) return true;

                if (
                    node instanceof HTMLElement &&
                    node.classList.contains(contentSchemaStyles.commentClassName)
                ) {
                    return false;
                }

                node = node.parentNode;
            }
            return false;
        }

        let isPointerDownAndOver = false;
        let isNavigationPending = false;

        dom.addEventListener("pointerdown", event => {
            // If we have overlapping comment marks only one should activate.
            if (
                !(event.target instanceof Node) ||
                !isChildOfOurCommentMarkWithoutOverridingParentCommentMark(event.target)
            ) {
                return;
            }

            isPointerDownAndOver = true;
        });

        dom.addEventListener("pointerup", event => {
            const wasPointerDownAndOver = isPointerDownAndOver;
            isPointerDownAndOver = false;

            // Only process pointer up events that started on our element.
            if (!wasPointerDownAndOver) return;

            // Ignore non-left clicks (e.g. right clicks) and ignore clicks with a keyboard
            // modifier. Unless the click was meant to open the link in a separate tab. We
            // need to implement that manually here given the text is editable.
            if (event.button !== 0 || isModifiedPointerEvent(event)) {
                return;
            }

            // If we have overlapping comment marks only one should activate.
            if (
                !(event.target instanceof Node) ||
                !isChildOfOurCommentMarkWithoutOverridingParentCommentMark(event.target)
            ) {
                return;
            }

            // If we are currently navigating, don't navigate again...
            if (!isNavigationPending) {
                throw new UnimplementedError("TODO");
            }
        });

        dom.addEventListener("pointerleave", () => {
            isPointerDownAndOver = false;
        });

        return {
            dom,
            contentDOM,
        };
    };
}
