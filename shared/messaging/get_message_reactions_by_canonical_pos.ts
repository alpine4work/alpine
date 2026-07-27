import {getMessageReactionContentRanges} from "~/shared/messaging/get_message_reaction_content_ranges.js";
import {MessagePayload, MessageStream} from "~/shared/messaging/message_schema.js";
import {ReactionSet} from "~/shared/reactions/reaction_set.js";

/**
 * Returns reactions keyed by the canonical block-end position where they should be
 * displayed.
 *
 * Stream content may have reactions stored at positions that were correct before a
 * stream part grew. This folds those positions back onto the current block
 * boundary.
 */
export function getMessageReactionsByCanonicalPos({
    message,
}: {
    message: {
        payload: MessagePayload;
        stream: MessageStream | null;
    };
}): ReadonlyMap<number, ReactionSet> {
    if (message.payload.type !== "Content") return new Map();
    if (message.stream === null) return message.payload.reactionsByPos;

    const ranges = getMessageReactionContentRanges({
        payload: message.payload,
        stream: message.stream,
    });
    const reactionsByCanonicalPos = new Map<number, ReactionSet>();

    for (const [pos, reactions] of message.payload.reactionsByPos) {
        const range = ranges.find(range => pos > range.from && pos <= range.to);
        const canonicalPos = range?.to ?? pos;
        const newReactions = new Map(reactionsByCanonicalPos.get(canonicalPos)?.get());

        for (const [accountId, reaction] of reactions.get()) {
            // If two stored positions collapse to the same canonical block, keep the first
            // reaction for each account so display remains stable.
            if (!newReactions.has(accountId)) {
                newReactions.set(accountId, reaction);
            }
        }

        reactionsByCanonicalPos.set(canonicalPos, new ReactionSet(newReactions));
    }

    return reactionsByCanonicalPos;
}
