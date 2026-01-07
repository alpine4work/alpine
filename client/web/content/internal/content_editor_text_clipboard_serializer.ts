import {Fragment, Node, Slice} from "prosemirror-model";
import {getAccountRegistry} from "~/client/web/accounts/account_registry_context.js";
import {getFileRegistry} from "~/client/web/content/file_registry_context.js";
import {renderContentMentionToTextForClient} from "~/client/web/content/render_content_mention_to_text_for_client.js";
import {getSearchEntityRegistry} from "~/client/web/search/core/search_entity_registry_context.js";
import {ContentReferences} from "~/shared/content/content_references.js";
import {SpaceId} from "~/shared/id/types/id_types.js";

// We fork these two functions `textBetween`
// from Prosemirror's prosemirror-model Fragment class.
// We add our own behavior for serializing the text content when
// copying to our clipboard.
//
// https://github.com/ProseMirror/prosemirror-model/blob/b71f73f193b15ab1661451636352905b06a6fb0d/src/fragment.ts#L54-L69
function textBetweenWithCodeBlockLineBlockSeparator(
    fragment: Fragment,
    from: number,
    to: number,
    blockSeparator?: string | null,
    leafText?: string | null | ((leafNode: Node) => string),
): string {
    let text = "";
    let first = true;
    let lastBlockNode: Node | undefined;

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

            if (node.isBlock && ((node.isLeaf && nodeText) || node.isTextblock) && blockSeparator) {
                if (first) {
                    first = false;
                } else {
                    // NOTE: Add a single newline character between `codeBlockLine`s instead of the
                    // default `blockSeparator` (which is usually double newlines).
                    if (
                        node.type.name === "codeBlockLine" &&
                        lastBlockNode?.type.name === "codeBlockLine"
                    ) {
                        text += "\n";
                    } else {
                        text += blockSeparator;
                    }
                }
                lastBlockNode = node;
            }
            text += nodeText;
        },
        0,
    );

    return text;
}

export function contentEditorTextClipboardSerializer(
    slice: Slice,
    getSpaceId: () => SpaceId,
    getContentReferences: () => ContentReferences,
): string {
    // Default clipboard text serializer plus extra support for mention nodes:
    // https://github.com/ProseMirror/prosemirror-view/blob/ab8f502cb69b1d97e2a606ec0a8b37f15b161baa/src/clipboard.ts#L36-L37

    return textBetweenWithCodeBlockLineBlockSeparator(
        slice.content,
        0,
        slice.content.size,
        "\n\n",
        node => {
            if (node.type.name === "mention") {
                const spaceId = getSpaceId();

                return renderContentMentionToTextForClient(
                    store => store.getSnapshot(),
                    node.attrs.mention,
                    getContentReferences(),
                    {
                        accountRegistry: getAccountRegistry(spaceId),
                        searchEntityRegistry: getSearchEntityRegistry(spaceId),
                        fileRegistry: getFileRegistry(spaceId),
                    },
                );
            }

            return "";
        },
    );
}
