import {Fragment, Node as ProseMirrorNode, Slice} from "prosemirror-model";
import {AccountClientStore} from "~/client/accounts/account_client_store.js";
import {createContentMentionTextStore} from "~/client/accounts/create_content_mention_text_store.js";
import {ContentMention} from "~/shared/content/content_mention.js";
import {ContentReferences} from "~/shared/content/content_references.js";

// We fork these two functions `textBetween`
// from Prosemirror's prosemirror-model Fragment class.
// We add our own behavior for serializing the text content when
// copying to our clipboard.
//
// https://github.com/ProseMirror/prosemirror-model/blob/b71f73f193b15ab1661451636352905b06a6fb0d/src/fragment.ts#L26-L43
function textBetweenWithCodeBlockLineBLockSeparator(
    fragment: Fragment,
    from: number,
    to: number,
    blockSeparator?: string | null,
    leafText?: string | null | ((leafNode: ProseMirrorNode) => string),
): string {
    let text = "",
        first = true;
    fragment.nodesBetween(
        from,
        to,
        (node, pos) => {
            const nodeText = node.isText
                ? node.text!.slice(Math.max(from, pos) - pos, to - pos)
                : !node.isLeaf
                ? ""
                : leafText
                ? typeof leafText === "function"
                    ? leafText(node)
                    : leafText
                : node.type.spec.leafText
                ? node.type.spec.leafText(node)
                : "";

            // NOTE: We add this custom behavior to check if we are copying
            // from code block line's because we do not want
            // double `\n\n` characters when we copy to clipboard.
            // However, we still need to add one `\n` character at the end
            // of each text `codeBlockLine`.
            const isCodeBlockLine = node.type.name === "codeBlockLine";
            if (isCodeBlockLine) {
                if (!first) text += "\n";
                text += nodeText;
                first = false;
                return;
            }

            if (node.isBlock && ((node.isLeaf && nodeText) || node.isTextblock) && blockSeparator) {
                if (first) first = false;
                else text += blockSeparator;
            }
            text += nodeText;
        },
        0,
    );
    return text;
}

export function contentEditorTextClipboardSerializer(
    slice: Slice,
    accountStore: AccountClientStore,
    getContentReferences: () => ContentReferences,
): string {
    // Default clipboard text serializer plus extra support for mention nodes:
    // https://github.com/ProseMirror/prosemirror-view/blob/ab8f502cb69b1d97e2a606ec0a8b37f15b161baa/src/clipboard.ts#L36-L37

    return textBetweenWithCodeBlockLineBLockSeparator(
        slice.content,
        0,
        slice.content.size,
        "\n\n",
        node => {
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
        },
    );
}
