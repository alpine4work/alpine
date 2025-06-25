import classNames from "classnames";
import {NodeViewConstructor} from "prosemirror-view";
import {getAccountRegistry} from "~/client/accounts/account_registry_context.js";
import {createContentMentionTextStore} from "~/client/accounts/create_content_mention_text_store.js";
import {getContentEditorReferences} from "~/client/content/state/content_editor_state.js";
import {contentStyles} from "~/client/styles/styles.js";
import {ContentMention} from "~/shared/content/content_mention.js";
import {SpaceId} from "~/shared/id/types/id_types.js";
import {AccountModel} from "~/shared/spaces/account_model.js";

const {mentionClassName, currentAccountMentionClassName, mentionAtClassName, mentionTextClassName} =
    contentStyles;

export function createContentEditorMentionNodeViewConstructor({
    getSpaceId,
    getCurrentAccountIfExists,
}: {
    getSpaceId: () => SpaceId;
    getCurrentAccountIfExists: () => AccountModel | null;
}): NodeViewConstructor {
    return (node, view) => {
        const mention: ContentMention = node.attrs.mention;
        const isCurrentAccountMention = getCurrentAccountIfExists()?.id === mention.accountId;
        const contentReferences = getContentEditorReferences(view.state).references;

        const contentMentionTextStore = createContentMentionTextStore(
            getAccountRegistry(getSpaceId()),
            contentReferences,
            mention,
        );

        // We need a container element for highlight styles to be applied to. Our
        // mention element may have a background color when mentioning the
        // current account.
        const containerElement = document.createElement("span");

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
