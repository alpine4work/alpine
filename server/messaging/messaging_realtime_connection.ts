import {
    WorkerActionContext,
    WorkerSessionActionContext,
} from "~/server/cloudflare/context/worker_action_context.js";
import {WorkerProcessContext} from "~/server/cloudflare/context/worker_process_context.js";
import {getContentReferencesForNode} from "~/server/dynamo/helpers/get_content_references.js";
import {TestCheckpoint} from "~/server/helpers/test/test_checkpoint.js";
import {
    BackfillMessagesFunction,
    CreateMessageFunction,
    CreateMessageModelFunction,
    DeleteMessageFunction,
    UpdateMessageContentFunction,
} from "~/server/messaging/messaging_implementation.js";
import {AsyncMutex} from "~/shared/helpers/async/async_mutex.js";
import {runAllPromises} from "~/shared/helpers/async/run_all_promises.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {filterMapIterable} from "~/shared/helpers/iterable/filter_map_iterable.js";
import {AccountId, SpaceId, WebSocketConnectionId} from "~/shared/id/types/id_types.js";
import {MessageChange, getMessageChangeTime} from "~/shared/messaging/message_change_schema.js";
import {MessageContent} from "~/shared/messaging/message_content_schema.js";
import {MessageModel} from "~/shared/messaging/message_model.js";
import {
    MessagingRealtimeEvent,
    MessagingTypingState,
} from "~/shared/messaging/messaging_realtime_protocol.js";

export const messagingRealtimeBackfillMessagesBeforeFlushTestCheckpoint =
    new TestCheckpoint<AccountId>();

export const messagingRealtimeCreateMessageBeforeSendTestCheckpoint =
    new TestCheckpoint<AccountId>();

export class MessagingRealtimeConnection<
    RoomKey extends string,
    Message extends MessageModel<RoomKey>,
> {
    private readonly _connectionId: WebSocketConnectionId;
    private readonly _spaceId: SpaceId;
    private readonly _roomKey: RoomKey;
    private readonly _sendEvent: (
        context: WorkerProcessContext,
        event: MessagingRealtimeEvent<Message>,
    ) => void;
    private readonly _sendEventToOthers: (
        context: WorkerProcessContext,
        event: MessagingRealtimeEvent<Message>,
    ) => void;
    private readonly _iterateOtherConnections: () => Iterable<
        MessagingRealtimeConnection<RoomKey, Message>
    >;
    private readonly _createMessageModel: CreateMessageModelFunction<RoomKey, Message>;
    private readonly _createMessage: CreateMessageFunction<WorkerSessionActionContext, RoomKey>;
    private readonly _updateMessageContent: UpdateMessageContentFunction<
        WorkerSessionActionContext,
        RoomKey
    >;
    private readonly _deleteMessage: DeleteMessageFunction<WorkerSessionActionContext, RoomKey>;
    private readonly _backfillMessages: BackfillMessagesFunction<
        WorkerSessionActionContext,
        RoomKey,
        Message
    >;

    /**
     * True while we are backfilling messages.
     */
    private _isBackfilling = false;

    /**
     * The next message index we will send to our client. If set then we will
     * send messages to clients in strict chronological order. If null then we
     * will send messages to clients when we get them.
     *
     * This "chaos" mode where messages are sent in any order is how the connection
     * starts but then we go into strict sequential mode after the first backfill.
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
        sendEvent,
        sendEventToOthers,
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
        sendEvent: (context: WorkerProcessContext, event: MessagingRealtimeEvent<Message>) => void;
        sendEventToOthers: (
            context: WorkerProcessContext,
            event: MessagingRealtimeEvent<Message>,
        ) => void;
        iterateOtherConnections: () => Iterable<MessagingRealtimeConnection<RoomKey, Message>>;
        createMessageModel: CreateMessageModelFunction<RoomKey, Message>;
        createMessage: CreateMessageFunction<WorkerSessionActionContext, RoomKey>;
        updateMessageContent: UpdateMessageContentFunction<WorkerSessionActionContext, RoomKey>;
        deleteMessage: DeleteMessageFunction<WorkerSessionActionContext, RoomKey>;
        backfillMessages: BackfillMessagesFunction<WorkerSessionActionContext, RoomKey, Message>;
    }) {
        this._connectionId = connectionId;
        this._spaceId = spaceId;
        this._roomKey = roomKey;
        this._sendEvent = sendEvent;
        this._sendEventToOthers = sendEventToOthers;
        this._iterateOtherConnections = iterateOtherConnections;
        this._createMessageModel = createMessageModel;
        this._createMessage = createMessage;
        this._updateMessageContent = updateMessageContent;
        this._deleteMessage = deleteMessage;
        this._backfillMessages = backfillMessages;
    }

    private static _sendNewMessageAndClearTypingState<
        RoomKey extends string,
        Message extends MessageModel<RoomKey>,
    >(
        context: WorkerActionContext,
        fromConnection: MessagingRealtimeConnection<RoomKey, Message>,
        toConnection: MessagingRealtimeConnection<RoomKey, Message>,
        message: Message,
    ) {
        // If the connection is backfilling or we received this message out of order,
        // queue it for later. If we have not received a message yet then we want to
        // send it and start waiting for the message after it.
        if (
            toConnection._isBackfilling ||
            (toConnection._nextMessageIndexToSend !== null &&
                message.index !== toConnection._nextMessageIndexToSend)
        ) {
            if (
                toConnection._nextMessageIndexToSend === null ||
                message.index > toConnection._nextMessageIndexToSend
            ) {
                // If the message needs to be queued for sending later, we still want to
                // immediately send our typing state update. In case another typing state
                // update happens later we don't want to clobber the update from this function.
                if (
                    fromConnection._connectionId !== toConnection._connectionId &&
                    fromConnection._typingState.get() !== null
                ) {
                    toConnection._sendEvent(context, {
                        type: "UpdateOtherTypingState",
                        connectionId: fromConnection._connectionId,
                        typingState: null,
                    });
                }

                toConnection._queuedNewMessages.push(message);
            }
            return;
        }

        toConnection._sendEvent(context, {
            type: "NewMessage",
            message,
            updateOtherTypingState:
                fromConnection._connectionId !== toConnection._connectionId &&
                fromConnection._typingState.get() !== null
                    ? {
                          connectionId: fromConnection._connectionId,
                          typingState: null,
                      }
                    : null,
        });

        // If `_nextMessageIndexToSend` is null and the client hasn't backfilled then
        // we send messages in whatever order we receive them. Since we don't know if
        // we missed an earlier message. If we did miss an earlier message then the
        // connection would stall and send no new messages.
        if (toConnection._nextMessageIndexToSend !== null)
            toConnection._nextMessageIndexToSend = message.index + 1;

        // Flush any queued messages now that our next message index has moved forward.
        toConnection._flushQueuedMessages(context);
    }

    private _flushQueuedMessages(context: WorkerActionContext) {
        // If this is null then nothing should be queued.
        if (this._nextMessageIndexToSend === null) return;

        while (true) {
            const oldQueuedMessageLength = this._queuedNewMessages.length;

            this._queuedNewMessages = this._queuedNewMessages.filter(message => {
                assert(this._nextMessageIndexToSend !== null);

                // This is the next message for our client! Send it.
                if (message.index === this._nextMessageIndexToSend) {
                    this._sendEvent(context, {
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

    private _sendMessageChange(context: WorkerActionContext, messageChange: MessageChange) {
        // Wait until we are done backfilling to send any message changes...
        if (this._isBackfilling) {
            this._queuedMessageChanges.push(messageChange);
            return;
        }

        this._sendEvent(context, {
            type: "ChangeMessage",
            change: messageChange,
        });
    }

    private readonly _backfillMutex = new AsyncMutex(undefined);

    public backfillMessages(
        context: WorkerSessionActionContext,
        {
            clientMessageCount,
            clientLastMessageChangeTime,
            newMessageLimit,
        }: {
            clientMessageCount: number;
            clientLastMessageChangeTime: Date | null;
            newMessageLimit: number;
        },
    ): Promise<{
        messageCount: number;
        lastMessageChangeTime: Date | null;
        newMessages: ReadonlyArray<Message>;
        newOtherReferencedMessages: ReadonlyArray<Message>;
        messageChangesResult:
            | {
                  readonly type: "Available";
                  readonly changes: ReadonlyArray<MessageChange>;
              }
            | {
                  readonly type: "Unavailable";
              };
        typingStateByConnectionId: ReadonlyMap<WebSocketConnectionId, MessagingTypingState>;
    }> {
        // Execute our backfills sequentially so that our internal state is left in a
        // good state.
        return this._backfillMutex.run(async () => {
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
                    clientMessageCount,
                    clientLastMessageChangeTime,
                    newMessageLimit,
                },
            );

            await messagingRealtimeBackfillMessagesBeforeFlushTestCheckpoint.waitForTest(
                context.actor.getAccountId(),
            );

            this._isBackfilling = false;

            this._nextMessageIndexToSend = messageCount;
            this._flushQueuedMessages(context);

            // Send only the queued changes that occur after our backfill.
            for (const messageChange of this._queuedMessageChanges) {
                if (
                    !lastMessageChangeTime ||
                    getMessageChangeTime(messageChange) > lastMessageChangeTime
                ) {
                    this._sendEvent(context, {
                        type: "ChangeMessage",
                        change: messageChange,
                    });
                }
            }
            this._queuedMessageChanges = [];

            return {
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
                // a second time after 3 because the rest of the code to send our call result
                // is synchronous. So we will send the backfill response and then later send
                // connection A's typing state update. If you add asynchronous execution
                // between the point where we send the backfill response and construct the
                // typing state backfill, you may have added a race condition bug.
                typingStateByConnectionId: new Map(
                    filterMapIterable(this._iterateOtherConnections(), connection => {
                        const typingState = connection._typingState.get();
                        if (typingState === null) return null;
                        return [connection._connectionId, typingState];
                    }),
                ),
            };
        });
    }

    public async createMessage(
        context: WorkerSessionActionContext,
        {parentMessageIndex, content}: {parentMessageIndex: number | null; content: MessageContent},
    ): Promise<{}> {
        const [{index, createdTime}, author, contentReferences] = await runAllPromises([
            this._createMessage(context, {
                roomKey: this._roomKey,
                parentMessageIndex,
                content,
            }),
            context.actor.getAccount(),
            getContentReferencesForNode(context, this._spaceId, content),
        ]);

        await messagingRealtimeCreateMessageBeforeSendTestCheckpoint.waitForTest(
            context.actor.getAccountId(),
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
                    parentMessageIndex,
                    content: {
                        doc: content,
                        references: contentReferences,
                    },
                    contentUpdatedTime: null,
                },
            });

            MessagingRealtimeConnection._sendNewMessageAndClearTypingState(
                context,
                this,
                this,
                newMessage,
            );

            for (const connection of this._iterateOtherConnections()) {
                MessagingRealtimeConnection._sendNewMessageAndClearTypingState(
                    context,
                    this,
                    connection,
                    newMessage,
                );
            }
        });

        return {};
    }

    public async updateMessageContent(
        context: WorkerSessionActionContext,
        {
            messageIndex,
            content,
        }: {
            messageIndex: number;
            content: MessageContent;
        },
    ): Promise<{}> {
        const [{contentUpdatedTime}, contentReferences] = await runAllPromises([
            this._updateMessageContent(context, {
                roomKey: this._roomKey,
                messageIndex,
                content,
            }),
            getContentReferencesForNode(context, this._spaceId, content),
        ]);

        const messageChange: MessageChange = {
            type: "UpdateContent",
            index: messageIndex,
            content: {
                doc: content,
                references: contentReferences,
            },
            contentUpdatedTime,
        };

        this._sendMessageChange(context, messageChange);

        for (const connection of this._iterateOtherConnections())
            connection._sendMessageChange(context, messageChange);

        return {};
    }

    public async deleteMessage(
        context: WorkerSessionActionContext,
        {messageIndex}: {messageIndex: number},
    ): Promise<{}> {
        const {deletedTime} = await this._deleteMessage(context, {
            roomKey: this._roomKey,
            messageIndex,
        });

        const messageChange: MessageChange = {
            type: "Delete",
            index: messageIndex,
            deletedTime,
        };

        this._sendMessageChange(context, messageChange);

        for (const connection of this._iterateOtherConnections())
            connection._sendMessageChange(context, messageChange);

        return {};
    }

    public async startTypingInMessageInput(
        context: WorkerSessionActionContext,
        input: {},
    ): Promise<{}> {
        await this._typingState.run(async (oldTypingState, setTypingState) => {
            if (oldTypingState !== null) return;

            const typingState: MessagingTypingState = {
                isTyping: true,
                startTime: new Date(),
                account: await context.actor.getAccount(),
            };

            setTypingState(typingState);

            this._sendEventToOthers(context, {
                type: "UpdateOtherTypingState",
                connectionId: this._connectionId,
                typingState,
            });
        });

        return {};
    }

    // The stop typing function needs to be called outside of a `AppActionContext`
    // when the connection is closing. This means it may not have authorization
    // information.
    public async stopTypingInMessageInput(context: WorkerProcessContext, input: {}): Promise<{}> {
        await this._typingState.run(async (oldTypingState, setTypingState) => {
            if (oldTypingState === null) return;

            setTypingState(null);

            this._sendEventToOthers(context, {
                type: "UpdateOtherTypingState",
                connectionId: this._connectionId,
                typingState: null,
            });
        });

        return {};
    }

    public handleClose(context: WorkerProcessContext) {
        context.process.waitUntil(async () => {
            await this.stopTypingInMessageInput(context, {});
        });
    }
}
