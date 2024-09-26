import {DOMSerializer} from "prosemirror-model";
import {NodeView, NodeViewConstructor} from "prosemirror-view";
import {getContentEditorReferences} from "~/client/content/content_editor_state.js";
import {layoutContentFileRow} from "~/client/content/internal/layout_content_file.js";
import {getClientInfo} from "~/client/remix/client_info_context.js";
import {
    getIsMobileWithoutListening,
    subscribeToIsMobileChange,
} from "~/client/remix/use_is_mobile.js";
import {FileModel} from "~/shared/files/file_model.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {isShallowEqual} from "~/shared/helpers/control/is_shallow_equal.js";
import {FileId} from "~/shared/id/types/id_types.js";

export function createContentEditorFileRowNodeViewConstructor({
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
        // file row.
        dom.contentEditable = "false";

        let isDestroyed = false;
        let lastIsMobile: boolean | null = null;
        let lastFiles: Array<FileModel | null> | null = null;

        const update = () => {
            assert(!isDestroyed);

            const isMobile = getIsMobileWithoutListening();
            const references = getContentEditorReferences(view.state).references;

            const files = node.content.content.map(childNode => {
                assert(childNode.type.name === "file");
                const fileId: FileId | null = childNode.attrs.fileId;
                if (!fileId) return null;
                return references.fileById.get(fileId)?.file ?? null;
            });

            if (lastIsMobile === isMobile && lastFiles && isShallowEqual(files, lastFiles)) return;

            lastIsMobile = isMobile;
            lastFiles = files;

            const layout = layoutContentFileRow(files, {
                screenWidth: getClientInfo().screenWidth,
                isMobile,
            });

            dom.style.height = `${Math.max(...layout.map(({height}) => height))}px`;
            dom.style.gridTemplateColumns = layout.map(({widthFr}) => `${widthFr}fr`).join(" ");
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
