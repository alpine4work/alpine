import {DOMSerializer, Node} from "prosemirror-model";
import {EditorView, NodeView} from "prosemirror-view";
import {getContentEditorReferences} from "~/client/content/content_editor_state.js";
import {layoutContentFileRow} from "~/client/content/internal/layout_content_file_row.js";
import {getClientInfo} from "~/client/remix/client_info_context.js";
import {
    getIsMobileWithoutListening,
    subscribeToIsMobileChange,
} from "~/client/remix/use_is_mobile.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {FileId} from "~/shared/id/types/id_types.js";

export function createContentEditorFileRowNodeView(node: Node, view: EditorView): NodeView {
    // NOCOMMIT: Does this function re-run when state changes? Probably not. How do
    // we listen for state changes?
    const contentReferences = getContentEditorReferences(view.state).references;

    const {dom, contentDOM: contentDom} = DOMSerializer.renderSpec(
        document,
        node.type.spec.toDOM!(node),
    );

    assert(dom instanceof HTMLElement);

    let isDestroyed = false;

    const update = () => {
        assert(!isDestroyed);

        const layout = layoutContentFileRow(
            node.content.content.map(childNode => {
                assert(childNode.type.name === "file");
                const fileId: FileId | null = childNode.attrs.id;
                if (!fileId) return null;
                return contentReferences.fileById.get(fileId) ?? null;
            }),
            {
                screenWidth: getClientInfo().screenWidth,
                isMobile: getIsMobileWithoutListening(),
            },
        );

        dom.style.height = `${Math.max(...layout.map(({height}) => height))}px`;
        dom.style.gridTemplateColumns = layout.map(({widthFr}) => `${widthFr}fr`).join(" ");
    };

    const unsubscribeFromIsMobileChange = subscribeToIsMobileChange(update);

    update();

    return {
        dom,
        contentDOM: contentDom,
        destroy: () => {
            if (isDestroyed) return;
            isDestroyed = true;

            unsubscribeFromIsMobileChange();
        },
    };
}
