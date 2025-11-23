import {DOMSerializer} from "prosemirror-model";
import {MarkViewConstructor} from "prosemirror-view";
import {addParentScrollWhenPointerDownAndOverListener} from "~/client/web/content/state/parent_scroll_when_pointer_down_and_over_event.js";
import {isModifiedPointerEvent} from "~/client/web/helpers/events/is_modified_pointer_event.js";
import {commentClassName, fileClassName} from "~/shared/design/core/constant_class_names.js";
import {RouteLayout} from "~/shared/design/core/route_layout.js";
import {scheduleAfterNextBrowserPaint} from "~/shared/helpers/async/schedule_after_next_browser_paint.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {DocumentCommentThreadId} from "~/shared/id/types/id_types.js";

export function createContentEditorCommentMarkViewConstructor({
    getRouteLayout,
    canPrimaryInputHover,
    openCommentThread,
    onCommentThreadPressedChange,
}: {
    getRouteLayout: () => RouteLayout;
    canPrimaryInputHover: () => boolean;
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

        const isInert = (): boolean => {
            if (canPrimaryInputHover()) return false;
            return view.dom.isContentEditable;
        };

        function isChildOfOurCommentMarkWithoutOverridingParentCommentMark(targetNode: Node) {
            let node: Node | null = targetNode;
            while (node !== null) {
                if (node === dom) return true;

                if (
                    node instanceof HTMLElement &&
                    node.classList.contains(commentClassName) &&
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

        // We need to call `event.preventDefault()` in `click` in addition to
        // `pointerdown` in case the browser has some default `click` handling.
        dom.addEventListener("click", event => {
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

            // If we're inert, pressing on the comment mark does nothing.
            if (isInert()) {
                return;
            }

            // In mobile layouts (e.g. mobile device or peek), prevent default since
            // clicking a comment opens the comment thread but does not select the text.
            // (Unless you hold shift.)
            if (getRouteLayout() === "narrow") {
                event.preventDefault();
            }
        });

        dom.addEventListener("pointerdown", event => {
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

            // If we're inert, pressing on the comment mark does nothing.
            if (isInert() || event.defaultPrevented) {
                return;
            }

            // If we're pressing on a file then the file press should open the file viewer.
            // It shouldn't open the comment thread.
            if (event.target instanceof Element && event.target.closest(`.${fileClassName}`)) {
                maybeUpdatePressed();
                return;
            }

            isPointerDownAndOver = true;

            maybeUpdatePressed();

            // In mobile layouts (e.g. mobile device or peek), prevent default since
            // clicking a comment opens the comment thread but does not select the text.
            // (Unless you hold shift.)
            if (getRouteLayout() === "narrow") {
                event.preventDefault();
            }
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

            // If we're inert (e.g. on mobile when the editor is focused), don't open the
            // comment thread when pressed.
            if (isInert()) {
                maybeUpdatePressed();
                return;
            }

            // If we are currently navigating, don't navigate again...
            if (!isNavigationPending) {
                const navigationPromise = openCommentThread(commentThreadId);

                isNavigationPending = true;
                void navigationPromise.finally(() => {
                    isNavigationPending = false;
                    maybeUpdatePressed();
                });
            }

            maybeUpdatePressed();

            // In mobile layouts (e.g. mobile device or peek), prevent default since
            // clicking a comment opens the comment thread but does not select the text.
            // (Unless you hold shift.)
            if (getRouteLayout() === "narrow") {
                event.preventDefault();
            }
        });

        dom.addEventListener("pointerleave", () => {
            isPointerDownAndOver = false;
            maybeUpdatePressed();
        });

        dom.addEventListener("pointercancel", () => {
            isPointerDownAndOver = false;
            maybeUpdatePressed();
        });

        dom.addEventListener("dragstart", () => {
            isPointerDownAndOver = false;
            maybeUpdatePressed();
        });

        addParentScrollWhenPointerDownAndOverListener(dom, () => {
            isPointerDownAndOver = false;
            maybeUpdatePressed();
        });

        return {
            dom,
            contentDOM,
        };
    };
}
