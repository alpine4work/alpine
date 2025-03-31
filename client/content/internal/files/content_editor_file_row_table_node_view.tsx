import {NodeViewConstructor} from "prosemirror-view";
import {createContentEditorFileRowNodeViewConstructor} from "~/client/content/internal/content_editor_file_row_node_view.js";
import {SpaceId} from "~/shared/id/types/id_types.js";

export function createContentEditorFileRowTableNodeViewConstructor(options: {
    getSpaceId: () => SpaceId;
    getLayoutScreenWidth: () => number;
    subscribeToReferencesUpdate: (listener: () => void) => () => void;
}): NodeViewConstructor {
    return createContentEditorFileRowNodeViewConstructor(options);
}
