import {Step} from "prosemirror-transform";
import {
    WorkerActionContext,
    WorkerSessionActionContext,
} from "~/server/cloudflare/context/worker_action_context.js";
import {WorkerProcessContext} from "~/server/cloudflare/context/worker_process_context.js";
import {
    MessagingRealtimeEventStub,
    MessagingRealtimeEventStubNewMessage,
} from "~/server/messaging/realtime/messaging_realtime_event_stub.js";
import {isEmptyContentReferencedIds} from "~/shared/content/content_referenced_ids.js";
import {emptyContentReferences} from "~/shared/content/content_references.js";
import {MessageContent} from "~/shared/content/message_content_schema.js";
import {PermissionDeniedError} from "~/shared/error/error.js";
import {FileEntityId} from "~/shared/files/file_entity_id.js";
import {MutexValue} from "~/shared/helpers/async/mutex_value.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.js";
import {TimeZone} from "~/shared/helpers/intl/time_zone.js";
import {filterMapIterable} from "~/shared/helpers/iterable/filter_map_iterable.js";
import {emptyMap} from "~/shared/helpers/map/empty_map.js";
import {emptySet} from "~/shared/helpers/set/empty_set.js";
import {TestCheckpoint} from "~/shared/helpers/test/test_checkpoint.js";
import {SafeFloatingPromise} from "~/shared/helpers/types/safe_floating_promise.js";
import {AccountId, FileId, SpaceId, WebSocketConnectionId} from "~/shared/id/types/id_types.js";
import {MessageModel} from "~/shared/messaging/message_model.js";
import {
    MessageReferencedIds,
    MessageReferences,
    collectContentReferencedIdsForStreamPart,
    getMessageReferencedIds,
} from "~/shared/messaging/message_references.js";
import {MessageContentPayloadParent, MessagePayload} from "~/shared/messaging/message_schema.js";
import {
    MessagingRealtimeBroadcastCompleteMessageStreamRequest,
    MessagingRealtimeBroadcastNewMessageRequest,
    MessagingRealtimeBroadcastPutMessageStreamPartRequest,
    MessagingRealtimeEvent,
    MessagingTypingState,
} from "~/shared/messaging/messaging_realtime_protocol.js";
import {Reaction} from "~/shared/reactions/reaction.js";
import {emptyReactionSet} from "~/shared/reactions/reaction_set.js";
import {getAccount} from "~/shared/rpc/accounts_rpc_definitions.js";
import {SearchMentionEntityId} from "~/shared/search/search_entity_id.js";
import {AccountModel} from "~/shared/spaces/account_model.js";
import {ServerSynchronizationCheckpoint} from "~/shared/web_socket/server_synchronization_checkpoint.js";

/**
 * Create a new message in a room.
 */
export type CreateMessageFunction<RoomKey extends string> = (
    context: WorkerSessionActionContext,
    options: {
        roomKey: RoomKey;
        parent: MessageContentPayloadParent | null;
        content: MessageContent;
        fileIds: ReadonlyArray<FileId | FileEntityId>;
        createdTimeZone: TimeZone;
        dangerousCurrentlyViewingSearchEntityId?: SearchMentionEntityId;
    },
) => Promise<{
    index: number;
    createdTime: Date;
}>;

/**
 * Update the content of a message.
 *
 * We will record the time at which the content was updated and show that the
 * message was edited.
 */
export type UpdateMessageContentFunction<RoomKey extends string> = (
    context: WorkerSessionActionContext,
    options: {
        roomKey: RoomKey;
        messageIndex: number;
        contentVersion: number;
        steps: ReadonlyArray<Step>;
    },
) => Promise<{
    version: number;
}>;

/**
 * Delete a message.
 */
export type DeleteMessageFunction<RoomKey extends string> = (
    context: WorkerSessionActionContext,
    options: {
        roomKey: RoomKey;
        messageIndex: number;
    },
) => Promise<{
    version: number;
}>;

/**
 * Sets a reaction at some position on a message.
 */
export type SetMessageReactionFunction<RoomKey extends string> = (
    context: WorkerSessionActionContext,
    options: {
        roomKey: RoomKey;
        messageIndex: number;
        contentVersion: number;
        pos: number | "Files";
        reaction: Reaction | "GenericLike";
    },
) => Promise<{
    version: number;
}>;

/**
 * Deletes a reaction at some position on a message.
 */
export type DeleteMessageReactionFunction<RoomKey extends string> = (
    context: WorkerSessionActionContext,
    options: {
        roomKey: RoomKey;
        messageIndex: number;
        contentVersion: number;
        pos: number | "Files";
    },
) => Promise<{
    version: number;
}>;

/**
 * Backfill messages and message changes the client is missing. Realtime could be
 * implemented by polling this method. However, this method is also important for
 * implementing push-based realtime as it fills the gap between when data was
 * loaded and when we connected to our realtime WebSocket.
 */
export type BackfillMessagesFunction<
    RoomKey extends string,
    Message extends MessageModel<RoomKey>,
    BackfillMessagesExtra = null,
> = (
    context: WorkerSessionActionContext,
    options: {
        roomKey: RoomKey;
        checkpoint: ServerSynchronizationCheckpoint;
        clientMessageCount: number;
        newMessageLimit: number;
    },
) => Promise<{
    messageCount: number;
    newMessages: ReadonlyArray<Message>;
    newOtherReferencedMessages: ReadonlyArray<Message>;
    messageUpdatesResult:
        | {
              type: "Available";
              checkpoint: ServerSynchronizationCheckpoint;
              messages: ReadonlyArray<Message>;
          }
        | {
              type: "Unavailable";
          };
    extra: BackfillMessagesExtra;
}>;

/**
 * Get a message but only at the specified version or a newer version. Useful for
 * serving realtime events where we know the message was updated to some version
 * but need to load the message with the session actor's permissions.
 */
export type GetMessageAtVersionFunction<
    RoomKey extends string,
    Message extends MessageModel<RoomKey>,
> = (
    context: WorkerSessionActionContext,
    options: {
        roomKey: RoomKey;
        messageIndex: number;
        version: number;
    },
) => Promise<Message>;

/**
 * Get message references using the permissions associated with the session actor.
 */
export type GetMessageReferencesFunction<RoomKey extends string> = (
    context: WorkerSessionActionContext,
    options: {
        spaceId: SpaceId;
        roomKey: RoomKey;
        referencedIds: MessageReferencedIds;
    },
) => Promise<MessageReferences>;

/**
 * Create a message model instance of the right type for the messaging surface.
 */
export type CreateMessageModelFunction<
    RoomKey extends string,
    Message extends MessageModel<RoomKey>,
> = (options: {
    roomKey: RoomKey;
    message: MessagingRealtimeEventStubNewMessage;
    references: MessageReferences & {author: AccountModel};
}) => Message;

export const messagingRealtimeBackfillMessagesBeforeFlushTestCheckpoint =
    new TestCheckpoint<AccountId>();

export const messagingRealtimeCreateMessageBeforeSendTestCheckpoint =
    new TestCheckpoint<AccountId>();

export const messagingRealtimeUpdateMessageContentBeforeSendTestCheckpoint =
    new TestCheckpoint<AccountId>();

export class MessagingRealtimeConnection<
    RoomKey extends string,
    Message extends MessageModel<RoomKey>,
    BackfillMessagesExtra = null,
> {
    private readonly _connectionId: WebSocketConnectionId;
    public readonly spaceId: SpaceId;
    public readonly accountId: AccountId;
    public readonly roomKey: RoomKey;
    private readonly _sendEvent: (
        context: WorkerProcessContext,
        event: MessagingRealtimeEventStub,
    ) => SafeFloatingPromise<void>;
    private readonly _sendEventToOthers: (
        context: WorkerProcessContext,
        event: MessagingRealtimeEventStub,
    ) => void;
    private readonly _iterateOtherConnections: () => Iterable<
        MessagingRealtimeConnection<RoomKey, Message, BackfillMessagesExtra>
    >;
    private readonly _createMessage: CreateMessageFunction<RoomKey>;
    private readonly _updateMessageContent: UpdateMessageContentFunction<RoomKey>;
    private readonly _deleteMessage: DeleteMessageFunction<RoomKey>;
    private readonly _setMessageReaction: SetMessageReactionFunction<RoomKey>;
    private readonly _deleteMessageReaction: DeleteMessageReactionFunction<RoomKey>;
    private readonly _backfillMessages: BackfillMessagesFunction<
        RoomKey,
        Message,
        BackfillMessagesExtra
    >;
    private readonly _getMessageAtVersion: GetMessageAtVersionFunction<RoomKey, Message>;
    public readonly _getMessageReferences: GetMessageReferencesFunction<RoomKey>;
    private readonly _createMessageModel: CreateMessageModelFunction<RoomKey, Message>;

    /**
     * We want to send `NewMessage` events to our client in order so that the client
     * never has a gap in its state while users are actively typing messages. Since
     * sending events is asynchronous we need a mutex to make sure there's only one
     * function updating the queue at a time.
     */
    private readonly _queuedMessagesState = new MutexValue<{
        readonly nextMessageIndexToSend: number | null;
        readonly queuedMessages: ReadonlyArray<MessagingRealtimeEventStubNewMessage>;
    }>({
        nextMessageIndexToSend: null,
        queuedMessages: [],
    });

    /**
     * If we should show a typing indicator for this realtime connection then there
     * will be some typing state object in here.
     */
    private _typingState = new MutexValue<MessagingTypingState | null>(null);

    constructor({
        connectionId,
        spaceId,
        accountId,
        roomKey,
        sendEvent,
        sendEventToOthers,
        iterateOtherConnections,
        createMessage,
        updateMessageContent,
        deleteMessage,
        setMessageReaction,
        deleteMessageReaction,
        backfillMessages,
        getMessageAtVersion,
        getMessageReferences,
        createMessageModel,
    }: {
        connectionId: WebSocketConnectionId;
        spaceId: SpaceId;
        accountId: AccountId;
        roomKey: RoomKey;
        sendEvent: (
            context: WorkerProcessContext,
            event: MessagingRealtimeEventStub,
        ) => SafeFloatingPromise<void>;
        sendEventToOthers: (
            context: WorkerProcessContext,
            event: MessagingRealtimeEventStub,
        ) => void;
        iterateOtherConnections: () => Iterable<
            MessagingRealtimeConnection<RoomKey, Message, BackfillMessagesExtra>
        >;
        createMessage: CreateMessageFunction<RoomKey>;
        updateMessageContent: UpdateMessageContentFunction<RoomKey>;
        deleteMessage: DeleteMessageFunction<RoomKey>;
        setMessageReaction: SetMessageReactionFunction<RoomKey>;
        deleteMessageReaction: DeleteMessageReactionFunction<RoomKey>;
        backfillMessages: BackfillMessagesFunction<RoomKey, Message, BackfillMessagesExtra>;
        getMessageAtVersion: GetMessageAtVersionFunction<RoomKey, Message>;
        getMessageReferences: GetMessageReferencesFunction<RoomKey>;
        createMessageModel: CreateMessageModelFunction<RoomKey, Message>;
    }) {
        this._connectionId = connectionId;
        this.spaceId = spaceId;
        this.accountId = accountId;
        this.roomKey = roomKey;
        this._sendEvent = sendEvent;
        this._sendEventToOthers = sendEventToOthers;
        this._iterateOtherConnections = iterateOtherConnections;
        this._createMessage = createMessage;
        this._updateMessageContent = updateMessageContent;
        this._deleteMessage = deleteMessage;
        this._setMessageReaction = setMessageReaction;
        this._deleteMessageReaction = deleteMessageReaction;
        this._backfillMessages = backfillMessages;
        this._getMessageAtVersion = getMessageAtVersion;
        this._getMessageReferences = getMessageReferences;
        this._createMessageModel = createMessageModel;
    }

    private static async _sendNewMessageAndClearTypingState<
        RoomKey extends string,
        Message extends MessageModel<RoomKey>,
        BackfillMessagesExtra,
    >(
        context: WorkerActionContext,
        fromConnection: MessagingRealtimeConnection<RoomKey, Message, BackfillMessagesExtra>,
        toConnection: MessagingRealtimeConnection<RoomKey, Message, BackfillMessagesExtra>,
        message: MessagingRealtimeEventStubNewMessage,
        oldFromConnectionTypingState: MessagingTypingState | null,
    ) {
        await toConnection._queuedMessagesState.withLock(async stateRef => {
            const {nextMessageIndexToSend} = stateRef.current;

            // If the connection is backfilling or we received this message out of order, queue
            // it for later. If we have not received a message yet then we want to send it and
            // start waiting for the message after it.
            if (nextMessageIndexToSend !== null && message.index !== nextMessageIndexToSend) {
                if (message.index > nextMessageIndexToSend) {
                    // If the message needs to be queued for sending later, we still want to
                    // immediately send our typing state update. In case another typing state update
                    // happens later we don't want to clobber the update from this function.
                    if (
                        fromConnection._connectionId !== toConnection._connectionId &&
                        oldFromConnectionTypingState !== null
                    ) {
                        toConnection._sendEvent(context, {
                            type: "UpdateOtherTypingState",
                            connectionId: fromConnection._connectionId,
                            typingState: null,
                        });
                    }

                    stateRef.current = {
                        nextMessageIndexToSend,
                        queuedMessages: [...stateRef.current.queuedMessages, message],
                    };
                }
                return;
            }

            await toConnection._sendEvent(context, {
                type: "NewMessage",
                message,
                updateOtherTypingState:
                    fromConnection._connectionId !== toConnection._connectionId &&
                    oldFromConnectionTypingState !== null
                        ? {
                              connectionId: fromConnection._connectionId,
                              typingState: null,
                          }
                        : null,
            });

            stateRef.current = {
                nextMessageIndexToSend: message.index + 1,
                queuedMessages: stateRef.current.queuedMessages,
            };

            await toConnection._flushQueuedMessages(context, stateRef);
        });
    }

    /**
     * Flush messages in `queuedMessagesState`. Must call this function inside a
     * `queuedMessagesState` lock.
     */
    private async _flushQueuedMessages(
        context: WorkerActionContext,
        stateRef: {
            current: {
                readonly nextMessageIndexToSend: number | null;
                readonly queuedMessages: ReadonlyArray<MessagingRealtimeEventStubNewMessage>;
            };
        },
    ) {
        let {nextMessageIndexToSend, queuedMessages} = stateRef.current;

        if (nextMessageIndexToSend === null) return;

        let loop = true;
        while (loop) {
            loop = false;

            const sendMessages: Array<MessagingRealtimeEventStubNewMessage> = [];

            queuedMessages = queuedMessages.filter(message => {
                assert(nextMessageIndexToSend !== null);

                // This is the next message for our client! Send it.
                if (message.index === nextMessageIndexToSend) {
                    // Loop again after processing some message from our queue. We may have a queue
                    // that looks like this: `[3, 1, 2]`. In that case 1 and 2 may be processed in the
                    // first iteration while 3 is processed in the second iteration.
                    loop = true;

                    sendMessages.push(message);
                    nextMessageIndexToSend = message.index + 1;
                    return false;
                }

                // If the message is in the past, we will never flush it so throw it away.
                if (message.index < nextMessageIndexToSend) {
                    return false;
                }

                return true;
            });

            // Send messages sequentially in the order they were pushed.
            for (const sendMessage of sendMessages) {
                await this._sendEvent(context, {
                    type: "NewMessage",
                    message: sendMessage,
                    updateOtherTypingState: null,
                });
            }
        }

        // Make sure we update state.
        stateRef.current = {nextMessageIndexToSend, queuedMessages};
    }

    public async backfillMessages(
        context: WorkerSessionActionContext,
        {
            checkpoint,
            clientMessageCount,
            newMessageLimit,
        }: {
            checkpoint: ServerSynchronizationCheckpoint;
            clientMessageCount: number;
            newMessageLimit: number;
        },
    ): Promise<{
        messageCount: number;
        newMessages: ReadonlyArray<Message>;
        newOtherReferencedMessages: ReadonlyArray<Message>;
        messageUpdatesResult:
            | {
                  readonly type: "Available";
                  readonly checkpoint: ServerSynchronizationCheckpoint;
                  readonly messages: ReadonlyArray<Message>;
              }
            | {
                  readonly type: "Unavailable";
              };
        typingStateByConnectionId: ReadonlyMap<WebSocketConnectionId, MessagingTypingState>;
        extra: BackfillMessagesExtra;
    }> {
        assert(this.accountId === context.actor.getAccountId());

        const {messageCount, newMessages, newOtherReferencedMessages, messageUpdatesResult, extra} =
            await this._queuedMessagesState.withLock(async stateRef => {
                const result = await this._backfillMessages(context, {
                    roomKey: this.roomKey,
                    checkpoint,
                    clientMessageCount,
                    newMessageLimit,
                });

                await messagingRealtimeBackfillMessagesBeforeFlushTestCheckpoint.waitForTest(
                    context.actor.getAccountId(),
                );

                stateRef.current = {
                    nextMessageIndexToSend: result.messageCount,
                    queuedMessages: stateRef.current.queuedMessages,
                };

                await this._flushQueuedMessages(context, stateRef);

                return result;
            });

        return {
            messageCount,
            newMessages,
            newOtherReferencedMessages,
            messageUpdatesResult,
            // NOTE(calebmer): In the following case:
            //
            // 1. Backfill starts for connection B
            // 2. Connection A updates their typing state
            // 3. Backfill response for connection B is created with connection A's typing
            //    state
            //
            // We shouldn't have race conditions if connection A updates their typing state a
            // second time after 3 because the rest of the code to send our call result is
            // synchronous. So we will send the backfill response and then later send
            // connection A's typing state update. If you add asynchronous execution between
            // the point where we send the backfill response and construct the typing state
            // backfill, you may have added a race condition bug.
            typingStateByConnectionId: new Map(
                filterMapIterable(this._iterateOtherConnections(), connection => {
                    const typingState = connection._typingState.getWithoutLock();
                    if (typingState === null) return;
                    return [connection._connectionId, typingState];
                }),
            ),
            extra,
        };
    }

    public async createMessage(
        context: WorkerSessionActionContext,
        {
            parent,
            content,
            createdTimeZone,
            fileIds,
            dangerousCurrentlyViewingSearchEntityId,
        }: {
            parent: MessageContentPayloadParent | null;
            content: MessageContent;
            createdTimeZone: TimeZone;
            fileIds: ReadonlyArray<FileId | FileEntityId>;
            /**
             * The search entity id that the user is currently viewing while sending the chat
             * message. We consider this to be dangerous because it enables other humans in a
             * chat to see what a user is looking at based on the agent's response.
             *
             * We should only set this value if the user is in an "all-bot" chat.
             *
             * We don't store this anywhere, but we do pass it along to agents. As an extra
             * safety measure, we validate that the user is in a bot-only chat on the server
             * before passing it along.
             */
            dangerousCurrentlyViewingSearchEntityId?: SearchMentionEntityId;
        },
    ): Promise<{}> {
        assert(this.accountId === context.actor.getAccountId());

        // TODO(calebmer): What if we sent clients an optimistic "message created" event
        // before we confirmed the message was saved in the database? This would improve
        // user perceived messaging latency.

        const {index, createdTime} = await this._createMessage(context, {
            roomKey: this.roomKey,
            parent,
            content,
            fileIds,
            createdTimeZone,
            dangerousCurrentlyViewingSearchEntityId,
        });

        await messagingRealtimeCreateMessageBeforeSendTestCheckpoint.waitForTest(
            context.actor.getAccountId(),
        );

        await this._typingState.withLock(async typingStateRef => {
            // We clear the connection's typing state after they send a message.
            const oldTypingState = typingStateRef.current;
            typingStateRef.current = null;

            const authorId = context.actor.getAccountId();

            const messagePayload: MessagePayload = {
                type: "Content",
                parent,
                content,
                contentUpdate: null,
                fileIds,
                reactionsByPos: emptyMap,
                filesReactions: emptyReactionSet,
            };

            const message: MessagingRealtimeEventStubNewMessage = {
                index,
                version: 0,
                authorId,
                createdTimeZone,
                createdTime,
                payload: messagePayload,
                stream: null,
                referencedIds: getMessageReferencedIds({
                    authorId,
                    payload: messagePayload,
                    stream: null,
                }),
            };

            context.process.waitUntil(
                MessagingRealtimeConnection._sendNewMessageAndClearTypingState(
                    context,
                    this,
                    this,
                    message,
                    oldTypingState,
                ),
            );

            for (const connection of this._iterateOtherConnections()) {
                context.process.waitUntil(
                    MessagingRealtimeConnection._sendNewMessageAndClearTypingState(
                        context,
                        this,
                        connection,
                        message,
                        oldTypingState,
                    ),
                );
            }
        });

        return {};
    }

    public async updateMessageContent(
        context: WorkerSessionActionContext,
        {
            messageIndex,
            contentVersion,
            steps,
        }: {
            messageIndex: number;
            contentVersion: number;
            steps: ReadonlyArray<Step>;
        },
    ): Promise<{}> {
        assert(this.accountId === context.actor.getAccountId());

        const {version} = await this._updateMessageContent(context, {
            roomKey: this.roomKey,
            messageIndex,
            contentVersion,
            steps,
        });

        await messagingRealtimeUpdateMessageContentBeforeSendTestCheckpoint.waitForTest(
            context.actor.getAccountId(),
        );

        const sendOurEventPromise = this._sendEvent(context, {
            type: "UpdateMessage",
            messageIndex,
            version,
        });

        for (const connection of this._iterateOtherConnections()) {
            connection._sendEvent(context, {
                type: "UpdateMessage",
                messageIndex,
                version,
            });
        }

        // Wait until we send our update message event before finishing the RPC.
        await sendOurEventPromise;

        return {};
    }

    public async deleteMessage(
        context: WorkerSessionActionContext,
        {messageIndex}: {messageIndex: number},
    ): Promise<{}> {
        assert(this.accountId === context.actor.getAccountId());

        const {version} = await this._deleteMessage(context, {
            roomKey: this.roomKey,
            messageIndex,
        });

        const sendOurEventPromise = this._sendEvent(context, {
            type: "UpdateMessage",
            messageIndex,
            version,
        });

        for (const connection of this._iterateOtherConnections()) {
            connection._sendEvent(context, {
                type: "UpdateMessage",
                messageIndex,
                version,
            });
        }

        // Wait until we send our update message event before finishing the RPC.
        await sendOurEventPromise;

        return {};
    }

    public async setMessageReaction(
        context: WorkerSessionActionContext,
        {
            messageIndex,
            contentVersion,
            pos,
            reaction,
        }: {
            messageIndex: number;
            contentVersion: number;
            pos: number | "Files";
            reaction: Reaction | "GenericLike";
        },
    ): Promise<{}> {
        assert(this.accountId === context.actor.getAccountId());

        const {version} = await this._setMessageReaction(context, {
            roomKey: this.roomKey,
            messageIndex,
            contentVersion,
            pos,
            reaction,
        });

        const sendOurEventPromise = this._sendEvent(context, {
            type: "UpdateMessage",
            messageIndex,
            version,
        });

        for (const connection of this._iterateOtherConnections()) {
            connection._sendEvent(context, {
                type: "UpdateMessage",
                messageIndex,
                version,
            });
        }

        // Wait until we send our update message event before finishing the RPC.
        await sendOurEventPromise;

        return {};
    }

    public async deleteMessageReaction(
        context: WorkerSessionActionContext,
        {
            messageIndex,
            contentVersion,
            pos,
        }: {
            messageIndex: number;
            contentVersion: number;
            pos: number | "Files";
        },
    ): Promise<{}> {
        assert(this.accountId === context.actor.getAccountId());

        const {version} = await this._deleteMessageReaction(context, {
            roomKey: this.roomKey,
            messageIndex,
            contentVersion,
            pos,
        });

        const sendOurEventPromise = this._sendEvent(context, {
            type: "UpdateMessage",
            messageIndex,
            version,
        });

        for (const connection of this._iterateOtherConnections()) {
            connection._sendEvent(context, {
                type: "UpdateMessage",
                messageIndex,
                version,
            });
        }

        // Wait until we send our update message event before finishing the RPC.
        await sendOurEventPromise;

        return {};
    }

    public async startTypingInMessageInput(
        context: WorkerSessionActionContext,
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        input: {},
    ): Promise<{}> {
        assert(this.accountId === context.actor.getAccountId());

        await this._typingState.withLock(async typingStateRef => {
            if (typingStateRef.current !== null) return;

            const {account} = await getAccount(context, {
                spaceId: this.spaceId,
                accountId: context.actor.getAccountId(),
            });

            const typingState: MessagingTypingState = {
                isTyping: true,
                startTime: new Date(),
                account,
            };

            typingStateRef.current = typingState;

            this._sendEventToOthers(context, {
                type: "UpdateOtherTypingState",
                connectionId: this._connectionId,
                typingState,
            });
        });

        return {};
    }

    // The stop typing function needs to be called outside of a `AppActionContext` when
    // the connection is closing. This means it may not have authorization information.
    public async stopTypingInMessageInput(
        context: WorkerProcessContext,
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        input: {},
    ): Promise<{}> {
        await this._typingState.withLock(async typingState => {
            if (typingState.current === null) return;

            typingState.current = null;

            this._sendEventToOthers(context, {
                type: "UpdateOtherTypingState",
                connectionId: this._connectionId,
                typingState: null,
            });
        });

        return {};
    }

    /**
     * Broadcast a new message event that wasn't created by our Durable Object. For
     * example messages created by `ApiService`.
     */
    public static broadcastNewMessage<
        RoomKey extends string,
        Message extends MessageModel<RoomKey>,
        BackfillMessagesExtra = null,
    >(
        context: WorkerActionContext,
        request: MessagingRealtimeBroadcastNewMessageRequest,
        iterateAllConnections: () => Iterable<
            MessagingRealtimeConnection<RoomKey, Message, BackfillMessagesExtra>
        >,
    ) {
        if (context.actor.serviceName !== "ApiService") {
            throw new PermissionDeniedError(
                "Currently, only `ApiService` is allowed to broadcast new message realtime events",
            );
        }

        if (context.actor.type !== "Bot") {
            throw new PermissionDeniedError(
                "Currently, only bots are allowed to broadcast new message realtime events",
            );
        }

        const message: MessagingRealtimeEventStubNewMessage = {
            index: request.index,
            version: request.version,
            authorId: request.authorId,
            createdTimeZone: request.createdTimeZone,
            createdTime: request.createdTime,
            payload: request.payload,
            stream: request.stream,
            referencedIds: getMessageReferencedIds(request),
        };

        for (const connection of iterateAllConnections()) {
            connection._broadcastNewMessage(context, message);
        }
    }

    private _broadcastNewMessage(
        context: WorkerActionContext,
        message: MessagingRealtimeEventStubNewMessage,
    ) {
        context.process.waitUntil(
            this._queuedMessagesState.withLock(async stateRef => {
                const {nextMessageIndexToSend} = stateRef.current;

                // If the connection is backfilling or we received this message out of order, queue
                // it for later. If we have not received a message yet then we want to send it and
                // start waiting for the message after it.
                if (nextMessageIndexToSend !== null && message.index !== nextMessageIndexToSend) {
                    if (message.index > nextMessageIndexToSend) {
                        stateRef.current = {
                            nextMessageIndexToSend,
                            queuedMessages: [...stateRef.current.queuedMessages, message],
                        };
                    }
                    return;
                }

                await this._sendEvent(context, {
                    type: "NewMessage",
                    message,
                    updateOtherTypingState: null,
                });

                stateRef.current = {
                    nextMessageIndexToSend: message.index + 1,
                    queuedMessages: stateRef.current.queuedMessages,
                };

                await this._flushQueuedMessages(context, stateRef);
            }),
        );
    }

    public static broadcastPutMessageStreamPart<
        RoomKey extends string,
        Message extends MessageModel<RoomKey>,
        BackfillMessagesExtra = null,
    >(
        context: WorkerActionContext,
        request: MessagingRealtimeBroadcastPutMessageStreamPartRequest,
        iterateAllConnections: () => Iterable<
            MessagingRealtimeConnection<RoomKey, Message, BackfillMessagesExtra>
        >,
    ) {
        for (const connection of iterateAllConnections()) {
            connection._sendEvent(context, {
                type: "PutMessageStreamPart",
                index: request.index,
                partIndex: request.partIndex,
                part: request.part,
                referencedIds: collectContentReferencedIdsForStreamPart(request.part.payload),
            });
        }
    }

    public static broadcastCompleteMessageStream<
        RoomKey extends string,
        Message extends MessageModel<RoomKey>,
        BackfillMessagesExtra = null,
    >(
        context: WorkerActionContext,
        request: MessagingRealtimeBroadcastCompleteMessageStreamRequest,
        iterateAllConnections: () => Iterable<
            MessagingRealtimeConnection<RoomKey, Message, BackfillMessagesExtra>
        >,
    ) {
        for (const connection of iterateAllConnections()) {
            connection._sendEvent(context, {
                type: "CompleteMessageStream",
                index: request.index,
                completedTime: request.completedTime,
            });
        }
    }

    public async transformEvent(
        context: WorkerSessionActionContext,
        eventStub: MessagingRealtimeEventStub,
    ): Promise<MessagingRealtimeEvent<Message>> {
        assert(this.accountId === context.actor.getAccountId());

        switch (eventStub.type) {
            case "UpdateOtherTypingState": {
                return eventStub;
            }
            case "NewMessage": {
                const references = await this._getMessageReferences(context, {
                    spaceId: this.spaceId,
                    roomKey: this.roomKey,
                    referencedIds: eventStub.message.referencedIds,
                });

                return {
                    type: "NewMessage",
                    message: this._createMessageModel({
                        roomKey: this.roomKey,
                        message: eventStub.message,
                        references: references as MessageReferences & {author: AccountModel},
                    }),
                    updateOtherTypingState: eventStub.updateOtherTypingState,
                };
            }
            case "UpdateMessage": {
                const message = await this._getMessageAtVersion(context, {
                    roomKey: this.roomKey,
                    messageIndex: eventStub.messageIndex,
                    version: eventStub.version,
                });

                return {
                    type: "UpdateMessage",
                    message,
                };
            }
            case "PutMessageStreamPart": {
                const {contentReferences} = !isEmptyContentReferencedIds(eventStub.referencedIds)
                    ? await this._getMessageReferences(context, {
                          spaceId: this.spaceId,
                          roomKey: this.roomKey,
                          referencedIds: {
                              authorId: null,
                              contentReferencedIds: eventStub.referencedIds,
                              fileIds: emptySet,
                          },
                      })
                    : {contentReferences: emptyContentReferences};

                return {
                    type: "PutMessageStreamPart",
                    index: eventStub.index,
                    partIndex: eventStub.partIndex,
                    part: eventStub.part,
                    references: contentReferences,
                };
            }
            case "CompleteMessageStream": {
                return eventStub;
            }
            default:
                throw exhaustive(eventStub);
        }
    }

    public handleClose(context: WorkerProcessContext) {
        context.process.waitUntil(async () => {
            await this.stopTypingInMessageInput(context, {});
        });
    }
}
