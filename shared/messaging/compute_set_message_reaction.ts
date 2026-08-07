import {FailedPreconditionError, InvalidArgumentError} from "~/shared/error/error.open_source.js";
import {assert} from "~/shared/helpers/control/assert.open_source.js";
import {unwrapResult} from "~/shared/helpers/control/capture_result.open_source.js";
import {Result} from "~/shared/helpers/control/result.open_source.js";
import {AccountId} from "~/shared/id/types/id_types.open_source.js";
import {getMessageReactionContentRanges} from "~/shared/messaging/get_message_reaction_content_ranges.js";
import {mapMessagePosFromContentVersion} from "~/shared/messaging/map_message_pos_from_content_version.js";
import {
    MessageContentPayload,
    MessagePayload,
    MessageStream,
} from "~/shared/messaging/message_schema.js";
import {Reaction} from "~/shared/reactions/reaction.js";
import {ReactionSet} from "~/shared/reactions/reaction_set.js";

/**
 * Computes the new `reactionsByPos` map for a message based on the position the
 * client reacted to. Doesn't actually update the message in the database. Only
 * performs the necessary validations and data structure update logic.
 */
export function computeSetMessageReaction({
    actorAccountId,
    message,
    contentVersion: clientContentVersion,
    pos: clientPos,
    reaction,
}: {
    actorAccountId: AccountId;
    message: {
        payload: MessagePayload;
        stream: MessageStream | null;
    };
    contentVersion: number;
    pos: number | "Files";
    reaction: Reaction | "GenericLike";
}): MessageContentPayload {
    if (clientPos === "Files") {
        if (message.payload.type !== "Content") {
            throw new FailedPreconditionError(
                "Can\u2019t set reaction on messages with a non-content payload",
            );
        }

        const newFilesReactions = new Map(message.payload.filesReactions.get());
        newFilesReactions.set(actorAccountId, reaction);

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
            "Can only set reaction on position immediately after a block node",
        );
    }

    const newReactionsByPos = new Map(payload.reactionsByPos);

    if (message.stream !== null) {
        // Stream parts can grow while a reaction is being set, which can leave older
        // reactions for the same account at stale positions inside the same block range.
        // Keep only the canonical block-end position.
        for (const [existingPos, existingReactions] of newReactionsByPos) {
            if (existingPos <= range.from || existingPos > range.to || existingPos === pos) {
                continue;
            }

            const newExistingReactions = new Map(existingReactions.get());
            newExistingReactions.delete(actorAccountId);

            if (newExistingReactions.size === 0) {
                newReactionsByPos.delete(existingPos);
            } else {
                newReactionsByPos.set(existingPos, new ReactionSet(newExistingReactions));
            }
        }
    }

    const newReactions = new Map(newReactionsByPos.get(pos)?.get());
    newReactions.set(actorAccountId, reaction);
    newReactionsByPos.set(pos, new ReactionSet(newReactions));

    return {...payload, reactionsByPos: newReactionsByPos};
}

/**
 * Finds the canonical content block-end position for a message reaction.
 *
 * For regular messages this mirrors ProseMirror's block-boundary lookup. For
 * streams, it searches the combined message content and stream content ranges
 * without materializing a synthetic document.
 */
export function findMessageReactionPosIfPossible({
    message,
    contentVersion: clientContentVersion,
    pos: clientPos,
}: {
    message: {
        payload: MessagePayload;
        stream: MessageStream | null;
    };
    contentVersion: number;
    pos: number;
}): Result<{
    payload: MessageContentPayload;
    pos: number;
    range: {from: number; to: number};
}> {
    if (message.payload.type !== "Content") {
        return {
            ok: false,
            error: new FailedPreconditionError(
                "Can\u2019t set reaction on messages with a non-content payload",
            ),
        };
    }

    const contentVersion = message.payload.contentUpdate?.mappings.length ?? 0;

    if (clientContentVersion < 0) {
        return {
            ok: false,
            error: new InvalidArgumentError(
                "Can\u2019t set reaction with negative content version",
            ),
        };
    }

    if (clientContentVersion > contentVersion) {
        return {
            ok: false,
            error: new FailedPreconditionError(
                "Can\u2019t set reaction with future content version",
            ),
        };
    }

    clientPos = mapMessagePosFromContentVersion(
        message.payload,
        clientContentVersion,
        clientPos,
        1,
    );

    if (clientPos < 0) {
        return {
            ok: false,
            error: new InvalidArgumentError("Can\u2019t set reaction with negative position"),
        };
    }

    if (message.stream === null) {
        const content = message.payload.content;

        if (clientPos > content.content.size) {
            return {
                ok: false,
                error: new FailedPreconditionError(
                    "Can\u2019t set reaction with position outside the message\u2019s bounds",
                ),
            };
        }

        const $clientPos = content.resolve(clientPos);
        const pos = $clientPos.after(1);
        const $pos = content.resolve(pos);

        // Creating `pos` with `.after(1)` means we should be at the root level.
        assert($pos.depth === 0);

        if (!$pos.nodeBefore) {
            return {
                ok: false,
                error: new FailedPreconditionError(
                    "Can\u2019t set reaction on the content\u2019s start position",
                ),
            };
        }

        return {
            ok: true,
            value: {
                payload: message.payload,
                pos,
                range: {from: pos - $pos.nodeBefore.nodeSize, to: pos},
            },
        };
    }

    const ranges = getMessageReactionContentRanges({
        payload: message.payload,
        stream: message.stream,
    });
    const contentSize = ranges[ranges.length - 1]?.to ?? 0;

    if (ranges.length === 0 || clientPos > contentSize) {
        return {
            ok: false,
            error: new FailedPreconditionError(
                "Can\u2019t set reaction with position outside the message\u2019s bounds",
            ),
        };
    }

    for (const range of ranges) {
        // Ranges are open on the left and closed on the right because reaction positions
        // live immediately after block nodes.
        if (clientPos <= range.from || clientPos > range.to) continue;

        return {
            ok: true,
            value: {
                payload: message.payload,
                pos: range.to,
                range,
            },
        };
    }

    return {
        ok: false,
        error: new FailedPreconditionError(
            "Can\u2019t set reaction on the content\u2019s start position",
        ),
    };
}
