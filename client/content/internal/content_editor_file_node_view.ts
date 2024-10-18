import {NodeSelection} from "prosemirror-state";
import {EditorView, NodeViewConstructor} from "prosemirror-view";
import {MutableRefObject} from "react";
import {
    ContentEditorReferencesSetFileSignedUrlSearchAction,
    getContentEditorReferences,
    rememberContentEditorPosWhileLoading,
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
import {NativeMobileBridge} from "~/client/remix/native_mobile_bridge.js";
import {
    getIsMobileWithoutListening,
    subscribeToIsMobileChange,
} from "~/client/remix/use_is_mobile.js";
import {NavigateFunction} from "~/client/remix/use_navigate.js";
import {contentStyles} from "~/client/styles/styles.js";
import {FileAttachmentTarget} from "~/shared/files/file_attachment_target.js";
import {FileModel} from "~/shared/files/file_model.js";
import {scheduleMacrotask} from "~/shared/helpers/async/schedule_macrotask.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.js";
import {EventEmitter} from "~/shared/helpers/control/event_emitter.js";
import {HtmlElementGenerator} from "~/shared/helpers/html/html_generator.js";
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

let scheduledFileSignedUrlRefreshActionsByView:
    | WeakMap<EditorView, Array<ContentEditorReferencesSetFileSignedUrlSearchAction>>
    | undefined;

export function createContentEditorFileNodeViewConstructor({
    rootNavigate,
    getLayoutScreenWidth,
    getContext,
    getSpaceId,
    getAttachmentTarget,
    getExpirationTimers,
    subscribeToReferencesUpdate,
    isOurEditorUploading,
    draggingFileRef,
}: {
    rootNavigate: NavigateFunction;
    getLayoutScreenWidth: () => number;
    getContext: () => AppContext;
    getSpaceId: () => SpaceId;
    getAttachmentTarget: () => FileAttachmentTarget;
    getExpirationTimers: () => ContentFilePreviewExpirationTimers;
    subscribeToReferencesUpdate: (listener: () => void) => () => void;
    isOurEditorUploading: (fileId: FileId) => boolean;
    draggingFileRef: MutableRefObject<{getPos: () => number | null} | null>;
}): NodeViewConstructor {
    return (node, view, getPos) => {
        let dom: HTMLElement;

        let isDestroyed = false;
        let lastLayout: ContentFileLayout | undefined | null = null;
        let lastFileReference: {signedUrlSearch: string; file: FileModel} | undefined | null = null;
        let lastHtml: HtmlElementGenerator | null = null;
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
                screenWidth: getLayoutScreenWidth(),
                isMobile,
            });

            // Layout will update when `node` and `fileReference.file` update. So we don't
            // need to also check if `node` changed.
            //
            // We do need to check if `fileReference` changed since if
            // `fileReference.signedUrlSearch` changes we need to re-render the file with
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

                if (dom === undefined) {
                    const nextHtml = htmlStore.getSnapshot();
                    dom = nextHtml.generateNode();
                    lastHtml = nextHtml;
                } else {
                    const nextHtml = htmlStore.getSnapshot();
                    assert(nextHtml.patchNode(lastHtml, dom));
                    lastHtml = nextHtml;
                }

                const unsubscribeFromStore = htmlStore.subscribe(() => {
                    const nextHtml = htmlStore.getSnapshot();
                    assert(nextHtml.patchNode(lastHtml, assertExists(dom)));
                    lastHtml = nextHtml;
                });

                const cleanupBehavior = addContentFilePreviewBehavior(getContext, dom, {
                    spaceId,
                    node,
                    reference: fileReference,
                    attachmentTarget: getAttachmentTarget(),
                    expirationTimers: getExpirationTimers(),
                    isInert: false,
                    // If we're currently uploading this `FileId` then disable polling.
                    // `FileUploadService` will push us updates immediately when they're available.
                    isOurEditorUploading,
                    isEditorInitialAppRender: false,
                    rootNavigate,
                    onUpdate: (file, signedUrlSearch) => {
                        view.dispatch(
                            updateContentEditorReferences(view.state.tr, {
                                type: "SetFile",
                                file,
                                signedUrlSearch,
                            }),
                        );
                    },
                    onSignedUrlRefresh: (fileId, signedUrlSearch) => {
                        // Wait a macrotask to collect all updated URLs and update the view with one
                        // bulk transaction. Often we'll need to refresh all preview URLs in the
                        // document at once because we generated their signed URLs at the same time.
                        const scheduledFileSignedUrlRefreshActions = getOrSetDefaultMapValue(
                            (scheduledFileSignedUrlRefreshActionsByView ??= new WeakMap()),
                            view,
                            () => {
                                const actions: Array<ContentEditorReferencesSetFileSignedUrlSearchAction> =
                                    [];

                                scheduleMacrotask(() => {
                                    scheduledFileSignedUrlRefreshActionsByView?.delete(view);
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

                        scheduledFileSignedUrlRefreshActions.push({
                            type: "SetFileSignedUrlSearch",
                            fileId,
                            signedUrlSearch,
                        });
                    },
                    onShiftMouseDown: event => {
                        event.preventDefault();

                        view.dispatch(
                            view.state.tr.setSelection(
                                new NodeSelection(view.state.doc.resolve(getPos())),
                            ),
                        );

                        if (!view.hasFocus()) view.focus();
                    },
                    onLongPress: () => {
                        dom.classList.add(contentStyles.longPressedFileClassName);

                        view.dispatch(
                            view.state.tr.setSelection(
                                new NodeSelection(view.state.doc.resolve(getPos())),
                            ),
                        );

                        if (!view.hasFocus()) view.focus();

                        NativeMobileBridge?.haptic.playMediumImpact();
                    },
                    onDrag: dragPromise => {
                        const ourDraggingFile = rememberContentEditorPosWhileLoading(
                            view,
                            getPos(),
                            dragPromise,
                        );

                        draggingFileRef.current = ourDraggingFile;

                        void dragPromise.finally(() => {
                            if (draggingFileRef.current === ourDraggingFile)
                                draggingFileRef.current = null;
                        });
                    },
                });

                cleanup = () => {
                    unsubscribeFromStore();
                    cleanupBehavior();
                };
            }

            return dom;
        };

        dom = update();

        dom.addEventListener("contextmenu", () => {
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
        });

        const unsubscribeFromIsMobileChange = subscribeToIsMobileChange(update);
        const unsubscribeFromReferencesUpdate = subscribeToReferencesUpdate(update);

        const unsubscribeFromUpdatedContentEditorFileParent = getOrSetDefaultMapValue(
            (updatedContentEditorFileParentEventEmitterByElement ??= new WeakMap()),
            dom,
            () => new EventEmitter(),
        ).subscribe(update);

        return {
            dom,
            update: newNode => {
                if (node.type !== newNode.type) return false;

                // Completely re-create the file node view if the `FileId` changes. Instead of
                // patching. Patching may show the old file URL for a second before the new one
                // loads.
                if (node.attrs.fileId !== newNode.attrs.fileId) return false;

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
