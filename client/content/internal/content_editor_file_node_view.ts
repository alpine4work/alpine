import {Node} from "prosemirror-model";
import {EditorView, NodeView} from "prosemirror-view";
import {getContentEditorReferences} from "~/client/content/content_editor_state.js";
import {renderContentFilePreview} from "~/client/content/internal/render_content_file_preview.js";

export function createContentEditorFileNodeView(node: Node, view: EditorView): NodeView {
    // NOCOMMIT: Does this function re-run when state changes? Probably not. How do
    // we listen for state changes?
    const contentReferences = getContentEditorReferences(view.state).references;

    const html = renderContentFilePreview(node, contentReferences);

    return {dom: html.generateNode()};
}
