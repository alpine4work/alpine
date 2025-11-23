import {Reporter} from "~/client/web/design/reporter.js";
import {InboxContext} from "~/client/web/inbox/inbox_context_types.js";
import {MessageList} from "~/client/web/messaging/message_list.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {AccountId} from "~/shared/id/types/id_types.js";
import {findMessageReactionPosIfPossible} from "~/shared/messaging/compute_set_message_reaction.js";
import {MessageModel, fromMessagePayloadModel} from "~/shared/messaging/message_model.js";
import {Reaction, areReactionsEqual} from "~/shared/reactions/reaction.js";
import {ReactionSet} from "~/shared/reactions/reaction_set.js";

export type OnSetMessageReactionFunction<RoomKey extends string> = (
    roomKey: RoomKey,
    input: {
        messageIndex: number;
        contentVersion: number;
        pos: number;
        reaction: Reaction | "GenericLike";
    },
) => Promise<void>;

export type OnDeleteMessageReactionFunction<RoomKey extends string> = (
    roomKey: RoomKey,
    input: {
        messageIndex: number;
        contentVersion: number;
        pos: number;
    },
) => Promise<void>;

export type OnUpdateMessagesOptimisticallyFunction<
    RoomKey extends string,
    Message extends MessageModel<RoomKey>,
> = <PromiseValue>(
    roomKey: RoomKey,
    promise: Promise<PromiseValue>,
    update: (
        messages: MessageList<Message>,
        promiseValue: PromiseValue | undefined,
    ) => MessageList<Message>,
) => void;

export function setMessageReactionWithOptimisticUpdate<
    RoomKey extends string,
    Message extends MessageModel<RoomKey>,
>({
    reporter,
    currentAccountId,
    messageNoun,
    roomKey,
    messageIndex,
    contentVersion: originalContentVersion,
    pos: originalPos,
    reaction,
    onSetMessageReaction,
    onUpdateMessagesOptimistically,
    inboxContext,
}: {
    reporter: Reporter;
    currentAccountId: AccountId;
    messageNoun: string;
    roomKey: RoomKey;
    messageIndex: number;
    contentVersion: number;
    pos: number;
    reaction: Reaction | "GenericLike";
    onSetMessageReaction: OnSetMessageReactionFunction<RoomKey>;
    onUpdateMessagesOptimistically: OnUpdateMessagesOptimisticallyFunction<RoomKey, Message>;
    inboxContext: InboxContext | null;
}) {
    const promise = onSetMessageReaction(roomKey, {
        messageIndex,
        contentVersion: originalContentVersion,
        pos: originalPos,
        reaction,
    }).then<true>(() => true);

    promise.catch(error => {
        reporter.displayError(`Couldn’t add reaction to ${messageNoun}`, error);
    });

    // Adding a reaction archives the inbox entry for the messaging room.
    // Optimistically archive these entries so we don't need to wait for
    // realtime. The latency of which may be long since notification events are
    // processed by a queue.
    inboxContext?.onSetMessageReactionOptimistically(promise, roomKey);

    onUpdateMessagesOptimistically(roomKey, promise, (messages, promiseValue) => {
        // We expect the `MessagingRealtimeConnection` WebSocket to send an event that
        // updates the message with the new reaction BEFORE the promise returned by
        // `setMessageReaction()` resolves. So if we have a promise value, do nothing!
        if (promiseValue) return messages;

        return messages.updateMessage(messageIndex, message => {
            const result = findMessageReactionPosIfPossible({
                message: {
                    payload: fromMessagePayloadModel(message.payload),
                    stream: message.stream,
                },
                contentVersion: originalContentVersion,
                pos: originalPos,
            });
            if (!result.ok) return message;

            const {payload, pos} = result.value;
            assert(message.payload.type === payload.type);

            // If the reaction is already set, don't update the message. This'll happen
            // after we get the realtime message from the server adding the reaction. Which
            // will happen before `promise` resolves.
            if (
                areReactionsEqual(
                    payload.reactionsByPos.get(pos)?.get().get(currentAccountId),
                    reaction,
                )
            ) {
                return message;
            }

            const newReactionsByPos = new Map(payload.reactionsByPos);
            const newReactions = new Map(newReactionsByPos.get(pos)?.get());
            newReactions.set(currentAccountId, reaction);
            newReactionsByPos.set(pos, new ReactionSet(newReactions));

            return message.clone({
                // In the optimistic update code path we increment the version to simulate
                // what the server will do. When the promise resolves this function will
                // re-run with a `promiseValue` that's not undefined and we'll NOT run this
                // optimistic code path since we will have received a message from the
                // WebSocket with the correct message at the correct version.
                version: message.version + 1,

                payload: {
                    ...message.payload,
                    reactionsByPos: newReactionsByPos,
                },
            });
        });
    });
}

export function deleteMessageReactionWithOptimisticUpdate<
    RoomKey extends string,
    Message extends MessageModel<RoomKey>,
>({
    reporter,
    currentAccountId,
    messageNoun,
    roomKey,
    messageIndex,
    contentVersion: originalContentVersion,
    pos: originalPos,
    onDeleteMessageReaction,
    onUpdateMessagesOptimistically,
}: {
    reporter: Reporter;
    currentAccountId: AccountId;
    messageNoun: string;
    roomKey: RoomKey;
    messageIndex: number;
    contentVersion: number;
    pos: number;
    onDeleteMessageReaction: OnDeleteMessageReactionFunction<RoomKey>;
    onUpdateMessagesOptimistically: OnUpdateMessagesOptimisticallyFunction<RoomKey, Message>;
}) {
    const promise = onDeleteMessageReaction(roomKey, {
        messageIndex,
        contentVersion: originalContentVersion,
        pos: originalPos,
    }).then<true>(() => true);

    promise.catch(error => {
        reporter.displayError(`Couldn’t remove reaction from ${messageNoun}`, error);
    });

    onUpdateMessagesOptimistically(roomKey, promise, (messages, promiseValue) => {
        // We expect the `MessagingRealtimeConnection` WebSocket to send an event that
        // updates the message with the new reaction BEFORE the promise returned by
        // `setMessageReaction()` resolves. So if we have a promise value, do nothing!
        if (promiseValue) return messages;

        return messages.updateMessage(messageIndex, message => {
            const result = findMessageReactionPosIfPossible({
                message: {
                    payload: fromMessagePayloadModel(message.payload),
                    stream: message.stream,
                },
                contentVersion: originalContentVersion,
                pos: originalPos,
            });
            if (!result.ok) return message;

            const {payload, pos} = result.value;
            assert(message.payload.type === payload.type);

            // If the reaction is already deleted, don't update the message. This'll happen
            // after we get the realtime message from the server deleting the reaction.
            // Which will happen before `promise` resolves.
            if (!payload.reactionsByPos.get(pos)?.get().has(currentAccountId)) {
                return message;
            }

            const newReactionsByPos = new Map(payload.reactionsByPos);
            const newReactions = new Map(newReactionsByPos.get(pos)?.get());
            newReactions.delete(currentAccountId);

            // If there are no reactions left then remove the full `ReactionSet`
            // itself.
            if (newReactions.size === 0) {
                newReactionsByPos.delete(pos);
            } else {
                newReactionsByPos.set(pos, new ReactionSet(newReactions));
            }

            return message.clone({
                // In the optimistic update code path we increment the version to simulate
                // what the server will do. When the promise resolves this function will
                // re-run with a `promiseValue` that's not undefined and we'll NOT run this
                // optimistic code path since we will have received a message from the
                // WebSocket with the correct message at the correct version.
                version: message.version + 1,

                payload: {
                    ...message.payload,
                    reactionsByPos: newReactionsByPos,
                },
            });
        });
    });
}
