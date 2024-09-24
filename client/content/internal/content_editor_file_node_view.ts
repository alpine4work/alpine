import {NodeSelection} from "prosemirror-state";
import {NodeViewConstructor} from "prosemirror-view";
import {getContentEditorReferences} from "~/client/content/content_editor_state.js";
import {withDisableContentEditorFileToolbarInitialAnimation} from "~/client/content/internal/content_editor_file_toolbar.js";
import {renderContentFilePreview} from "~/client/content/internal/render_content_file_preview.js";
import {FileModel} from "~/shared/files/file_model.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {FileId} from "~/shared/id/types/id_types.js";

export function createContentEditorFileNodeViewConstructor({
    subscribeToReferencesUpdate,
}: {
    subscribeToReferencesUpdate: (listener: () => void) => () => void;
}): NodeViewConstructor {
    return (node, view, getPos) => {
        let dom = null as HTMLElement | null;

        let isDestroyed = false;
        let lastFile: FileModel | undefined | null = null;

        const update = () => {
            const fileId: FileId | null = node.attrs.fileId;
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

        // TODO(calebmer, #files): Long press should also select file instead of
        // opening file viewer.
        const handlePointerDown = (event: PointerEvent) => {
            // The browser default behavior when clicking on a file is to move focus to the
            // nearest position in the document's text. Don't do this.
            //
            // TODO(calebmer, #files): Should open file viewer.
            event.preventDefault();

            // If the mouse performs a shift or alt click then we select the node instead
            // of opening the file viewer. This interaction is not obvious. You can also
            // use keyboard shortcuts or right click to select a file. The user should be
            // able to figure out one of these three methods.
            if (event.pointerType === "mouse" && (event.altKey || event.shiftKey)) {
                view.dispatch(
                    view.state.tr.setSelection(new NodeSelection(view.state.doc.resolve(getPos()))),
                );

                if (!view.hasFocus()) view.focus();
            }
        };

        const handleContextMenu = () => {
            // Make sure `<ContentEditorFileToolbar>` doesn't animate in then immediately
            // animate out. Since by setting selection here we'll render
            // `<ContentEditorFileToolbar>`. Then once this event finishes processing
            // `contextmenu` will update `useIsContextMenuOpen()`. Without this function
            // this causes the toolbar to animate in/out on mount which looks broken.
            //
            // This relies on the fact that `view.dispatch()` performs its update with
            // `flushSync()`.
            withDisableContentEditorFileToolbarInitialAnimation(() => {
                // Right-clicking on a file selects the file. This is another way to access
                // file selection tools.
                view.dispatch(
                    view.state.tr.setSelection(new NodeSelection(view.state.doc.resolve(getPos()))),
                );

                if (!view.hasFocus()) view.focus();
            });
        };

        const unsubscribeFromReferencesUpdate = subscribeToReferencesUpdate(update);

        dom.addEventListener("pointerdown", handlePointerDown);
        dom.addEventListener("contextmenu", handleContextMenu);

        return {
            dom,
            destroy: () => {
                if (isDestroyed) return;
                isDestroyed = true;

                unsubscribeFromReferencesUpdate();
            },
        };
    };
}
