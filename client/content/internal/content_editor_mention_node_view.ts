import classNames from "classnames";
import {NodeViewConstructor} from "prosemirror-view";
import {AccountClientStore} from "~/client/accounts/account_client_store.js";
import {getContentMentionTextStore} from "~/client/accounts/get_content_mention_text_store.js";
import {getContentEditorReferences} from "~/client/content/content_editor_state.js";
import {AccountModel} from "~/shared/accounts/account_model.js";
import {ContentMention} from "~/shared/content/content_mention.js";
import {contentSchemaStyles} from "~/shared/styles/styles.js";

const {mentionClassName, currentAccountMentionClassName, mentionAtClassName, mentionTextClassName} =
    contentSchemaStyles;

export function createContentEditorMentionNodeViewConstructor({
    accountStore,
    getCurrentAccountIfExists,
}: {
    accountStore: AccountClientStore;
    getCurrentAccountIfExists: () => AccountModel | null;
}): NodeViewConstructor {
    return (node, view) => {
        const mention: ContentMention = node.attrs.mention;
        const isCurrentAccountMention = getCurrentAccountIfExists()?.id === mention.accountId;
        const contentReferences = getContentEditorReferences(view.state).references;

        const contentMentionTextStore = getContentMentionTextStore(
            accountStore,
            contentReferences,
            mention,
        );

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

        // Whenever the content mention text changes, we want to update our mention
        // node with the right value.
        const unsubscribe = contentMentionTextStore.subscribe(() => {
            textElement.textContent = contentMentionTextStore.getSnapshot();
        });

        textElement.textContent = contentMentionTextStore.getSnapshot();

        return {
            dom: containerElement,
            destroy: unsubscribe,
        };
    };
}
