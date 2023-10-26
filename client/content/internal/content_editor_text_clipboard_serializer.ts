import {Slice} from "prosemirror-model";
import {AccountClientStore} from "~/client/accounts/account_client_store.js";
import {createContentMentionTextStore} from "~/client/accounts/create_content_mention_text_store.js";
import {ContentMention} from "~/shared/content/content_mention.js";
import {ContentReferences} from "~/shared/content/content_references.js";

export function contentEditorTextClipboardSerializer(
    slice: Slice,
    accountStore: AccountClientStore,
    getContentReferences: () => ContentReferences,
): string {
    // Default clipboard text serializer plus extra support for mention nodes:
    // https://github.com/ProseMirror/prosemirror-view/blob/ab8f502cb69b1d97e2a606ec0a8b37f15b161baa/src/clipboard.ts#L36-L37
    return slice.content.textBetween(0, slice.content.size, "\n\n", node => {
        if (node.type.name === "mention") {
            const contentReferences = getContentReferences();
            const mention: ContentMention = node.attrs.mention;
            const mentionText = createContentMentionTextStore(
                accountStore,
                contentReferences,
                mention,
            ).getSnapshot();
            return `@${mentionText}`;
        }

        return "";
    });
}
