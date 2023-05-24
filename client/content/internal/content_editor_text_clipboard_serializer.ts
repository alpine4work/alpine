import {Slice} from "prosemirror-model";
import {getContentMentionText} from "~/client/accounts/get_content_mention_text";
import {ContentMention} from "~/shared/content/content_mention";
import {ContentReferences} from "~/shared/content/content_references";

export function contentEditorTextClipboardSerializer(
    slice: Slice,
    getContentReferences: () => ContentReferences,
): string {
    // Default clipboard text serializer plus extra support for mention nodes:
    // https://github.com/ProseMirror/prosemirror-view/blob/ab8f502cb69b1d97e2a606ec0a8b37f15b161baa/src/clipboard.ts#L36-L37
    return slice.content.textBetween(0, slice.content.size, "\n\n", node => {
        if (node.type.name === "mention") {
            const contentReferences = getContentReferences();
            const mention: ContentMention = node.attrs.mention;
            const mentionText = getContentMentionText(contentReferences, mention);
            return `@${mentionText}`;
        }

        return "";
    });
}
