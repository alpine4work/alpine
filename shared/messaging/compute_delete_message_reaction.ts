import {FailedPreconditionError} from "~/shared/error/error.open_source.js";
import {unwrapResult} from "~/shared/helpers/control/capture_result.open_source.js";
import {AccountId} from "~/shared/id/types/id_types.open_source.js";
import {findMessageReactionPosIfPossible} from "~/shared/messaging/compute_set_message_reaction.js";
import {
    MessageContentPayload,
    MessagePayload,
    MessageStream,
} from "~/shared/messaging/message_schema.js";
import {ReactionSet} from "~/shared/reactions/reaction_set.js";

/**
 * Computes the new `reactionsByPos` map for a message based on the position the
 * client removed their reaction from. Doesn't actually update the message in the
 * database. Only performs the necessary validations and data structure update
 * logic.
 */
export function computeDeleteMessageReaction({
    actorAccountId,
    message,
    contentVersion: clientContentVersion,
    pos: clientPos,
}: {
    actorAccountId: AccountId;
    message: {
        payload: MessagePayload;
        stream: MessageStream | null;
    };
    contentVersion: number;
    pos: number | "Files";
}): MessageContentPayload {
    if (clientPos === "Files") {
        if (message.payload.type !== "Content") {
            throw new FailedPreconditionError(
                "Can\u2019t set reaction on messages with a non-content payload",
            );
        }

        const newFilesReactions = new Map(message.payload.filesReactions.get());
        newFilesReactions.delete(actorAccountId);

        return {...message.payload, filesReactions: new ReactionSet(newFilesReactions)};
    }

    const {payload, pos, range} = unwrapResult(
        findMessageReactionPosIfPossible({
            message,
            contentVersion: clientContentVersion,
            pos: clientPos,
        }),
    );

    // Throw if the client doesn't get the position right. While we could be forgiving
    // here and use the correct `pos`, we choose to be unforgiving to make sure the
    // client has correct `pos` calculation logic.
    //
    // The client needs a correct `pos` calculation implementation to know if the user
    // has already reacted to an arbitrary range of text in the message.
    if (
        message.stream === null &&
        (payload.contentUpdate?.mappings.length ?? 0) === clientContentVersion &&
        pos !== clientPos
    ) {
        throw new FailedPreconditionError(
            "Can only delete reaction on position immediately after a block node",
        );
    }

    const newReactionsByPos = new Map(payload.reactionsByPos);

    if (message.stream !== null) {
        for (const [existingPos, existingReactions] of newReactionsByPos) {
            if (existingPos <= range.from || existingPos > range.to) continue;

            const newExistingReactions = new Map(existingReactions.get());
            newExistingReactions.delete(actorAccountId);

            if (newExistingReactions.size === 0) {
                newReactionsByPos.delete(existingPos);
            } else {
                newReactionsByPos.set(existingPos, new ReactionSet(newExistingReactions));
            }
        }
    } else {
        const newReactions = new Map(newReactionsByPos.get(pos)?.get());
        newReactions.delete(actorAccountId);

        // If there are no reactions left then remove the full `ReactionSet` itself.
        if (newReactions.size === 0) {
            newReactionsByPos.delete(pos);
        } else {
            newReactionsByPos.set(pos, new ReactionSet(newReactions));
        }
    }

    return {...payload, reactionsByPos: newReactionsByPos};
}
