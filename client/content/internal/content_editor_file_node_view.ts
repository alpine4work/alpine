import {NodeViewConstructor} from "prosemirror-view";
import {getContentEditorReferences} from "~/client/content/content_editor_state.js";
import {renderContentFilePreview} from "~/client/content/internal/render_content_file_preview.js";
import {FileModel} from "~/shared/files/file_model.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {FileId} from "~/shared/id/types/id_types.js";

export function createContentEditorFileNodeViewConstructor({
    subscribeToReferencesUpdate,
}: {
    subscribeToReferencesUpdate: (listener: () => void) => () => void;
}): NodeViewConstructor {
    return (node, view) => {
        let dom = null as HTMLElement | null;

        let isDestroyed = false;
        let lastFile: FileModel | undefined | null = null;

        const update = () => {
            const fileId: FileId | null = node.attrs.id;
            const file = fileId
                ? getContentEditorReferences(view.state).references.fileById.get(fileId)
                : undefined;

            if (file === lastFile) return;
            lastFile = file;

            const html = renderContentFilePreview(node, file);

            if (dom === null) {
                dom = html.generateNode();
            } else {
                assert(html.patchNode(dom));
            }
        };

        update();
        assert(dom);

        const handlePointerDown = (event: PointerEvent) => {
            // The browser default behavior when clicking on a file is to move focus to the
            // nearest position in the document's text. Don't do this.
            //
            // TODO(calebmer, #files): Should either select or open file viewer.
            event.preventDefault();
        };

        const unsubscribeFromReferencesUpdate = subscribeToReferencesUpdate(update);

        dom.addEventListener("pointerdown", handlePointerDown);

        return {
            dom,
            destroy: () => {
                if (isDestroyed) return;
                isDestroyed = true;

                unsubscribeFromReferencesUpdate();

                dom!.removeEventListener("pointerdown", handlePointerDown);
            },
        };
    };
}
