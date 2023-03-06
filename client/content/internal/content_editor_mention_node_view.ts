import {Node} from "prosemirror-model";
import {EditorView, NodeView} from "prosemirror-view";
import {getContentMentionText} from "~/client/accounts/get_content_mention_text";
import {renderAccountAvatarToHtml} from "~/client/accounts/render_account_avatar_to_html";
import {getContentEditorReferences} from "~/client/content/content_editor_state";
import {ContentMention} from "~/shared/content/content_mention";
import {backgroundFontSizePercentage, contentSchemaStyles} from "~/shared/styles/styles";

const {mentionClassName, mentionAvatarClassName} = contentSchemaStyles;

export function createContentEditorMentionNodeView(node: Node, view: EditorView): NodeView {
    const mention: ContentMention = node.attrs.mention;
    const contentReferences = getContentEditorReferences(view.state);

    // We have a container element so that text selection styles apply to the
    // container, not the element with border radius and a background color.
    const containerElement = document.createElement("span");

    const element = document.createElement("span");
    containerElement.appendChild(element);
    element.className = mentionClassName;

    const avatarElement = document.createElement("span");
    element.appendChild(avatarElement);
    avatarElement.className = mentionAvatarClassName;
    avatarElement.innerHTML = renderAccountAvatarToHtml({
        // @ts-expect-error: NOCOMMIT(calebmer): Should use the missing account name + missing avatar!
        account: contentReferences.accountById.get(mention.accountId),
        size: `${Math.round(backgroundFontSizePercentage * 100) / 100}em`,
    });

    const mentionText = getContentMentionText(contentReferences, mention);

    // We use non-breaking spaces instead of horizontal padding so that
    // browser selection covers the entire mention instead of covering some of the
    // mention and leaving `paddingLeft`/`paddingRight` areas alone. Spaces also
    // scale up with the font size which is a nice side effect.
    //
    // https://graphemica.com/%C2%A0
    //
    // TODO(calebmer): Maybe a `<span>` with a `width` would work and allow text
    // selection?
    const mentionTextWithPadding = `\u00A0\u00A0\u00A0\u00A0\u00A0\u00A0${mentionText}\u00A0\u00A0`;

    element.appendChild(document.createTextNode(mentionTextWithPadding));

    return {dom: containerElement};
}
