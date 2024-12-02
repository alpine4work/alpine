import {NodeSelection} from "prosemirror-state";
import {NodeViewConstructor} from "prosemirror-view";
import {MutableRefObject} from "react";
import {
    getContentEditorReferences,
    rememberContentEditorPosWhileLoading,
} from "~/client/content/content_editor_state.js";
import {getFileClientStore} from "~/client/content/file_client_store_context.js";
import {ContentEditorFileToolbarController} from "~/client/content/internal/content_editor_file_toolbar.js";
import {layoutContentFile} from "~/client/content/internal/content_file_layout.js";
import {
    addContentFilePreviewBehavior,
    renderContentFilePreview,
} from "~/client/content/internal/content_file_preview.js";
import {AppContext} from "~/client/context/app_context.js";
import {Reporter} from "~/client/design/reporter.js";
import {NativeMobileBridge} from "~/client/remix/native_mobile_bridge.js";
import {
    getPlatformWithoutListening,
    subscribeToPlatformChange,
} from "~/client/remix/platform_context.js";
import {
    getSpacingScaleWithoutListening,
    subscribeToSpacingScaleChange,
} from "~/client/remix/spacing_scale_context.js";
import {NavigateFunction} from "~/client/remix/use_navigate.js";
import {contentStyles} from "~/client/styles/styles.js";
import {FileAttachmentTarget} from "~/shared/files/file_attachment_target.js";
import {FileModel} from "~/shared/files/file_model.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {EventEmitter} from "~/shared/helpers/control/event_emitter.js";
import {HtmlElementGenerator} from "~/shared/helpers/html/html_generator.js";
import {getOrSetDefaultMapValue} from "~/shared/helpers/map/get_or_set_default_map_value.js";
import {FileId, SpaceId} from "~/shared/id/types/id_types.js";
import {undefinedStore} from "~/shared/store/const_store.js";

let updatedContentEditorFileParentEventEmitterByElement: WeakMap<Element, EventEmitter> | undefined;

/**
 * When a file parent node view updates (`fileRow` or `fileFloat`) it calls
 * this function so its children may also update if necessary.
 */
export function dispatchUpdatedContentEditorFileParentEvent(element: Element) {
    updatedContentEditorFileParentEventEmitterByElement?.get(element)?.emit();
}

export function createContentEditorFileNodeViewConstructor({
    rootNavigate,
    getLayoutScreenWidth,
    getContext,
    getSpaceId,
    getReporter,
    getAttachmentTarget,
    subscribeToReferencesUpdate,
    draggingFileRef,
}: {
    rootNavigate: NavigateFunction;
    getLayoutScreenWidth: () => number;
    getContext: () => AppContext;
    getSpaceId: () => SpaceId;
    getReporter: () => Reporter;
    getAttachmentTarget: () => FileAttachmentTarget;
    subscribeToReferencesUpdate: (listener: () => void) => () => void;
    draggingFileRef: MutableRefObject<{getPos: () => number | null} | null>;
}): NodeViewConstructor {
    return (node, view, getPos) => {
        let dom: HTMLElement;

        let isDestroyed = false;
        let lastFileReference: {signedUrlSearch: string; file: FileModel} | undefined | null = null;
        let lastHtml: HtmlElementGenerator | null = null;
        let cleanup: (() => void) | null = null;

        const updateFromState = () => {
            assert(!isDestroyed);

            const platform = getPlatformWithoutListening();
            const spacingScale = getSpacingScaleWithoutListening();
            const {references} = getContentEditorReferences(view.state);

            const spaceId = getSpaceId();
            const fileId: FileId | null = node.attrs.fileId;
            const fileReference = fileId ? references.fileById.get(fileId) : undefined;

            const screenWidth = getLayoutScreenWidth();

            // Layout will update when `node` and `fileReference.file` update. So we don't
            // need to also check if `node` changed.
            //
            // We do need to check if `fileReference` changed since if
            // `fileReference.signedUrlSearch` changes we need to re-render the file with
            // the new URL.
            if (lastFileReference !== fileReference) {
                lastFileReference = fileReference;

                const fileStore = fileReference
                    ? getFileClientStore(spaceId).getFileStore(fileReference)
                    : undefinedStore;

                cleanup?.();
                cleanup = null;

                let cleanupBehavior: (() => void) | null = null;

                const updateFromStore = () => {
                    cleanupBehavior?.();
                    cleanupBehavior = null;

                    const file = fileStore.getSnapshot();

                    const layout = layoutContentFile(file, view.state.doc, getPos(), node, {
                        screenWidth,
                        platform,
                        spacingScale,
                    });

                    const html = renderContentFilePreview({
                        spaceId,
                        node,
                        file,
                        layout,
                        screenWidth,
                        platform,
                        spacingScale,
                        isInitialAppRender: false,
                    });

                    if (dom === undefined) {
                        dom = html.generateNode();
                        lastHtml = html;
                    } else {
                        assert(html.patchNode(lastHtml, dom));
                        lastHtml = html;
                    }

                    cleanupBehavior = addContentFilePreviewBehavior(getContext, dom, {
                        spaceId,
                        node,
                        file,
                        attachmentTarget: getAttachmentTarget(),
                        isInitialAppRender: false,
                        rootNavigate,
                        getReporter,
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
                };

                const unsubscribeFromStore = fileStore.subscribe(updateFromStore);
                updateFromStore();

                cleanup = () => {
                    unsubscribeFromStore();
                    cleanupBehavior?.();
                    cleanupBehavior = null;
                };
            }

            return dom;
        };

        dom = updateFromState();

        dom.addEventListener("contextmenu", () => {
            // Make sure `<ContentEditorFileToolbar>` doesn't animate in then immediately
            // animate out. Since by setting selection here we'll render
            // `<ContentEditorFileToolbar>`. Then once this event finishes processing
            // `contextmenu` will update `useIsContextMenuOpen()`. Without this function
            // this causes the toolbar to animate in/out on mount which looks broken.
            //
            // This relies on the fact that `view.dispatch()` performs its update with
            // `flushSync()`.
            ContentEditorFileToolbarController.withDisableInitialAnimation(() => {
                // Right-clicking on a file selects the file. This is another way to access
                // file selection tools.
                view.dispatch(
                    view.state.tr.setSelection(new NodeSelection(view.state.doc.resolve(getPos()))),
                );

                if (!view.hasFocus()) view.focus();
            });
        });

        const unsubscribeFromPlatformChange = subscribeToPlatformChange(updateFromState);
        const unsubscribeFromSpacingScaleChange = subscribeToSpacingScaleChange(updateFromState);
        const unsubscribeFromReferencesUpdate = subscribeToReferencesUpdate(updateFromState);

        const unsubscribeFromUpdatedContentEditorFileParent = getOrSetDefaultMapValue(
            (updatedContentEditorFileParentEventEmitterByElement ??= new WeakMap()),
            dom,
            () => new EventEmitter(),
        ).subscribe(updateFromState);

        return {
            dom,
            update: newNode => {
                if (node.type !== newNode.type) return false;

                // Completely re-create the file node view if the `FileId` changes. Instead of
                // patching. Patching may show the old file URL for a second before the new one
                // loads.
                if (node.attrs.fileId !== newNode.attrs.fileId) return false;

                node = newNode;
                updateFromState();
                return true;
            },
            destroy: () => {
                if (isDestroyed) return;
                isDestroyed = true;

                cleanup?.();
                cleanup = null;

                unsubscribeFromPlatformChange();
                unsubscribeFromSpacingScaleChange();
                unsubscribeFromReferencesUpdate();
                unsubscribeFromUpdatedContentEditorFileParent();
            },
        };
    };
}
