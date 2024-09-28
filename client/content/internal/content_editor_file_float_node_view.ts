import {DOMSerializer} from "prosemirror-model";
import {NodeView, NodeViewConstructor} from "prosemirror-view";
import {getContentEditorReferences} from "~/client/content/content_editor_state.js";
import {dispatchUpdatedContentEditorFileParentEvent} from "~/client/content/internal/content_editor_file_node_view.js";
import {layoutContentFileParent} from "~/client/content/internal/content_file_layout.js";
import {ContentFileLayout} from "~/client/content/internal/content_file_layout_computations.js";
import {getClientInfo} from "~/client/remix/client_info_context.js";
import {
    getIsMobileWithoutListening,
    subscribeToIsMobileChange,
} from "~/client/remix/use_is_mobile.js";
import {fileFloatLeftClassName, fileFloatRightClassName} from "~/shared/content/content_styles.js";
import {assert} from "~/shared/helpers/control/assert.js";

export function createContentEditorFileFloatNodeViewConstructor({
    subscribeToReferencesUpdate,
}: {
    subscribeToReferencesUpdate: (listener: () => void) => () => void;
}): NodeViewConstructor {
    return (node, view): NodeView => {
        const {dom, contentDOM: contentDom} = DOMSerializer.renderSpec(
            document,
            node.type.spec.toDOM!(node),
        );

        assert(dom instanceof HTMLElement);

        // Make sure the browser doesn't think it's allowed to select or edit inside a
        // file float.
        dom.contentEditable = "false";

        let isDestroyed = false;
        let lastDirection: "left" | "right" | null = null;
        let lastLayouts: ReadonlyArray<ContentFileLayout> | null = null;

        const update = () => {
            assert(!isDestroyed);

            const isMobile = getIsMobileWithoutListening();
            const {references} = getContentEditorReferences(view.state);

            const direction = node.attrs.direction;

            // Swap CSS classes if direction changes.
            if (lastDirection !== direction) {
                lastDirection = direction;

                if (direction === "left") {
                    dom.classList.remove(fileFloatRightClassName);
                    dom.classList.add(fileFloatLeftClassName);
                } else if (direction === "right") {
                    dom.classList.remove(fileFloatLeftClassName);
                    dom.classList.add(fileFloatRightClassName);
                }
            }

            const layouts = layoutContentFileParent(references, node, {
                screenWidth: getClientInfo().screenWidth,
                isMobile,
            });

            if (lastLayouts !== layouts) {
                lastLayouts = layouts;

                dom.style.width = `${layouts[0]!.width}px`;
                dom.style.height = `${layouts[0]!.height}px`;
            }
        };

        update();

        const unsubscribeFromIsMobileChange = subscribeToIsMobileChange(update);
        const unsubscribeFromReferencesUpdate = subscribeToReferencesUpdate(update);

        return {
            dom,
            contentDOM: contentDom,
            update: newNode => {
                if (node.type !== newNode.type) return false;

                node = newNode;
                update();

                for (const childNode of dom.childNodes) {
                    if (childNode instanceof Element) {
                        dispatchUpdatedContentEditorFileParentEvent(childNode);
                    }
                }

                return true;
            },
            destroy: () => {
                if (isDestroyed) return;
                isDestroyed = true;

                unsubscribeFromIsMobileChange();
                unsubscribeFromReferencesUpdate();
            },
        };
    };
}
