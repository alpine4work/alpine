import classNames from "classnames";
import {NodeViewConstructor} from "prosemirror-view";
import {getContentMentionText} from "~/client/accounts/get_content_mention_text";
import {getContentEditorReferences} from "~/client/content/content_editor_state";
import {ContentMention} from "~/shared/content/content_mention";
import {AccountModel} from "~/shared/models/account_model";
import {contentSchemaStyles} from "~/shared/styles/styles";

const {mentionClassName, currentAccountMentionClassName, mentionAtClassName, mentionTextClassName} =
    contentSchemaStyles;

export function createContentEditorMentionNodeViewConstructor({
    getCurrentAccount,
}: {
    getCurrentAccount: () => AccountModel | null;
}): NodeViewConstructor {
    return (node, view) => {
        const mention: ContentMention = node.attrs.mention;
        const isCurrentAccountMention = getCurrentAccount()?.id === mention.accountId;
        const contentReferences = getContentEditorReferences(view.state);

        // We need a container element for highlight styles to be applied to. Our
        // mention element may have a background color when mentioning the
        // current account.
        const containerElement = document.createElement("span");
        containerElement.dataset.mentionAccount = mention.accountId;
        if (mention.isShort) containerElement.dataset.mentionShort = "true";

        const element = document.createElement("span");
        containerElement.appendChild(element);
        element.className = classNames(
            mentionClassName,
            isCurrentAccountMention && currentAccountMentionClassName,
        );

        const atElement = document.createElement("span");
        element.appendChild(atElement);
        atElement.className = mentionAtClassName;
        atElement.textContent = "@";

        const textElement = document.createElement("span");
        element.appendChild(textElement);
        textElement.className = mentionTextClassName;
        textElement.textContent = getContentMentionText(contentReferences, mention);

        return {dom: containerElement};
    };
}
