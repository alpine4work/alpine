import {DOMSerializer} from "prosemirror-model";
import {NodeView, NodeViewConstructor} from "prosemirror-view";
import {getFileRegistry} from "~/client/web/content/file_registry_context.js";
import {dispatchContentEditorFileParentUpdatedEvent} from "~/client/web/content/internal/content_editor_file_node_view.js";
import {getContentEditorReferences} from "~/client/web/content/state/content_editor_state.js";
import {layoutContentFileParent} from "~/client/web/content/state/content_file_layout.js";
import {
    ContentEditorTableLayout,
    resolveContentTableColumnWidthPx,
} from "~/client/web/content/state/table/helpers/resolve_content_table_column_width_px.js";
import {ElementEventEmitter} from "~/client/web/helpers/element_event_emitter.js";
import {
    getPlatformWithoutListening,
    subscribeToPlatformChange,
} from "~/client/web/remix/platform_context.js";
import {
    getSpacingScaleWithoutListening,
    subscribeToSpacingScaleChange,
} from "~/client/web/remix/spacing_scale_context.js";
import {contentStyles} from "~/client/web/styles/styles.js";
import {ContentFileLayout} from "~/shared/content/compute_file_row_widths.js";
import {ContentTableMap} from "~/shared/content/table/content_table_map.js";
import {convertRemLengthToPx} from "~/shared/design/core/spacing.js";
import {SpacingScale} from "~/shared/design/core/spacing_scale.js";
import {FileEntityId} from "~/shared/files/file_entity_id.js";
import {FileModel} from "~/shared/files/file_model.js";
import {scheduleMicrotask} from "~/shared/helpers/async/schedule_microtask.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.js";
import {isShallowEqual} from "~/shared/helpers/control/is_shallow_equal.js";
import {noop} from "~/shared/helpers/control/noop.js";
import {isId} from "~/shared/id/id.js";
import {FileId, SpaceId} from "~/shared/id/types/id_types.js";
import {computeStore} from "~/shared/store/compute_store.js";

const contentEditorFileRowTableParentUpdateEventEmitter =
    new ElementEventEmitter<ContentEditorTableLayout | null>("tableparentupdate");

/**
 * When we have a `fileRowTable` who's parent `table` updates this function should
 * be called so that we can layout our file row again.
 */
export function dispatchContentEditorFileRowTableParentUpdatedEvent(
    element: Element,
    optimisticTableLayout: ContentEditorTableLayout | null,
) {
    contentEditorFileRowTableParentUpdateEventEmitter.emit(element, optimisticTableLayout);
}

export function createContentEditorFileRowLikeNodeViewConstructor({
    getSpaceId,
    getBlockWidth,
    subscribeToReferencesUpdate,
}: {
    getSpaceId: () => SpaceId;
    getBlockWidth: () => number;
    subscribeToReferencesUpdate: (listener: () => void) => () => void;
}): NodeViewConstructor {
    return (node, view, getPos): NodeView => {
        const {dom, contentDOM: contentDom} = DOMSerializer.renderSpec(
            document,
            node.type.spec.toDOM!(node),
        );

        assert(dom instanceof HTMLElement);

        // Make sure the browser doesn't think it's allowed to select or edit inside a file
        // row.
        dom.contentEditable = "false";

        let isDestroyed = false;
        let lastSpacingScale: SpacingScale | null = null;
        let lastBlockWidth: number | null = null;
        let lastFileReferences: Array<
            {signedUrlSearch: string; file: FileModel} | undefined
        > | null = null;
        let lastLayouts: ReadonlyArray<ContentFileLayout> | null = null;
        let optimisticTableLayout: ContentEditorTableLayout | null = null;
        let lastOptimisticTableLayout: ContentEditorTableLayout | null = null;
        let cleanup: (() => void) | null = null;

        const updateFromState = (): boolean => {
            assert(!isDestroyed);

            const platform = getPlatformWithoutListening();
            const spacingScale = getSpacingScaleWithoutListening();

            let blockWidthPx = getBlockWidth();

            const pos = getPos()!;
            const $pos = view.state.doc.resolve(pos);

            if ($pos.depth > 0) {
                const parentBlockNode = $pos.node(1);

                // If our file is inside a table then `blockWidth` should be equal to the column
                // width.
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

            const fileReferences = node.content.content.map(childNode => {
                const fileId: FileId | FileEntityId | null = childNode.attrs.fileId;
                const fileReference =
                    fileId && isId<FileId>(fileId) ? references.fileById?.get(fileId) : undefined;
                return fileReference;
            });

            if (
                lastSpacingScale === spacingScale &&
                lastBlockWidth === blockWidthPx &&
                lastFileReferences !== null &&
                isShallowEqual(lastFileReferences, fileReferences) &&
                // If the optimistic table layout changes we need to forward the new
                // `optimisticTableLayout` to our child file node views. Which will only happen if
                // `updateFromState()` returns true.
                lastOptimisticTableLayout === optimisticTableLayout
            ) {
                return false;
            }

            lastSpacingScale = spacingScale;
            lastBlockWidth = blockWidthPx;
            lastFileReferences = fileReferences;
            lastOptimisticTableLayout = optimisticTableLayout;

            cleanup?.();
            cleanup = null;

            const layoutsStore = computeStore(get =>
                layoutContentFileParent(node, {
                    blockWidth: blockWidthPx,
                    platform,
                    spacingScale,
                    getFile: fileId => {
                        const fileReference = references.fileById?.get(fileId);
                        if (!fileReference) return null;
                        return get(getFileRegistry(getSpaceId()).getFileStore(fileReference));
                    },
                }),
            );

            const updateFromStore = () => {
                const layouts = layoutsStore.getSnapshot();

                if (lastLayouts !== layouts) {
                    lastLayouts = layouts;

                    dom.style.height = `${Math.max(...layouts.map(({height}) => height))}px`;
                    dom.style.gridTemplateColumns = layouts
                        .map(({widthFr}) => `${widthFr}fr`)
                        .join(" ");
                }
            };

            const unsubscribeFromStore = layoutsStore.subscribe(updateFromStore);
            updateFromStore();

            cleanup = () => {
                unsubscribeFromStore();
            };

            return true;
        };

        updateFromState();

        const unsubscribeFromPlatformChange = subscribeToPlatformChange(updateFromState);
        const unsubscribeFromSpacingScaleChange = subscribeToSpacingScaleChange(updateFromState);
        const unsubscribeFromReferencesUpdate = subscribeToReferencesUpdate(updateFromState);

        const unsubscribeFromTableParentUpdatedEvent =
            // We only need to subscribe to table parent updates if we're a `fileRowTable`.
            // `fileRow`s will not be rendered in tables.
            node.type.name === "fileRowTable"
                ? contentEditorFileRowTableParentUpdateEventEmitter.subscribe(
                      dom,
                      newOptimisticTableLayout => {
                          optimisticTableLayout = newOptimisticTableLayout;

                          if (updateFromState()) {
                              for (const childNode of dom.childNodes) {
                                  if (childNode instanceof Element) {
                                      dispatchContentEditorFileParentUpdatedEvent(
                                          childNode,
                                          optimisticTableLayout,
                                      );
                                  }
                              }
                          }
                      },
                  )
                : noop;

        return {
            dom,
            contentDOM: contentDom,
            update: newNode => {
                if (node.type !== newNode.type) return false;

                node = newNode;

                if (updateFromState()) {
                    // Dispatch child events after a microtask since ProseMirror updates parent nodes
                    // before child nodes. We want to wait until ProseMirror has finished updating
                    // before we notify our children they need to change.
                    //
                    // For example, when deleting a file child if we check `dom.childNodes` here the
                    // deleted child will still be in the list. But if we wait a microtask the deleted
                    // child won't be in the list.
                    scheduleMicrotask(() => {
                        for (const childNode of dom.childNodes) {
                            if (childNode instanceof Element) {
                                dispatchContentEditorFileParentUpdatedEvent(
                                    childNode,
                                    optimisticTableLayout,
                                );
                            }
                        }
                    });
                }

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
                unsubscribeFromTableParentUpdatedEvent();

                // When destroying a `fileRow`, we may be converting to a `fileFloat`! In this case
                // the `file` node may not be destroyed, just moved into the `fileFloat`. However,
                // the file's layout will change in the new parent so we need to dispatch an update
                // so the file node can re-render. Since ProseMirror only calls `update()` on the
                // `file` node view if the `file` itself changes (which it doesn't only the parent
                // changes in this case).
                //
                // Wait a microtask, if any child nodes are still in the DOM, tell them to update!
                {
                    const oldChildNodes = Array.from(dom.childNodes);

                    scheduleMicrotask(() => {
                        for (const childNode of oldChildNodes) {
                            if (childNode instanceof Element && document.body.contains(childNode)) {
                                dispatchContentEditorFileParentUpdatedEvent(childNode, null);
                            }
                        }
                    });
                }
            },
            ignoreMutation: record => {
                // Ignore changes to `style` attribute when file row layout changes.
                return record.type === "attributes" && record.target === dom;
            },
        };
    };
}
