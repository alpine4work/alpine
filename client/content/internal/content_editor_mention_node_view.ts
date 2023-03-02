import {Node} from "prosemirror-model";
import {EditorView, NodeView} from "prosemirror-view";
import {getContentEditorReferences} from "~/client/content/content_editor_state";
import {ContentMention} from "~/shared/content/content_mention";
import {getContentMentionText} from "~/shared/models/content_references";
import {contentSchemaStyles} from "~/shared/styles/styles";

const {mentionClassName} = contentSchemaStyles;

export function createContentEditorMentionNodeView(node: Node, view: EditorView): NodeView {
    const mention: ContentMention = node.attrs.mention;
    const contentReferences = getContentEditorReferences(view.state);

    // We have a container element so that text selection styles apply to the
    // container, not the element with border radius and a background color.
    const containerElement = document.createElement("span");

    const element = document.createElement("span");
    containerElement.appendChild(element);
    element.className = mentionClassName;
    element.textContent = getContentMentionText(contentReferences, mention);

    return {dom: containerElement};
}
