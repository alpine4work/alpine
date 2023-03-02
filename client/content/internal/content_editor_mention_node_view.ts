import {DOMSerializer, Node} from "prosemirror-model";
import {EditorView, NodeView} from "prosemirror-view";
import {getContentEditorReferences} from "~/client/content/content_editor_state";
import {ContentMention, missingAccountMentionName} from "~/shared/content/content_mention";

export function createContentEditorMentionNodeView(node: Node, view: EditorView): NodeView {
    const {dom} = DOMSerializer.renderSpec(document, node.type.spec.toDOM!(node));

    const mention: ContentMention = node.attrs.mention;
    const contentReferences = getContentEditorReferences(view.state);
    const account = contentReferences.accountById.get(mention.accountId);

    dom.textContent = `@${account?.name ?? missingAccountMentionName}`;

    return {dom};
}
