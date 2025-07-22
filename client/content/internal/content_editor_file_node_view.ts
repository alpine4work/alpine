import {today} from "@internationalized/date";
import {Node} from "prosemirror-model";
import {NodeSelection} from "prosemirror-state";
import {NodeViewConstructor} from "prosemirror-view";
import {MutableRefObject} from "react";
import {getAccountRegistry} from "~/client/accounts/account_registry_context.js";
import {ContentFileEntityRenderers} from "~/client/content/content_file_entity_renderers_context.js";
import {getFileRegistry} from "~/client/content/file_registry_context.js";
import {ContentEditorFileToolbarController} from "~/client/content/internal/content_editor_file_toolbar.js";
import {
    addContentFileEntityPreviewBehavior,
    renderContentFileEntityPreview,
} from "~/client/content/internal/content_file_entity_preview.js";
import {
    addContentFilePreviewBehavior,
    renderContentFilePreview,
} from "~/client/content/internal/content_file_preview.js";
import {
    getContentEditorReferences,
    rememberContentEditorPosWhileLoading,
} from "~/client/content/state/content_editor_state.js";
import {layoutContentFile} from "~/client/content/state/content_file_layout.js";
import {getContentBlockWidth} from "~/client/content/state/get_content_block_width.js";
import {
    ContentEditorTableLayout,
    resolveContentTableColumnWidthPx,
} from "~/client/content/state/table/helpers/resolve_content_table_column_width_px.js";
import {AppContext} from "~/client/context/app_context.js";
import {Reporter} from "~/client/design/reporter.js";
import {ElementEventEmitter} from "~/client/helpers/element_event_emitter.js";
import {getClientInfo} from "~/client/remix/client_info_context.js";
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
import {getSearchEntityRegistry} from "~/client/search/core/search_entity_registry_context.js";
import {contentStyles} from "~/client/styles/styles.js";
import {AccessLevel, hasAccessLevel} from "~/shared/access/access_policy.js";
import {ContentTableMap} from "~/shared/content/table/content_table_map.js";
import {RouteLayout} from "~/shared/design/core/route_layout.js";
import {convertRemLengthToPx} from "~/shared/design/core/spacing.js";
import {SpacingScale} from "~/shared/design/core/spacing_scale.js";
import {FileAttachmentTarget} from "~/shared/files/file_attachment_target.js";
import {FileEntityId} from "~/shared/files/file_entity_id.js";
import {FileEntityModel} from "~/shared/files/file_entity_model.js";
import {FileModel} from "~/shared/files/file_model.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.js";
import {noop} from "~/shared/helpers/control/noop.js";
import {Result} from "~/shared/helpers/control/result.js";
import {HtmlElementGenerator} from "~/shared/helpers/html/html_generator.js";
import {isId} from "~/shared/id/id.js";
import {FileId, SpaceId} from "~/shared/id/types/id_types.js";
import {AccountModel} from "~/shared/spaces/account_model.js";
import {computeStore} from "~/shared/store/compute_store.js";
import {undefinedStore} from "~/shared/store/const_store.js";

const contentEditorFileParentUpdateEventEmitter =
    new ElementEventEmitter<ContentEditorTableLayout | null>("parentupdate");

/**
 * When a file parent node view updates (`fileRow` or `fileFloat`) it calls
 * this function so its children may also update if necessary.
 */
export function dispatchContentEditorFileParentUpdatedEvent(
    element: Element,
    optimisticTableLayout: ContentEditorTableLayout | null,
) {
    contentEditorFileParentUpdateEventEmitter.emit(element, optimisticTableLayout);
}

export function createContentEditorFileNodeViewConstructor({
    rootNavigate,
    navigate,
    getContext,
    getReporter,
    getRouteLayout,
    getSpaceId,
    getCurrentAccount,
    getAttachmentTarget,
    getFileEntityRenderers,
    getAccessLevel,
    subscribeToReferencesUpdate,
    draggingFileRef,
}: {
    rootNavigate: NavigateFunction;
    navigate: NavigateFunction;
    getContext: () => AppContext;
    getReporter: () => Reporter;
    getRouteLayout: () => RouteLayout;
    getSpaceId: () => SpaceId;
    getCurrentAccount: () => AccountModel | null;
    getAttachmentTarget: () => FileAttachmentTarget;
    getFileEntityRenderers: () => ContentFileEntityRenderers | null;
    getAccessLevel: () => AccessLevel;
    subscribeToReferencesUpdate: (listener: () => void) => () => void;
    draggingFileRef: MutableRefObject<{getPos: () => number | null} | null>;
}): NodeViewConstructor {
    return (node, view, getPos) => {
        let dom: HTMLElement;

        let isDestroyed = false;
        let lastSpacingScale: SpacingScale | null = null;
        let lastBlockWidth: number | null = null;
        let lastNodeParent: Node | null = null;
        let lastFileReference: {signedUrlSearch: string; file: FileModel} | undefined | null = null;
        let lastFileEntityResult: Result<FileEntityModel> | undefined | null = null;
        let lastHtml: HtmlElementGenerator | null = null;
        let optimisticTableLayout: ContentEditorTableLayout | null = null;
        let cleanup: (() => void) | null = null;

        const updateFromState = () => {
            assert(!isDestroyed);

            const platform = getPlatformWithoutListening();
            const spacingScale = getSpacingScaleWithoutListening();

            let blockWidthPx = getContentBlockWidth({
                spacingScale,
                platform,
                routeLayout: getRouteLayout(),
                clientInfo: getClientInfo(),
            });

            const pos = assertExists(getPos());
            const $pos = view.state.doc.resolve(pos);
            const nodeParent = $pos.parent;

            if ($pos.depth > 0) {
                const parentBlockNode = $pos.node(1);

                // If our file is inside a table then `blockWidth` should be equal to the
                // column width.
                if (parentBlockNode.type.name === "table") {
                    const tableMap = ContentTableMap.get(parentBlockNode);

                    // Should be the `tableCell` node index in `tableRow`.
                    const columnIndex = $pos.index(2);

                    const columnWidths = resolveContentTableColumnWidthPx(
                        spacingScale,
                        blockWidthPx,
                        optimisticTableLayout ?? tableMap,
                    );

                    const columnWidth = assertExists(columnWidths[columnIndex]);

                    blockWidthPx =
                        columnWidth -
                        convertRemLengthToPx(contentStyles.tableCellPaddingX, spacingScale) * 2;
                }
            }

            const {references} = getContentEditorReferences(view.state);
            const spaceId = getSpaceId();
            const fileId: FileId | FileEntityId | null = node.attrs.fileId;
            const isFileEntity = fileId && !isId<FileId>(fileId);

            const fileReference =
                fileId && !isFileEntity ? references.fileById?.get(fileId) : undefined;

            const fileEntityResult = isFileEntity
                ? references.fileEntityById?.get(fileId)
                : undefined;

            if (
                lastSpacingScale !== spacingScale ||
                lastBlockWidth !== blockWidthPx ||
                lastNodeParent !== nodeParent ||
                lastFileReference !== fileReference ||
                lastFileEntityResult !== fileEntityResult
            ) {
                lastSpacingScale = spacingScale;
                lastBlockWidth = blockWidthPx;
                lastNodeParent = nodeParent;
                lastFileReference = fileReference;
                lastFileEntityResult = fileEntityResult;

                cleanup?.();
                cleanup = null;

                let cleanupBehavior: (() => void) | null = null;

                const htmlStore = computeStore(get => {
                    const file = get(
                        fileReference
                            ? getFileRegistry(spaceId).getFileStore(fileReference)
                            : undefinedStore,
                    );

                    const layout = layoutContentFile(view.state.doc, pos, node, {
                        platform,
                        spacingScale,
                        blockWidth: blockWidthPx,
                        getFile: otherFileId => {
                            if (otherFileId === fileId) return file ?? null;

                            const otherFileReference = references.fileById?.get(otherFileId);
                            if (!otherFileReference) return null;

                            return get(
                                getFileRegistry(getSpaceId()).getFileStore(otherFileReference),
                            );
                        },
                    });

                    let html: HtmlElementGenerator;

                    if (isFileEntity) {
                        const clientInfo = getClientInfo();

                        html = renderContentFileEntityPreview(get, {
                            node,
                            fileEntityId: fileId,
                            fileEntityResult,
                            fileEntityRenderers: getFileEntityRenderers(),
                            layout,
                            getContext,
                            clientInfo,
                            spaceId,
                            accountRegistry: getAccountRegistry(spaceId),
                            searchEntityRegistry: getSearchEntityRegistry(spaceId),
                            fileRegistry: getFileRegistry(spaceId),
                            currentAccount: getCurrentAccount(),
                            blockWidth: blockWidthPx,
                            transformScale: 1,
                            platform,
                            spacingScale,
                            routeLayout: getRouteLayout(),
                            isInitialAppRender: false,
                            currentDate: today(clientInfo.timeZone),
                            // This render call doesn't run during SSR. Ignore hydration warning
                            // suppressions!
                            suppressHydrationWarning: noop,
                        });
                    } else {
                        html = renderContentFilePreview({
                            spaceId,
                            node,
                            file,
                            layout,
                            blockWidth: blockWidthPx,
                            transformScale: 1,
                            platform,
                            spacingScale,
                            isInitialAppRender: false,
                        });
                    }

                    return {file, html};
                });

                const updateFromStore = () => {
                    cleanupBehavior?.();
                    cleanupBehavior = null;

                    const {file, html} = htmlStore.getSnapshot();

                    if (dom === undefined) {
                        dom = html.generateNode();
                        lastHtml = html;
                    } else {
                        assert(html.patchNode(lastHtml, dom));
                        lastHtml = html;
                    }

                    const onShiftMouseDown = (event: MouseEvent) => {
                        event.preventDefault();

                        view.dispatch(
                            view.state.tr.setSelection(
                                new NodeSelection(view.state.doc.resolve(assertExists(getPos()))),
                            ),
                        );

                        if (!view.hasFocus()) view.focus();
                    };

                    const isLongPressDisabled = () => {
                        // Selection after a long press is only useful when there's a toolbar to show
                        // over the file. If we're in "View" mode we don't render a toolbar or
                        // selection ring so disable long presses.
                        return !hasAccessLevel(getAccessLevel(), "Comment");
                    };

                    const onLongPress = () => {
                        dom.classList.add(contentStyles.longPressedFileClassName);

                        view.dispatch(
                            view.state.tr.setSelection(
                                new NodeSelection(view.state.doc.resolve(assertExists(getPos()))),
                            ),
                        );

                        if (!view.hasFocus()) view.focus();

                        NativeMobileBridge?.haptic.playMediumImpact();
                    };

                    const onDrag = (dragPromise: Promise<void>) => {
                        const ourDraggingFile = rememberContentEditorPosWhileLoading(
                            view,
                            assertExists(getPos()),
                            dragPromise,
                        );

                        draggingFileRef.current = ourDraggingFile;

                        void dragPromise.finally(() => {
                            if (draggingFileRef.current === ourDraggingFile)
                                draggingFileRef.current = null;
                        });
                    };

                    if (isFileEntity) {
                        cleanupBehavior = addContentFileEntityPreviewBehavior(getContext, dom, {
                            spaceId,
                            node,
                            fileEntityId: fileId,
                            fileEntityResult,
                            fileEntityRenderers: getFileEntityRenderers(),
                            navigate,
                            getReporter,
                            onShiftMouseDown,
                            isLongPressDisabled,
                            onLongPress,
                            onDrag,
                        });
                    } else {
                        cleanupBehavior = addContentFilePreviewBehavior(getContext, dom, {
                            spaceId,
                            node,
                            file,
                            attachmentTarget: getAttachmentTarget(),
                            isInitialAppRender: false,
                            rootNavigate,
                            getReporter,
                            onShiftMouseDown,
                            isLongPressDisabled,
                            onLongPress,
                            onDrag,
                        });
                    }
                };

                const unsubscribeFromStore = htmlStore.subscribe(updateFromStore);
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
                    view.state.tr.setSelection(
                        new NodeSelection(view.state.doc.resolve(assertExists(getPos()))),
                    ),
                );

                if (!view.hasFocus()) view.focus();
            });
        });

        const unsubscribeFromPlatformChange = subscribeToPlatformChange(updateFromState);
        const unsubscribeFromSpacingScaleChange = subscribeToSpacingScaleChange(updateFromState);
        const unsubscribeFromReferencesUpdate = subscribeToReferencesUpdate(updateFromState);

        const unsubscribeFromParentUpdated = contentEditorFileParentUpdateEventEmitter.subscribe(
            dom,
            newOptimisticTableLayout => {
                optimisticTableLayout = newOptimisticTableLayout;
                updateFromState();
            },
        );

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
                unsubscribeFromParentUpdated();
            },
            ignoreMutation: () => {
                // Ignore ALL mutations. Let `patchNode()` do anything it needs to the DOM.
                // This node isn't `contenteditable` so we don't need ProseMirror monitoring
                // changes.
                return true;
            },
        };
    };
}
