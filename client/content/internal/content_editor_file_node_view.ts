import {NodeSelection} from "prosemirror-state";
import {EditorView, NodeViewConstructor} from "prosemirror-view";
import {
    ContentEditorReferencesSetFilePreviewUrlSearchAction,
    getContentEditorReferences,
    updateContentEditorReferences,
} from "~/client/content/content_editor_state.js";
import {withDisableContentEditorFileToolbarInitialAnimation} from "~/client/content/internal/content_editor_file_toolbar.js";
import {layoutContentFile} from "~/client/content/internal/content_file_layout.js";
import {ContentFileLayout} from "~/client/content/internal/content_file_layout_computations.js";
import {
    ContentFilePreviewExpirationTimers,
    addContentFilePreviewBehavior,
    renderContentFilePreview,
} from "~/client/content/internal/render_content_file_preview.js";
import {AppContext} from "~/client/context/app_context.js";
import {getClientInfo} from "~/client/remix/client_info_context.js";
import {
    getIsMobileWithoutListening,
    subscribeToIsMobileChange,
} from "~/client/remix/use_is_mobile.js";
import {FileAttachmentTarget} from "~/shared/files/file_attachment_target.js";
import {FileModel} from "~/shared/files/file_model.js";
import {scheduleMacrotask} from "~/shared/helpers/async/schedule_macrotask.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.js";
import {EventEmitter} from "~/shared/helpers/control/event_emitter.js";
import {getOrSetDefaultMapValue} from "~/shared/helpers/map/get_or_set_default_map_value.js";
import {FileId, SpaceId} from "~/shared/id/types/id_types.js";
import {computeStore} from "~/shared/store/compute_store.js";

let updatedContentEditorFileParentEventEmitterByElement: WeakMap<Element, EventEmitter> | undefined;

/**
 * When a file parent node view updates (`fileRow` or `fileFloat`) it calls
 * this function so its children may also update if necessary.
 */
export function dispatchUpdatedContentEditorFileParentEvent(element: Element) {
    updatedContentEditorFileParentEventEmitterByElement?.get(element)?.emit();
}

let scheduledFilePreviewUrlSearchRefreshActionsByView:
    | WeakMap<EditorView, Array<ContentEditorReferencesSetFilePreviewUrlSearchAction>>
    | undefined;

export function createContentEditorFileNodeViewConstructor({
    getContext,
    getSpaceId,
    getAttachmentTarget,
    getExpirationTimers,
    subscribeToReferencesUpdate,
    isOurEditorUploading,
}: {
    getContext: () => AppContext;
    getSpaceId: () => SpaceId;
    getAttachmentTarget: () => FileAttachmentTarget;
    getExpirationTimers: () => ContentFilePreviewExpirationTimers;
    subscribeToReferencesUpdate: (listener: () => void) => () => void;
    isOurEditorUploading: (fileId: FileId) => boolean;
}): NodeViewConstructor {
    return (node, view, getPos) => {
        let dom = null as HTMLElement | null;

        let isDestroyed = false;
        let lastLayout: ContentFileLayout | undefined | null = null;
        let lastFileReference:
            | {previewUrlSearch: string | null; file: FileModel}
            | undefined
            | null = null;
        let cleanup: (() => void) | null = null;

        const update = () => {
            assert(!isDestroyed);

            const isMobile = getIsMobileWithoutListening();
            const {references} = getContentEditorReferences(view.state);

            const spaceId = getSpaceId();
            const fileId: FileId | null = node.attrs.fileId;
            const fileReference = fileId
                ? getContentEditorReferences(view.state).references.fileById.get(fileId)
                : undefined;

            const layout = layoutContentFile(references, view.state.doc, getPos(), node, {
                screenWidth: getClientInfo().screenWidth,
                isMobile,
            });

            // Layout will update when `node` and `fileReference.file` update. So we don't
            // need to also check if `node` changed.
            //
            // We do need to check if `fileReference` changed since if
            // `fileReference.previewUrlSearch` changes we need to re-render the file with
            // the new URL.
            if (lastLayout !== layout || lastFileReference !== fileReference) {
                lastLayout = layout;
                lastFileReference = fileReference;

                cleanup?.();
                cleanup = null;

                const htmlStore = computeStore(get =>
                    renderContentFilePreview(get, {
                        spaceId,
                        node,
                        reference: fileReference,
                        layout,
                        expirationTimers: getExpirationTimers(),
                    }),
                );

                if (dom === null) {
                    dom = htmlStore.getSnapshot().generateNode();
                } else {
                    assert(htmlStore.getSnapshot().patchNode(dom));
                }

                const unsubscribeFromStore = htmlStore.subscribe(() => {
                    assert(htmlStore.getSnapshot().patchNode(assertExists(dom)));
                });

                const cleanupBehavior = addContentFilePreviewBehavior(getContext, dom, {
                    spaceId,
                    node,
                    reference: fileReference,
                    attachmentTarget: getAttachmentTarget(),
                    expirationTimers: getExpirationTimers(),
                    // If we're currently uploading this `FileId` then disable polling.
                    // `FileUploadService` will push us updates immediately when they're available.
                    isOurEditorUploading,
                    onUpdate: (file, previewUrlSearch) => {
                        view.dispatch(
                            updateContentEditorReferences(view.state.tr, {
                                type: "SetFile",
                                file,
                                previewUrlSearch,
                            }),
                        );
                    },
                    onPreviewUrlSearchRefresh: (fileId, previewUrlSearch) => {
                        // Wait a macrotask to collect all updated URLs and update the view with one
                        // bulk transaction. Often we'll need to refresh all preview URLs in the
                        // document at once because we generated their signed URLs at the same time.
                        const scheduledFilePreviewUrlSearchRefreshActions = getOrSetDefaultMapValue(
                            (scheduledFilePreviewUrlSearchRefreshActionsByView ??= new WeakMap()),
                            view,
                            () => {
                                const actions: Array<ContentEditorReferencesSetFilePreviewUrlSearchAction> =
                                    [];

                                scheduleMacrotask(() => {
                                    scheduledFilePreviewUrlSearchRefreshActionsByView?.delete(view);
                                    if (view.isDestroyed) return;

                                    view.dispatch(
                                        actions.reduce(
                                            updateContentEditorReferences,
                                            view.state.tr,
                                        ),
                                    );
                                });

                                return actions;
                            },
                        );

                        scheduledFilePreviewUrlSearchRefreshActions.push({
                            type: "SetFilePreviewUrlSearch",
                            fileId,
                            previewUrlSearch,
                        });
                    },
                });

                cleanup = () => {
                    unsubscribeFromStore();
                    cleanupBehavior();
                };
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

                cleanup?.();
                cleanup = null;

                unsubscribeFromIsMobileChange();
                unsubscribeFromReferencesUpdate();
                unsubscribeFromUpdatedContentEditorFileParent();
            },
        };
    };
}
