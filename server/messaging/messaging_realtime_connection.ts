import {ProcessContext} from "~/server/dynamo/context/process_context";
import {RequestContext} from "~/server/dynamo/context/request_context";
import {getContentReferencesForNode} from "~/server/dynamo/helpers/get_content_references";
import {TestCheckpoint} from "~/server/helpers/test/test_checkpoint";
import {
    BackfillMessagesFunction,
    CreateMessageFunction,
    CreateMessageModelFunction,
    DeleteMessageFunction,
    UpdateMessageContentFunction,
} from "~/server/messaging/messaging_implementation";
import {AsyncMutex} from "~/shared/helpers/async/async_mutex";
import {runAllPromises} from "~/shared/helpers/async/run_all_promises";
import {assert} from "~/shared/helpers/control/assert";
import {exhaustive} from "~/shared/helpers/control/exhaustive";
import {filterMapIterable} from "~/shared/helpers/iterable/filter_map_iterable";
import {SessionId, SpaceId, WebSocketConnectionId} from "~/shared/id/types/id_types";
import {MessageChange, getMessageChangeTime} from "~/shared/messaging/message_change_schema";
import {
    MessagingRealtimeMessageFromClient,
    MessagingRealtimeMessageFromServer,
    MessagingTypingState,
} from "~/shared/messaging/messaging_realtime_schema";
import {MessageModel} from "~/shared/models/message_model";

export const messagingRealtimeBackfillMessagesBeforeFlushTestCheckpoint =
    new TestCheckpoint<SessionId>();

export const messagingRealtimeCreateMessageBeforeSendTestCheckpoint =
    new TestCheckpoint<SessionId>();

export class MessagingRealtimeConnection<
    RoomKey extends string,
    Message extends MessageModel<RoomKey>,
> {
    private readonly _connectionId: WebSocketConnectionId;
    private readonly _spaceId: SpaceId;
    private readonly _roomKey: RoomKey;
    private readonly _sendRealtimeMessage: (
        context: ProcessContext,
        message: MessagingRealtimeMessageFromServer<Message>,
    ) => void;
    private readonly _sendRealtimeMessageToOthers: (
        context: ProcessContext,
        message: MessagingRealtimeMessageFromServer<Message>,
    ) => void;
    private readonly _iterateOtherConnections: () => Iterable<
        MessagingRealtimeConnection<RoomKey, Message>
    >;
    private readonly _createMessageModel: CreateMessageModelFunction<RoomKey, Message>;
    private readonly _createMessage: CreateMessageFunction<RoomKey>;
    private readonly _updateMessageContent: UpdateMessageContentFunction<RoomKey>;
    private readonly _deleteMessage: DeleteMessageFunction<RoomKey>;
    private readonly _backfillMessages: BackfillMessagesFunction<RoomKey, Message>;

    /**
     * True while we are backfilling messages.
     */
    private _isBackfilling = true;

    /**
     * The next message index we will send to our client. We send messages to
     * clients in strict chronological order.
     */
    private _nextMessageIndexToSend: number | null = null;

    /**
     * Messages with indexes ahead of `_nextMessageIndexToSend` which we will
     * attempt to send after `_nextMessageIndexToSend` has been updated.
     */
    private _queuedNewMessages: Array<Message> = [];

    /**
     * Message changes that have been queued while we were backfilling. If we are
     * not backfilling this should always be an empty array.
     */
    private _queuedMessageChanges: Array<MessageChange> = [];

    /**
     * If we should show a typing indicator for this realtime connection then there
     * will be some typing state object in here.
     */
    private _typingState = new AsyncMutex<MessagingTypingState | null>(null);

    constructor({
        connectionId,
        spaceId,
        roomKey,
        sendMessage,
        sendMessageToOthers,
        iterateOtherConnections,
        createMessageModel,
        createMessage,
        updateMessageContent,
        deleteMessage,
        backfillMessages,
    }: {
        connectionId: WebSocketConnectionId;
        spaceId: SpaceId;
        roomKey: RoomKey;
        sendMessage: (
            context: ProcessContext,
            message: MessagingRealtimeMessageFromServer<Message>,
        ) => void;
        sendMessageToOthers: (
            context: ProcessContext,
            message: MessagingRealtimeMessageFromServer<Message>,
        ) => void;
        iterateOtherConnections: () => Iterable<MessagingRealtimeConnection<RoomKey, Message>>;
        createMessageModel: CreateMessageModelFunction<RoomKey, Message>;
        createMessage: CreateMessageFunction<RoomKey>;
        updateMessageContent: UpdateMessageContentFunction<RoomKey>;
        deleteMessage: DeleteMessageFunction<RoomKey>;
        backfillMessages: BackfillMessagesFunction<RoomKey, Message>;
    }) {
        this._connectionId = connectionId;
        this._spaceId = spaceId;
        this._roomKey = roomKey;
        this._sendRealtimeMessage = sendMessage;
        this._sendRealtimeMessageToOthers = sendMessageToOthers;
        this._iterateOtherConnections = iterateOtherConnections;
        this._createMessageModel = createMessageModel;
        this._createMessage = createMessage;
        this._updateMessageContent = updateMessageContent;
        this._deleteMessage = deleteMessage;
        this._backfillMessages = backfillMessages;
    }

    private _sendNewMessageAndClearTypingState(
        context: RequestContext,
        fromConnectionId: WebSocketConnectionId,
        message: Message,
    ) {
        // If this is not the next message for our client, either queue it for later or
        // ignore it if the message is behind our client.
        if (message.index !== this._nextMessageIndexToSend) {
            if (
                this._nextMessageIndexToSend === null ||
                message.index > this._nextMessageIndexToSend
            ) {
                // If the message needs to be queued for sending later, we still want to
                // immediately send our typing state update. In case another typing state
                // update happens later we don't want to clobber the update from this function.
                if (fromConnectionId !== this._connectionId) {
                    this._sendRealtimeMessage(context, {
                        type: "UpdateOtherTypingState",
                        connectionId: fromConnectionId,
                        typingState: null,
                    });
                }

                this._queuedNewMessages.push(message);
            }
            return;
        }

        this._sendRealtimeMessage(context, {
            type: "NewMessage",
            message,
            updateOtherTypingState:
                fromConnectionId !== this._connectionId
                    ? {
                          connectionId: fromConnectionId,
                          typingState: null,
                      }
                    : null,
        });
        this._nextMessageIndexToSend = message.index + 1;

        // Flush any queued messages now that our next message index has moved forward.
        this._flushQueuedMessages(context);
    }

    private _flushQueuedMessages(context: RequestContext) {
        // If this is null we won't be sending any messages.
        if (this._nextMessageIndexToSend === null) return;

        while (true) {
            const oldQueuedMessageLength = this._queuedNewMessages.length;

            this._queuedNewMessages = this._queuedNewMessages.filter(message => {
                assert(this._nextMessageIndexToSend !== null);

                // This is the next message for our client! Send it.
                if (message.index === this._nextMessageIndexToSend) {
                    this._sendRealtimeMessage(context, {
                        type: "NewMessage",
                        message,
                        updateOtherTypingState: null,
                    });
                    this._nextMessageIndexToSend = message.index + 1;
                    return false;
                }

                // If the message is in the past, we will never flush it so throw it away.
                if (message.index < this._nextMessageIndexToSend) {
                    return false;
                }

                return true;
            });

            // Exit the loop once we've processed all messages from our queue that can be
            // processed. We may have a queue that looks like this: `[3, 1, 2]`. In that
            // case 1 and 2 may be processed in the first iteration while 3 is processed in
            // the second iteration.
            if (oldQueuedMessageLength === this._queuedNewMessages.length) break;
        }
    }

    private _sendMessageChange(context: RequestContext, messageChange: MessageChange) {
        // Wait until we are done backfilling to send any message changes...
        if (this._isBackfilling) {
            this._queuedMessageChanges.push(messageChange);
            return;
        }

        this._sendRealtimeMessage(context, {
            type: "ChangeMessage",
            change: messageChange,
        });
    }

    private readonly _backfillMutex = new AsyncMutex(undefined);

    public async handleMessage(
        context: RequestContext,
        realtimeMessage: MessagingRealtimeMessageFromClient,
    ): Promise<void> {
        switch (realtimeMessage.type) {
            case "BackfillMessagesRequest": {
                // Execute our backfills sequentially so that our internal state is left in a
                // good state.
                await this._backfillMutex.run(async () => {
                    this._isBackfilling = true;
                    this._nextMessageIndexToSend = null;
                    this._queuedNewMessages = [];
                    this._queuedMessageChanges = [];

                    const {
                        messageCount,
                        lastMessageChangeTime,
                        newMessages,
                        newOtherReferencedMessages,
                        messageChangesResult,
                    } = await this._backfillMessages(
                        // Use a strong read consistency here so our durable object doesn't miss a
                        // message and stall (the connection queues new messages but never flushes
                        // because we missed an earlier message).
                        context.dynamo.setDefaultReadConsistency("Strong"),
                        {
                            roomKey: this._roomKey,
                            clientMessageCount: realtimeMessage.clientMessageCount,
                            clientLastMessageChangeTime:
                                realtimeMessage.clientLastMessageChangeTime,
                            newMessageLimit: realtimeMessage.newMessageLimit,
                        },
                    );

                    await messagingRealtimeBackfillMessagesBeforeFlushTestCheckpoint.waitForTest(
                        context.auth.getSessionId(),
                    );

                    this._sendRealtimeMessage(context, {
                        type: "BackfillMessagesResponse",
                        messageCount,
                        lastMessageChangeTime,
                        newMessages,
                        newOtherReferencedMessages,
                        messageChangesResult,
                        // NOTE(calebmer): In the following case:
                        //
                        // 1. Backfill starts for connection B
                        // 2. Connection A updates their typing state
                        // 3. Backfill response for connection B is created with connection A's
                        //    typing state
                        //
                        // We shouldn't have race conditions if connection A updates their typing state
                        // a second time after 3 because the rest of this code is synchronous. So we
                        // will send the backfill response and then later send connection A's typing
                        // state update. If you add asynchronous execution between the point where we
                        // send the backfill response and construct the typing state backfill, you may
                        // have added a race condition bug.
                        typingStateByConnectionId: new Map(
                            filterMapIterable(this._iterateOtherConnections(), connection => {
                                const typingState = connection._typingState.get();
                                if (typingState === null) return null;
                                return [connection._connectionId, typingState];
                            }),
                        ),
                    });

                    this._isBackfilling = false;

                    this._nextMessageIndexToSend = messageCount;
                    this._flushQueuedMessages(context);

                    // Send only the queued changes that occur after our backfill.
                    for (const messageChange of this._queuedMessageChanges) {
                        if (
                            !lastMessageChangeTime ||
                            getMessageChangeTime(messageChange) > lastMessageChangeTime
                        ) {
                            this._sendRealtimeMessage(context, {
                                type: "ChangeMessage",
                                change: messageChange,
                            });
                        }
                    }
                    this._queuedMessageChanges = [];
                });
                break;
            }
            case "CreateMessage": {
                const [{index, createdTime}, author, contentReferences] = await runAllPromises([
                    this._createMessage(context, {
                        ...realtimeMessage,
                        roomKey: this._roomKey,
                    }),
                    context.auth.getAccount(),
                    getContentReferencesForNode(context, this._spaceId, realtimeMessage.content),
                ]);

                await messagingRealtimeCreateMessageBeforeSendTestCheckpoint.waitForTest(
                    context.auth.getSessionId(),
                );

                await this._typingState.run(async (typingState, setTypingState) => {
                    // We clear the connection's typing state after they send a message.
                    setTypingState(null);

                    const newMessage = this._createMessageModel({
                        roomKey: this._roomKey,
                        index,
                        createdTime,
                        author,
                        payload: {
                            type: "Content",
                            parentMessageIndex: realtimeMessage.parentMessageIndex,
                            content: {
                                doc: realtimeMessage.content,
                                references: contentReferences,
                            },
                            contentUpdatedTime: null,
                        },
                    });

                    this._sendNewMessageAndClearTypingState(
                        context,
                        this._connectionId,
                        newMessage,
                    );

                    for (const connection of this._iterateOtherConnections())
                        connection._sendNewMessageAndClearTypingState(
                            context,
                            this._connectionId,
                            newMessage,
                        );
                });
                break;
            }
            case "UpdateMessageContent": {
                const [{contentUpdatedTime}, contentReferences] = await runAllPromises([
                    this._updateMessageContent(context, {
                        ...realtimeMessage,
                        roomKey: this._roomKey,
                    }),
                    getContentReferencesForNode(context, this._spaceId, realtimeMessage.content),
                ]);

                const messageChange: MessageChange = {
                    type: "UpdateContent",
                    index: realtimeMessage.messageIndex,
                    content: {
                        doc: realtimeMessage.content,
                        references: contentReferences,
                    },
                    contentUpdatedTime,
                };

                this._sendMessageChange(context, messageChange);

                for (const connection of this._iterateOtherConnections())
                    connection._sendMessageChange(context, messageChange);

                break;
            }
            case "DeleteMessage": {
                const {deletedTime} = await this._deleteMessage(context, {
                    ...realtimeMessage,
                    roomKey: this._roomKey,
                });

                const messageChange: MessageChange = {
                    type: "Delete",
                    index: realtimeMessage.messageIndex,
                    deletedTime,
                };

                this._sendMessageChange(context, messageChange);

                for (const connection of this._iterateOtherConnections())
                    connection._sendMessageChange(context, messageChange);

                break;
            }
            case "StartTyping": {
                await this._startTyping(context);
                break;
            }
            case "StopTyping": {
                await this._stopTyping(context);
                break;
            }
            default:
                throw exhaustive(realtimeMessage);
        }
    }

    public handleClose(context: ProcessContext) {
        context.process.waitUntil(this._stopTyping(context));
    }

    private async _startTyping(context: RequestContext) {
        await this._typingState.run(async (oldTypingState, setTypingState) => {
            if (oldTypingState !== null) return;

            const typingState: MessagingTypingState = {
                isTyping: true,
                startTime: new Date(),
                account: await context.auth.getAccount(),
            };

            setTypingState(typingState);

            this._sendRealtimeMessageToOthers(context, {
                type: "UpdateOtherTypingState",
                connectionId: this._connectionId,
                typingState,
            });
        });
    }

    // The stop typing function needs to be called outside of a `RequestContext`
    // when the connection is closing. This means it may not have authorization
    // information.
    private async _stopTyping(context: ProcessContext) {
        await this._typingState.run(async (oldTypingState, setTypingState) => {
            if (oldTypingState === null) return;

            setTypingState(null);

            this._sendRealtimeMessageToOthers(context, {
                type: "UpdateOtherTypingState",
                connectionId: this._connectionId,
                typingState: null,
            });
        });
    }
}
