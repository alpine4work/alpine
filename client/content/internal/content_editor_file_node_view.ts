import {NodeSelection} from "prosemirror-state";
import {NodeViewConstructor} from "prosemirror-view";
import {getContentEditorReferences} from "~/client/content/content_editor_state.js";
import {withDisableContentEditorFileToolbarInitialAnimation} from "~/client/content/internal/content_editor_file_toolbar.js";
import {layoutContentFile} from "~/client/content/internal/content_file_layout.js";
import {ContentFileLayout} from "~/client/content/internal/content_file_layout_computations.js";
import {renderContentFilePreview} from "~/client/content/internal/render_content_file_preview.js";
import {getClientInfo} from "~/client/remix/client_info_context.js";
import {
    getIsMobileWithoutListening,
    subscribeToIsMobileChange,
} from "~/client/remix/use_is_mobile.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {EventEmitter} from "~/shared/helpers/control/event_emitter.js";
import {getOrSetDefaultMapValue} from "~/shared/helpers/map/get_or_set_default_map_value.js";
import {FileId, SpaceId} from "~/shared/id/types/id_types.js";

let updatedContentEditorFileParentEventEmitterByElement: WeakMap<Element, EventEmitter> | undefined;

/**
 * When a file parent node view updates (`fileRow` or `fileFloat`) it calls
 * this function so its children may also update if necessary.
 */
export function dispatchUpdatedContentEditorFileParentEvent(element: Element) {
    updatedContentEditorFileParentEventEmitterByElement?.get(element)?.emit();
}

export function createContentEditorFileNodeViewConstructor({
    getSpaceId,
    subscribeToReferencesUpdate,
}: {
    getSpaceId: () => SpaceId;
    subscribeToReferencesUpdate: (listener: () => void) => () => void;
}): NodeViewConstructor {
    return (node, view, getPos) => {
        let dom = null as HTMLElement | null;

        let isDestroyed = false;
        let lastLayout: ContentFileLayout | undefined | null = null;

        const update = () => {
            assert(!isDestroyed);

            const isMobile = getIsMobileWithoutListening();
            const {references} = getContentEditorReferences(view.state);

            const layout = layoutContentFile(references, view.state.doc, getPos(), node, {
                screenWidth: getClientInfo().screenWidth,
                isMobile,
            });

            // Layout will update when `node` and `fileReference.file` update. So we don't
            // need to also check if `node` and `fileReference.file` changed.
            if (lastLayout !== layout) {
                lastLayout = layout;

                const fileId: FileId | null = node.attrs.fileId;
                const fileReference = fileId
                    ? getContentEditorReferences(view.state).references.fileById.get(fileId)
                    : undefined;

                const html = renderContentFilePreview(getSpaceId(), node, fileReference, layout);

                if (dom === null) {
                    dom = html.generateNode();
                } else {
                    assert(html.patchNode(dom));
                }
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

        const unsubscribeFromIsMobileChange = subscribeToIsMobileChange(update);
        const unsubscribeFromReferencesUpdate = subscribeToReferencesUpdate(update);

        const unsubscribeFromUpdatedContentEditorFileParent = getOrSetDefaultMapValue(
            (updatedContentEditorFileParentEventEmitterByElement ??= new WeakMap()),
            dom,
            () => new EventEmitter(),
        ).subscribe(update);

        dom.addEventListener("pointerdown", handlePointerDown);
        dom.addEventListener("contextmenu", handleContextMenu);

        return {
            dom,
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
                unsubscribeFromUpdatedContentEditorFileParent();
            },
        };
    };
}
