import {DOMSerializer} from "prosemirror-model";
import {MarkViewConstructor} from "prosemirror-view";
import {isModifiedPointerEvent} from "~/client/helpers/events/is_modified_pointer_event.js";
import {scheduleAfterNextBrowserPaint} from "~/shared/helpers/async/schedule_after_next_browser_paint.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {DocumentCommentThreadId} from "~/shared/id/types/id_types.js";
import {contentSchemaStyles} from "~/shared/styles/styles.js";

export function createContentEditorCommentMarkViewConstructor({
    openCommentThread,
    onCommentThreadPressedChange,
}: {
    openCommentThread: (commentThreadId: DocumentCommentThreadId) => Promise<void>;
    onCommentThreadPressedChange: (
        commentThreadId: DocumentCommentThreadId,
        isHovered: boolean,
    ) => void;
}): MarkViewConstructor {
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
                    node.classList.contains(contentSchemaStyles.commentClassName) &&
                    node.dataset.comment
                ) {
                    return false;
                }

                node = node.parentNode;
            }
            return false;
        }

        let isPointerDownAndOver = false;
        let isNavigationPending = false;
        let isPressed = false;

        const maybeUpdatePressed = () => {
            const wasPressed = isPressed;
            isPressed = isPointerDownAndOver || isNavigationPending;

            // Our parent component is responsible for changing the styling on all comment
            // marks with this `DocumentCommentThreadId`.
            //
            // We also have to be careful when mutating a mark's DOM element because
            // ProseMirror will pick up the mutation and try to interpret it as a state
            // change. For unknown changes it completely destroys and recreates the mark's
            // DOM node. Because of this we can't maintain state in a mark view or the
            // mark's DOM node.
            if (wasPressed !== isPressed) {
                // Schedule calling our callback a browser paint after the event which changes
                // our comment style. Otherwise I'm seeing a bug where clicking on a comment
                // jumps your cursor to the beginning of the document. Unclear why precisely
                // that happens. Maybe something to do with the new CSS?
                const expectPressed = isPressed;
                scheduleAfterNextBrowserPaint(() => {
                    if (expectPressed !== isPressed) return;
                    onCommentThreadPressedChange(commentThreadId, isPressed);
                });
            }
        };

        dom.addEventListener("pointerdown", event => {
            // If we have overlapping comment marks only one should activate.
            if (
                !(event.target instanceof Node) ||
                !isChildOfOurCommentMarkWithoutOverridingParentCommentMark(event.target)
            ) {
                return;
            }

            isPointerDownAndOver = true;

            maybeUpdatePressed();
        });

        dom.addEventListener("pointerup", event => {
            const wasPointerDownAndOver = isPointerDownAndOver;
            isPointerDownAndOver = false;

            // Only process pointer up events that started on our element.
            if (!wasPointerDownAndOver) {
                maybeUpdatePressed();
                return;
            }

            // Ignore non-left clicks (e.g. right clicks) and ignore clicks with a keyboard
            // modifier. Unless the click was meant to open the link in a separate tab. We
            // need to implement that manually here given the text is editable.
            if (event.button !== 0 || isModifiedPointerEvent(event)) {
                maybeUpdatePressed();
                return;
            }

            // If we have overlapping comment marks only one should activate.
            if (
                !(event.target instanceof Node) ||
                !isChildOfOurCommentMarkWithoutOverridingParentCommentMark(event.target)
            ) {
                maybeUpdatePressed();
                return;
            }

            // If we are currently navigating, don't navigate again...
            if (!isNavigationPending) {
                // TODO(calebmer, #global-loading-indicator): Some kind of loading indicator
                // for navigation.
                const navigationPromise = openCommentThread(commentThreadId);

                isNavigationPending = true;
                navigationPromise.finally(() => {
                    isNavigationPending = false;
                    maybeUpdatePressed();
                });
            }

            maybeUpdatePressed();
        });

        dom.addEventListener("pointerleave", () => {
            isPointerDownAndOver = false;

            maybeUpdatePressed();
        });

        return {
            dom,
            contentDOM,
        };
    };
}
