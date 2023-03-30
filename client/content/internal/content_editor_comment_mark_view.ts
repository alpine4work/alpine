import {DOMSerializer, Mark} from "prosemirror-model";
import {EditorView} from "prosemirror-view";
import {assert} from "~/shared/helpers/control/assert";
import {getOrSetDefaultMapValue} from "~/shared/helpers/map/get_or_set_default_map_value";
import {DocumentCommentThreadId} from "~/shared/id/types/id_types";
import {contentSchemaStyles} from "~/shared/styles/styles";

const stateByCommentThreadIdByEditorView = new WeakMap<
    EditorView,
    Map<
        DocumentCommentThreadId,
        {
            isHovered: boolean;
            changeListeners: Set<() => void>;
        }
    >
>();

/**
 * We have a custom mark view for comments so that hovering a comment mark
 * highlights every mark for that comment thread in the document.
 */
export function createContentEditorCommentMarkView(
    mark: Mark,
    view: EditorView,
    inline: boolean,
): {
    dom: HTMLElement;
    contentDOM?: HTMLElement;
} {
    const commentThreadId: DocumentCommentThreadId = mark.attrs.commentThreadId;

    const stateByCommentThreadId = getOrSetDefaultMapValue(
        stateByCommentThreadIdByEditorView,
        view,
        () => new Map(),
    );
    const state = getOrSetDefaultMapValue(stateByCommentThreadId, commentThreadId, () => ({
        isHovered: false,
        changeListeners: new Set<() => void>(),
    }));

    const {dom, contentDOM} = DOMSerializer.renderSpec(
        document,
        mark.type.spec.toDOM!(mark, inline),
    );

    assert(dom instanceof HTMLElement);

    if (state.isHovered) {
        dom.classList.add(contentSchemaStyles.hoveredCommentClassName);
    }

    const stateChangeListener = () => {
        // Cleanup change listeners for elements that have been removed from the DOM
        // lazily because mark views don't provide a destroy hook.
        if (!document.body.contains(dom)) {
            state.changeListeners.delete(stateChangeListener);
            return;
        }

        if (state.isHovered) {
            if (!dom.classList.contains(contentSchemaStyles.hoveredCommentClassName)) {
                dom.classList.add(contentSchemaStyles.hoveredCommentClassName);
            }
        } else {
            if (dom.classList.contains(contentSchemaStyles.hoveredCommentClassName)) {
                dom.classList.remove(contentSchemaStyles.hoveredCommentClassName);
            }
        }
    };

    state.changeListeners.add(stateChangeListener);

    function isChildOfOurMarkWithoutIntermediateParentCommentMark(targetNode: Node) {
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

    const handleHoverEvent = (event: PointerEvent) => {
        const isHovered =
            event.type === "pointerover"
                ? event.target instanceof Node &&
                  isChildOfOurMarkWithoutIntermediateParentCommentMark(event.target)
                : event.relatedTarget instanceof Node &&
                  isChildOfOurMarkWithoutIntermediateParentCommentMark(event.relatedTarget);

        if (isHovered !== state.isHovered) {
            state.isHovered = isHovered;
            for (const changeListener of state.changeListeners) changeListener();
        }
    };

    dom.addEventListener("pointerover", handleHoverEvent);
    dom.addEventListener("pointerout", handleHoverEvent);

    return {
        dom,
        contentDOM,
    };
}
