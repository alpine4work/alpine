import {Node} from "prosemirror-model";
import {ContentMention} from "~/shared/content/content_mention.js";
import {concatIterables} from "~/shared/helpers/iterable/concat_iterables.js";
import {ContentMentionAccountId} from "~/shared/id/types/id_types.js";
import {visitProsemirrorNode} from "~/shared/prosemirror/prosemirror_visitor.js";

/**
 * Get all the mentioned accounts in some content.
 */
export function getMentionedAccountIdsInContent(
    content: Node,
): ReadonlySet<ContentMentionAccountId> {
    return new Set(getMentionCountByAccountIdInContent(content).keys());
}

/**
 * Get all mentions in the content and the number of times they appear.
 */
export function getMentionCountByAccountIdInContent(
    content: Node,
): ReadonlyMap<ContentMentionAccountId, number> {
    const mentionCountByAccountId = new Map<ContentMentionAccountId, number>();

    visitProsemirrorNode(content, {
        visitNode: node => {
            if (node.type.name === "mention") {
                const mention: ContentMention = node.attrs.mention;
                if (mention.type !== "Account") return;
                const lastMentionCount = mentionCountByAccountId.get(mention.accountId);
                mentionCountByAccountId.set(mention.accountId, (lastMentionCount ?? 0) + 1);
            }
        },
    });

    return mentionCountByAccountId;
}

/**
 * Sometimes we keep an aggregated map of mention counts by account. When some
 * content updates we want to update that map. This function takes the old
 * aggregated map and produces a new aggregated map.
 *
 * Pass in null for old content if you are creating new content. Pass in null
 * for new content if you are deleting old content.
 */
export function applyMentionCountByAccountIdDifferenceFromContentUpdate(
    mentionCountByAccountId: ReadonlyMap<ContentMentionAccountId, number>,
    oldContent: Node | null,
    newContent: Node | null,
): ReadonlyMap<ContentMentionAccountId, number> {
    const oldMentionCountByAccountId = oldContent
        ? getMentionCountByAccountIdInContent(oldContent)
        : new Map();
    const newMentionCountByAccountId = newContent
        ? getMentionCountByAccountIdInContent(newContent)
        : new Map();

    const updatedMentionCountByAccountId = new Map(mentionCountByAccountId);

    for (const accountId of new Set(
        concatIterables(oldMentionCountByAccountId.keys(), newMentionCountByAccountId.keys()),
    )) {
        const oldMentionCount = oldMentionCountByAccountId.get(accountId) ?? 0;
        const newMentionCount = newMentionCountByAccountId.get(accountId) ?? 0;
        const mentionCountDifference = newMentionCount - oldMentionCount;

        // Remember: If the mention count goes to zero we want to keep it in our map to
        // signal "this account was mentioned at some point".
        updatedMentionCountByAccountId.set(
            accountId,
            (updatedMentionCountByAccountId.get(accountId) ?? 0) + mentionCountDifference,
        );
    }

    return updatedMentionCountByAccountId;
}
