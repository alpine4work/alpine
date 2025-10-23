import {Mapping} from "prosemirror-transform";
import {assert} from "~/shared/helpers/control/assert.js";
import {AccountId} from "~/shared/id/types/id_types.js";
import {MessageContent} from "~/shared/messaging/message_content_schema.js";
import {MessageContentPayload} from "~/shared/messaging/message_schema.js";
import {Reaction} from "~/shared/reactions/reaction.js";
import {ReactionSet} from "~/shared/reactions/reaction_set.js";

export function computeUpdateMessageContentReactions({
    oldPayload,
    newContent,
    mapping,
}: {
    oldPayload: MessageContentPayload;
    newContent: MessageContent;
    mapping: Mapping;
}) {
    // Currently we don't support updating stream message content. If we did
    // support update stream message content then there's some extra complexity
    // here we need to handle. Specifically, we treat stream messages with empty
    // paragraph content as if the content doesn't exist. So if you update a
    // message with empty paragraph content to a message without empty paragraph
    // content (and vice versa) we need to apply additional position mapping to
    // message reactions!
    //
    // This assert is here so if we ever add support for updating stream messages
    // this assert will start throwing which forces future developers to read this
    // comment and handle the new edge case.
    assert(oldPayload.clerical?.type !== "Stream");

    const newReactionsByPos = new Map<number, ReactionSet>();

    // Iterate in `pos` order. Not map insertion order.
    const sortedOldReactionsByPosEntries = Array.from(oldPayload.reactionsByPos).sort(
        ([pos1], [pos2]) => pos1 - pos2,
    );

    for (const [oldPos, reactions] of sortedOldReactionsByPosEntries) {
        const oldPosMapped = mapping.map(oldPos, 1);
        const $oldPosMapped = newContent.resolve(oldPosMapped);
        const newPos = $oldPosMapped.after(1);

        const existingReactions = newReactionsByPos.get(newPos);
        if (!existingReactions) {
            newReactionsByPos.set(newPos, reactions);
        } else {
            const mergedReactions = new Map<AccountId, Reaction | "GenericLike">(
                existingReactions.get(),
            );

            for (const [accountId, reaction] of reactions.get()) {
                // If we're replacing a reaction that already existed for the `AccountId` then
                // delete the old one so it's added to the end of the `Map`s order instead of
                // using the old order.
                if (mergedReactions.has(accountId)) {
                    mergedReactions.delete(accountId);
                }

                mergedReactions.set(accountId, reaction);
            }

            newReactionsByPos.set(newPos, new ReactionSet(mergedReactions));
        }
    }

    return newReactionsByPos;
}
