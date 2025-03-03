import {DOMSerializer} from "prosemirror-model";
import {NodeView, NodeViewConstructor} from "prosemirror-view";
import {getContentEditorReferences} from "~/client/content/content_editor_state.js";
import {getFileClientStore} from "~/client/content/file_client_store_context.js";
import {dispatchUpdatedContentEditorFileParentEvent} from "~/client/content/internal/content_editor_file_node_view.js";
import {layoutContentFileParent} from "~/client/content/internal/content_file_layout.js";
import {ContentFileLayout} from "~/client/content/internal/content_file_layout_computations.js";
import {
    getPlatformWithoutListening,
    subscribeToPlatformChange,
} from "~/client/remix/platform_context.js";
import {
    getSpacingScaleWithoutListening,
    subscribeToSpacingScaleChange,
} from "~/client/remix/spacing_scale_context.js";
import {scheduleMicrotask} from "~/shared/helpers/async/schedule_microtask.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {SpaceId} from "~/shared/id/types/id_types.js";
import {computeStore} from "~/shared/store/compute_store.js";

// NOCOMMIT: do one more iteration of the file table node view
export function createContentEditorFileTableNodeViewConstructor({
    getSpaceId,
    getLayoutScreenWidth,
    subscribeToReferencesUpdate,
}: {
    getSpaceId: () => SpaceId;
    getLayoutScreenWidth: () => number;
    subscribeToReferencesUpdate: (listener: () => void) => () => void;
}): NodeViewConstructor {
    return (node, view): NodeView => {
        const {dom, contentDOM: contentDom} = DOMSerializer.renderSpec(
            document,
            node.type.spec.toDOM!(node),
        );

        assert(dom instanceof HTMLElement);

        // Make sure the browser doesn't think it's allowed to select or edit inside a file table.
        dom.contentEditable = "false";

        let isDestroyed = false;
        let lastLayouts: ReadonlyArray<ContentFileLayout> | null = null;
        let cleanup: (() => void) | null = null;

        const updateFromState = () => {
            assert(!isDestroyed);

            const platform = getPlatformWithoutListening();
            const spacingScale = getSpacingScaleWithoutListening();
            const {references} = getContentEditorReferences(view.state);

            cleanup?.();
            cleanup = null;

            const layoutsStore = computeStore(get =>
                layoutContentFileParent(node, {
                    screenWidth: getLayoutScreenWidth(),
                    platform,
                    spacingScale,
                    withoutBlockMaxWidth: false,
                    getFile: fileId => {
                        const fileReference = references.fileById.get(fileId);
                        if (!fileReference) return null;
                        return get(getFileClientStore(getSpaceId()).getFileStore(fileReference));
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
        };

        updateFromState();

        const unsubscribeFromPlatformChange = subscribeToPlatformChange(updateFromState);
        const unsubscribeFromFileScaleChange = subscribeToSpacingScaleChange(updateFromState);
        const unsubscribeFromReferencesUpdate = subscribeToReferencesUpdate(updateFromState);

        return {
            dom,
            contentDOM: contentDom,
            update: newNode => {
                if (node.type !== newNode.type) return false;

                node = newNode;
                updateFromState();

                // Run update after a microtask since when deleting nodes ProseMirror deletes
                // the parent node first then the children. We don't want to dispatch an update
                // until ProseMirror gets the chance to destroy any removed child nodes.
                scheduleMicrotask(() => {
                    for (const childNode of dom.childNodes) {
                        if (childNode instanceof Element) {
                            dispatchUpdatedContentEditorFileParentEvent(childNode);
                        }
                    }
                });

                return true;
            },
            destroy: () => {
                if (isDestroyed) return;
                isDestroyed = true;

                cleanup?.();
                cleanup = null;

                unsubscribeFromPlatformChange();
                unsubscribeFromFileScaleChange();
                unsubscribeFromReferencesUpdate();
            },
        };
    };
}
