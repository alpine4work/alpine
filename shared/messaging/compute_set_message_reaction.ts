import {Node} from "prosemirror-model";
import {isContentEmpty} from "~/shared/content/is_content_empty.js";
import {FailedPreconditionError, InvalidArgumentError} from "~/shared/error/error.js";
import {emptyArray} from "~/shared/helpers/array/empty_array.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {unwrapResult} from "~/shared/helpers/control/capture_result.js";
import {Result} from "~/shared/helpers/control/result.js";
import {AccountId} from "~/shared/id/types/id_types.js";
import {MessageContentProsemirrorSchema} from "~/shared/messaging/message_content_schema.js";
import {
    MessageContentPayload,
    MessagePayload,
    MessageStream,
} from "~/shared/messaging/message_schema.js";
import {Reaction} from "~/shared/reactions/reaction.js";
import {ReactionSet} from "~/shared/reactions/reaction_set.js";

/**
 * Computes the new `reactionsByPos` map for a message based on the position
 * the client reacted to. Doesn't actually update the message in the database.
 * Only performs the necessary validations and data structure update logic.
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
    pos: number;
    reaction: Reaction | "GenericLike";
}): MessageContentPayload {
    const {payload, pos} = unwrapResult(
        findMessageReactionPosIfPossible({
            message,
            contentVersion: clientContentVersion,
            pos: clientPos,
        }),
    );

    // Throw if the client doesn't get the position right. While we could be
    // forgiving here and use the correct `pos`, we choose to be unforgiving
    // to make sure the client has correct `pos` calculation logic.
    //
    // The client needs a correct `pos` calculation implementation to know if the
    // user has already reacted to an arbitrary range of text in the message.
    if (
        (payload.contentUpdate?.mappings.length ?? 0) === clientContentVersion &&
        pos !== clientPos
    ) {
        throw new FailedPreconditionError(
            "Can only set reaction on position immediately after a block node",
        );
    }

    const newReactionsByPos = new Map(payload.reactionsByPos);
    const newReactions = new Map(newReactionsByPos.get(pos)?.get());
    newReactions.set(actorAccountId, reaction);
    newReactionsByPos.set(pos, new ReactionSet(newReactions));

    return {...payload, reactionsByPos: newReactionsByPos};
}

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
}> {
    if (message.payload.type !== "Content") {
        return {
            ok: false,
            error: new FailedPreconditionError(
                "Can’t set reaction on messages with a non-content payload",
            ),
        };
    }

    let content: Node;

    if (message.stream === null) {
        content = message.payload.content;
    } else {
        const newContent: Array<Node> = [];

        if (!isContentEmpty(message.payload.content)) {
            for (const node of message.payload.content.content.content) {
                newContent.push(node);
            }
        }

        const usableStreamPartCount =
            message.stream.parts.length -
            // If the stream is incomplete then we can't react to the last part. Since the
            // last part may still be receiving updates.
            (message.stream.completedTime === null ? 1 : 0);

        for (let i = 0; i < usableStreamPartCount; i++) {
            const part = message.stream.parts[i]!;
            if (part.payload.type !== "Content") continue;

            for (const node of part.payload.content.content.content) {
                newContent.push(node);
            }
        }

        content = MessageContentProsemirrorSchema.node("doc", {}, newContent);
    }

    const contentVersion = message.payload.contentUpdate?.mappings.length ?? 0;

    if (clientContentVersion < 0) {
        return {
            ok: false,
            error: new InvalidArgumentError("Can’t set reaction with negative content version"),
        };
    }

    if (clientContentVersion > contentVersion) {
        return {
            ok: false,
            error: new FailedPreconditionError("Can’t set reaction with future content version"),
        };
    }

    const mappings =
        contentVersion > clientContentVersion
            ? message.payload.contentUpdate?.mappings.slice(
                  -(contentVersion - clientContentVersion),
              ) ?? emptyArray
            : emptyArray;

    for (const mapping of mappings) {
        clientPos = mapping.map(clientPos, 1);
    }

    if (clientPos < 0) {
        return {
            ok: false,
            error: new InvalidArgumentError("Can’t set reaction with negative position"),
        };
    }

    // Selection is out of bounds. This may happen if the selection is in the last
    // part of a message stream that hasn't completed. That last incomplete part
    // won't be added to the `content` variable created in this function.
    if (clientPos > content.content.size) {
        return {
            ok: false,
            error: new FailedPreconditionError(
                "Can’t set reaction with position outside the message’s bounds",
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
                "Can’t set reaction on the content’s start position",
            ),
        };
    }

    return {
        ok: true,
        value: {
            payload: message.payload,
            pos,
        },
    };
}
