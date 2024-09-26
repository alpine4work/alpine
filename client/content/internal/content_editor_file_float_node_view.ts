import {DOMSerializer} from "prosemirror-model";
import {NodeView, NodeViewConstructor} from "prosemirror-view";
import {getContentEditorReferences} from "~/client/content/content_editor_state.js";
import {layoutContentFileFloat} from "~/client/content/internal/layout_content_file.js";
import {getClientInfo} from "~/client/remix/client_info_context.js";
import {
    getIsMobileWithoutListening,
    subscribeToIsMobileChange,
} from "~/client/remix/use_is_mobile.js";
import {fileFloatLeftClassName, fileFloatRightClassName} from "~/shared/content/content_styles.js";
import {FileModel} from "~/shared/files/file_model.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {FileId} from "~/shared/id/types/id_types.js";

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
        let lastIsMobile: boolean | null = null;
        let lastDirection: "left" | "right" | null = null;
        let lastFile: FileModel | null | "Uninitialized" = "Uninitialized";

        const update = () => {
            assert(!isDestroyed);

            const isMobile = getIsMobileWithoutListening();
            const references = getContentEditorReferences(view.state).references;

            const direction = node.attrs.direction;

            const childNode = node.content.content[0]!;
            assert(childNode.type.name === "file");
            const fileId: FileId | null = childNode.attrs.fileId;
            const file = fileId ? references.fileById.get(fileId)?.file ?? null : null;

            if (
                lastIsMobile === isMobile &&
                lastFile &&
                direction === lastDirection &&
                file === lastFile
            ) {
                return;
            }

            // Swap CSS classes if direction changes.
            if (direction !== lastDirection) {
                if (direction === "left") {
                    dom.classList.remove(fileFloatRightClassName);
                    dom.classList.add(fileFloatLeftClassName);
                } else if (direction === "right") {
                    dom.classList.remove(fileFloatLeftClassName);
                    dom.classList.add(fileFloatRightClassName);
                }
            }

            lastIsMobile = isMobile;
            lastDirection = direction;
            lastFile = file;

            const layout = layoutContentFileFloat(direction, file, {
                screenWidth: getClientInfo().screenWidth,
                isMobile,
            });

            dom.style.width = `${layout.width}px`;
            dom.style.height = `${layout.height}px`;
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
