import {DOMSerializer} from "prosemirror-model";
import {NodeView, NodeViewConstructor} from "prosemirror-view";
import {getFileRegistry} from "~/client/web/content/file_registry_context.js";
import {dispatchContentEditorFileParentUpdatedEvent} from "~/client/web/content/internal/content_editor_file_node_view.js";
import {getContentEditorReferences} from "~/client/web/content/state/content_editor_state.js";
import {layoutContentFileParent} from "~/client/web/content/state/content_file_layout.js";
import {
    getPlatformWithoutListening,
    subscribeToPlatformChange,
} from "~/client/web/remix/platform_context.js";
import {
    getSpacingScaleWithoutListening,
    subscribeToSpacingScaleChange,
} from "~/client/web/remix/spacing_scale_context.js";
import {contentStyles} from "~/client/web/styles/styles.js";
import {ContentFileLayout} from "~/shared/content/compute_file_row_layout.js";
import {
    fileFloatLeftClassName,
    fileFloatRightClassName,
} from "~/shared/design/core/constant_class_names.js";
import {SpacingScale, remPxBySpacingScale} from "~/shared/design/core/spacing_scale.js";
import {FileEntityId} from "~/shared/files/file_entity_id.js";
import {FileModel} from "~/shared/files/file_model.js";
import {scheduleMicrotask} from "~/shared/helpers/async/schedule_microtask.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {isShallowEqual} from "~/shared/helpers/control/is_shallow_equal.js";
import {isId} from "~/shared/id/id.js";
import {FileId, SpaceId} from "~/shared/id/types/id_types.js";
import {computeStore} from "~/shared/store/compute_store.js";

export function createContentEditorFileFloatNodeViewConstructor({
    getSpaceId,
    getBlockWidth,
    subscribeToReferencesUpdate,
}: {
    getSpaceId: () => SpaceId;
    getBlockWidth: () => number;
    subscribeToReferencesUpdate: (listener: () => void) => () => void;
}): NodeViewConstructor {
    return (node, view): NodeView => {
        const {dom, contentDOM: contentDom} = DOMSerializer.renderSpec(
            document,
            node.type.spec.toDOM!(node),
        );

        assert(dom instanceof HTMLElement);

        // Make sure the browser doesn't think it's allowed to select or edit inside a file
        // float.
        dom.contentEditable = "false";

        let isDestroyed = false;
        let lastDirection: "left" | "right" | null = null;
        let lastLayouts: ReadonlyArray<ContentFileLayout> | null = null;
        let lastSpacingScale: SpacingScale | null = null;
        let lastBlockWidth: number | null = null;
        let lastFileReferences: Array<
            {signedUrlSearch: string; file: FileModel} | undefined
        > | null = null;
        let cleanup: (() => void) | null = null;

        const updateFromState = (): boolean => {
            assert(!isDestroyed);

            const platform = getPlatformWithoutListening();
            const spacingScale = getSpacingScaleWithoutListening();
            const blockWidth = getBlockWidth();

            const {references} = getContentEditorReferences(view.state);

            const fileReferences = node.content.content.map(childNode => {
                const fileId: FileId | FileEntityId | null = childNode.attrs.fileId;
                const fileReference =
                    fileId && isId<FileId>(fileId) ? references.fileById?.get(fileId) : undefined;
                return fileReference;
            });

            const direction = node.attrs.direction;

            // Swap CSS classes if direction changes.
            if (lastDirection !== direction) {
                lastDirection = direction;

                if (direction === "left") {
                    dom.classList.remove(fileFloatRightClassName);
                    dom.classList.add(fileFloatLeftClassName);
                } else if (direction === "right") {
                    dom.classList.remove(fileFloatLeftClassName);
                    dom.classList.add(fileFloatRightClassName);
                }
            }

            if (
                lastSpacingScale === spacingScale &&
                lastBlockWidth === blockWidth &&
                lastFileReferences !== null &&
                isShallowEqual(lastFileReferences, fileReferences)
            ) {
                return false;
            }

            lastSpacingScale = spacingScale;
            lastBlockWidth = blockWidth;
            lastFileReferences = fileReferences;

            cleanup?.();
            cleanup = null;

            const layoutsStore = computeStore(get =>
                layoutContentFileParent(node, {
                    platform,
                    spacingScale,
                    blockWidth,
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

                    const remPx = remPxBySpacingScale[spacingScale];

                    dom.style.width = `${(
                        layouts[0]!.width +
                        (direction === "left"
                            ? contentStyles.fileFloatLeftMarginXRem
                            : contentStyles.fileFloatRightMarginXRem) *
                            remPx
                    ).toFixed(3)}px`;
                    dom.style.height = `${(
                        layouts[0]!.height +
                        contentStyles.fileFloatMarginYRem * remPx * 2
                    ).toFixed(3)}px`;
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

        return {
            dom,
            contentDOM: contentDom,
            update: newNode => {
                if (node.type !== newNode.type) return false;

                node = newNode;

                if (updateFromState()) {
                    // Run update after a microtask since when deleting nodes ProseMirror deletes the
                    // parent node first then the children. We don't want to dispatch an update until
                    // ProseMirror gets the chance to destroy any removed child nodes.
                    scheduleMicrotask(() => {
                        for (const childNode of dom.childNodes) {
                            if (childNode instanceof Element) {
                                dispatchContentEditorFileParentUpdatedEvent(childNode, null);
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

                // When destroying a `fileFloat`, we may be converting to a `fileRow`! In this case
                // the `file` node may not be destroyed, just moved into the `fileRow`. However,
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
                // Ignore changes to `style` and `class` attribute when file row layout changes.
                return record.type === "attributes" && record.target === dom;
            },
        };
    };
}
