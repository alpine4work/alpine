import {Step} from "prosemirror-transform";
import {ContentReferences, ContentReferencesSchema} from "~/shared/content/content_references.js";
import {
    MessageContent,
    MessageContentSchema,
    MessageContentStepSchema,
} from "~/shared/content/message_content_schema.js";
import {FileEntityId, FileIdOrFileEntityIdSchema} from "~/shared/files/file_entity_id.js";
import {assertEqualTypes} from "~/shared/helpers/control/assert_equal_types.open_source.js";
import {TimeZone} from "~/shared/helpers/intl/time_zone.open_source.js";
import {WebSocketConnectionId} from "~/shared/id/types/id_types.js";
import {AccountId, FileId} from "~/shared/id/types/id_types.open_source.js";
import {MessageModel} from "~/shared/messaging/message_model.js";
import {MessagePosOrFilesSchema} from "~/shared/messaging/message_pos_or_files_schema.js";
import {
    MessageContentPayloadParent,
    MessageContentPayloadParentSchema,
    MessageContentPayloadSchema,
    MessageStreamPartPayload,
    MessageStreamPartPayloadSchema,
    MessageStreamSchema,
} from "~/shared/messaging/message_schema.js";
import {
    PutMessageApprovalDecisionsPayload,
    PutMessageApprovalDecisionsPayloadSchema,
} from "~/shared/messaging/put_message_approval_decisions_payload_schema.js";
import {Reaction} from "~/shared/reactions/reaction.js";
import {ReactionOrGenericLikeSchema} from "~/shared/reactions/reaction_schema.js";
import {TimeZoneSchema} from "~/shared/schema/helpers/time_zone_schema.js";
import {ObjectSchemaConfigType, Schema, SchemaType, UnionSchema} from "~/shared/schema/schema.js";
import {
    SearchMentionEntityId,
    SearchMentionEntityIdSchema,
} from "~/shared/search/search_entity_id.js";
import {AccountModel} from "~/shared/spaces/account_model.js";
import {
    ServerSynchronizationCheckpoint,
    ServerSynchronizationCheckpointSchema,
} from "~/shared/web_socket/server_synchronization_checkpoint.js";

export type MessagingTypingState = SchemaType<typeof MessagingTypingStateSchema>;

/**
 * If a user is actively typing in their message input we will send typing state
 */
export const MessagingTypingStateSchema = Schema.object({
    isTyping: Schema.value(true),
    startTime: Schema.date,
    account: AccountModel.schema,
});

export type BackfillMessagesProcedure<Message extends MessageModel> = (input: {
    checkpoint: ServerSynchronizationCheckpoint;
    clientMessageCount: number;
    newMessageLimit: number;
}) => Promise<BackfillMessagesProcedureOutput<Message>>;

export type BackfillMessagesProcedureOutput<Message extends MessageModel> = {
    messageCount: number;
    newMessages: ReadonlyArray<Message>;
    newOtherReferencedMessages: ReadonlyArray<Message>;
    messageUpdatesResult: MessageUpdatesBackfillResult<Message>;
    typingStateByConnectionId: ReadonlyMap<WebSocketConnectionId, MessagingTypingState>;
};

export type CreateMessageProcedure = (input: {
    parent: MessageContentPayloadParent | null;
    content: MessageContent;
    fileIds: ReadonlyArray<FileId | FileEntityId>;
    createdTimeZone: TimeZone;
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
}) => Promise<{}>;

export type UpdateMessageContentProcedure = (input: {
    messageIndex: number;
    contentVersion: number;
    steps: ReadonlyArray<Step>;
}) => Promise<{}>;

export type DeleteMessageProcedure = (input: {messageIndex: number}) => Promise<{}>;

export type SetMessageReactionProcedure = (input: {
    messageIndex: number;
    contentVersion: number;
    pos: number | "Files";
    reaction: Reaction | "GenericLike";
}) => Promise<{}>;

export type DeleteMessageReactionProcedure = (input: {
    messageIndex: number;
    contentVersion: number;
    pos: number | "Files";
}) => Promise<{}>;

export type PutMessageApprovalDecisionsProcedure = (input: {
    messageIndex: number;
    payload: PutMessageApprovalDecisionsPayload;
}) => Promise<{}>;

export type StartTypingInMessageInputProcedure = (input: {}) => Promise<{}>;

export type StopTypingInMessageInputProcedure = (input: {}) => Promise<{}>;

export type MessagingRealtimeProcedures<Message extends MessageModel> = {
    backfillMessages: BackfillMessagesProcedure<Message>;
    createMessage: CreateMessageProcedure;
    updateMessageContent: UpdateMessageContentProcedure;
    deleteMessage: DeleteMessageProcedure;
    setMessageReaction: SetMessageReactionProcedure;
    deleteMessageReaction: DeleteMessageReactionProcedure;
    putMessageApprovalDecisions: PutMessageApprovalDecisionsProcedure;
    startTypingInMessageInput: StartTypingInMessageInputProcedure;
    stopTypingInMessageInput: StopTypingInMessageInputProcedure;
};

export function createMessagingRealtimeProcedureSchemas<Message extends MessageModel>(
    MessageSchema: Schema<Message>,
) {
    return {
        /**
         * When you connect to the messaging realtime WebSocket you should send a
         * `BackfillMessagesRequest`. You will not get `NewMessage` realtime messages until
         * you do.
         *
         * This makes sure the client and server are in sync about what the client's state
         * is. If the WebSocket server has received new messages since the client loaded
         * its data from the HTTP server then we will send a backfill response with those
         * new messages.
         */
        backfillMessages: {
            input: {
                checkpoint: ServerSynchronizationCheckpointSchema,
                clientMessageCount: Schema.integer,
                newMessageLimit: Schema.integer,
            },

            /**
             * Response to a backfill call. Contains the actual message count and an array of
             * new messages we should load.
             *
             * `typingStateByConnectionId` contains the typing state for all connected clients.
             * If a client does not exist in this map it means they have no typing state. If
             * you receive this message you should reset all your typing states and treat this
             * map as the new state.
             *
             * Ordering guarantee: After your first backfill `NewMessage` WebSocket events will
             * arrive in order. Before they may arrive out of order.
             */
            output: {
                messageCount: Schema.integer,
                newMessages: Schema.array(MessageSchema),
                newOtherReferencedMessages: Schema.array(MessageSchema),
                messageUpdatesResult: createMessageUpdatesBackfillResultSchema(MessageSchema),
                typingStateByConnectionId: Schema.map(
                    Schema.id<WebSocketConnectionId>(),
                    MessagingTypingStateSchema,
                ),
            },
        },

        /**
         * Create a new message and send a realtime message to all other connected clients.
         */
        createMessage: {
            input: {
                parent: MessageContentPayloadParentSchema.nullable(),
                content: MessageContentSchema,
                fileIds: Schema.array(FileIdOrFileEntityIdSchema),
                createdTimeZone: TimeZoneSchema,
                dangerousCurrentlyViewingSearchEntityId: SearchMentionEntityIdSchema.optional(),
            },
            output: {},
        },

        /**
         * Update the contents of a message and send a realtime message to all other
         * connected clients.
         */
        updateMessageContent: {
            input: {
                messageIndex: Schema.integer,
                contentVersion: Schema.integer,
                steps: Schema.array(MessageContentStepSchema),
            },
            output: {},
        },

        /**
         * Delete a message and send a realtime message to all other connected clients.
         */
        deleteMessage: {
            input: {
                messageIndex: Schema.integer,
            },
            output: {},
        },

        /**
         * Sets a reaction at some position on a message.
         */
        setMessageReaction: {
            input: {
                messageIndex: Schema.integer,
                contentVersion: Schema.integer,
                pos: MessagePosOrFilesSchema,
                reaction: ReactionOrGenericLikeSchema,
            },
            output: {},
        },

        /**
         * Deletes a reaction at some position on a message.
         */
        deleteMessageReaction: {
            input: {
                messageIndex: Schema.integer,
                contentVersion: Schema.integer,
                pos: MessagePosOrFilesSchema,
            },
            output: {},
        },

        /**
         * Record the current account's decisions on a message stream's approval requests.
         * The updated approvals part is sent to every connected client as a
         * `PutMessageStreamPart` event. The event is sent to the calling connection before
         * this procedure resolves, so once the returned promise resolves the client is
         * guaranteed to have received the decided approvals part.
         */
        putMessageApprovalDecisions: {
            input: {
                messageIndex: Schema.integer.min(0),
                payload: PutMessageApprovalDecisionsPayloadSchema,
            },
            output: {},
        },

        /**
         * Has the client started typing in their message input?
         */
        startTypingInMessageInput: {
            input: {},
            output: {},
        },

        /**
         * Has the client stopped typing in their message input?
         */
        stopTypingInMessageInput: {
            input: {},
            output: {},
        },
    };
}

export type MessageUpdatesBackfillResult<Message extends MessageModel> =
    | {readonly type: "Unavailable"}
    | {
          readonly type: "Available";
          readonly checkpoint: ServerSynchronizationCheckpoint;
          readonly messages: ReadonlyArray<Message>;
      };

export function createMessageUpdatesBackfillResultSchema<Message extends MessageModel>(
    MessageSchema: Schema<Message>,
) {
    return Schema.union({
        Unavailable: Schema.object({
            type: Schema.value("Unavailable"),
        }),
        Available: Schema.object({
            type: Schema.value("Available"),
            checkpoint: ServerSynchronizationCheckpointSchema,
            messages: Schema.array(MessageSchema),
        }),
    });
}

export type MessagingRealtimeEvent<Message extends MessageModel> =
    | {
          readonly type: "NewMessage";
          readonly message: Message;
          readonly updateOtherTypingState: {
              readonly connectionId: WebSocketConnectionId;
              readonly typingState: MessagingTypingState | null;
          } | null;
      }
    | {
          readonly type: "UpdateMessage";
          readonly message: Message;
      }
    | {
          readonly type: "UpdateOtherTypingState";
          readonly connectionId: WebSocketConnectionId;
          readonly typingState: MessagingTypingState | null;
      }
    | {
          readonly type: "PutMessageStreamPart";
          readonly index: number;
          readonly partIndex: number;
          readonly part: {
              readonly version: number;
              readonly payload: MessageStreamPartPayload;
              readonly createdTime: Date;
          };
          readonly references: ContentReferences;
          readonly completedTime: Date | null;
      }
    | {
          readonly type: "CompleteMessageStream";
          readonly index: number;
          readonly completedTime: Date;
      };

export function createMessagingRealtimeEventSchemas<Message extends MessageModel>(
    MessageSchema: Schema<Message>,
) {
    return {
        /**
         * A new message was created! The message could have been created by our account or
         * a different account. Or our account on a different browser.
         *
         * Ordering guarantee: After you have sent a `BackfillMessagesRequest` and received
         * a `BackfillMessagesResponse`. After that you are guaranteed to get every message
         * in order. You will not get message N+1 before message N, you'll always get
         * message N first and then message N+1.
         *
         * You will not get new messages during a backfill. Before a backfill you will
         * receive new messages in any arbitrary order. So message N+1 may arrive before
         * message N. Generally you should ignore this message until after your backfill
         * finishes. This behavior is useful for documents where we want to update the
         * comment thread count when new messages are created but we don't care about
         * strict message ordering until the user opens the comment thread (and we send the
         * backfill request).
         */
        NewMessage: Schema.object({
            type: Schema.value("NewMessage"),
            message: MessageSchema,

            /**
             * Atomically update this other typing state in the same action as we send a
             * message.
             */
            updateOtherTypingState: Schema.object({
                connectionId: Schema.id<WebSocketConnectionId>(),
                typingState: MessagingTypingStateSchema.nullable(),
            }).nullable(),
        }),

        /**
         * A message was changed.
         *
         * Ordering guarantee: There are no ordering guarantees. You may receive an update
         * message at any time in any order. You may receive this message before a backfill
         * but not during a backfill. You should make sure to only show the update with the
         * greatest change time. Change time will increase monotonically for each message
         * on each update.
         */
        UpdateMessage: Schema.object({
            type: Schema.value("UpdateMessage"),
            message: MessageSchema,
        }),

        /**
         * Update the typing state for some other connection to our realtime messaging
         * service.
         */
        UpdateOtherTypingState: Schema.object({
            type: Schema.value("UpdateOtherTypingState"),
            connectionId: Schema.id<WebSocketConnectionId>(),
            typingState: MessagingTypingStateSchema.nullable(),
        }),

        /**
         * A streaming message's part was updated (or created).
         */
        PutMessageStreamPart: Schema.object({
            type: Schema.value("PutMessageStreamPart"),
            index: Schema.integer.min(0),
            partIndex: Schema.integer.min(0),
            part: Schema.object({
                version: Schema.integer.min(0),
                payload: MessageStreamPartPayloadSchema,
                createdTime: Schema.date,
            }),
            references: ContentReferencesSchema,
            completedTime: Schema.date.nullable().default(null),
        }),

        /**
         * A message stream was completed.
         */
        CompleteMessageStream: Schema.object({
            type: Schema.value("CompleteMessageStream"),
            index: Schema.integer.min(0),
            completedTime: Schema.date,
        }),
    };
}

// This function should never be called, it is used to test that the type of
// `createMessagingRealtimeEventSchemas()` matches `MessagingRealtimeEvent`.
// And that our procedure types match
// `createMessagingRealtimeProcedureSchemas()`.
// You will get a TypeScript error when these don't match.
// eslint-disable-next-line @typescript-eslint/no-unused-vars
function testTypes(MessageSchema: Schema<any>) {
    {
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        const eventSchema = Schema.union(createMessagingRealtimeEventSchemas(MessageSchema));
        assertEqualTypes<typeof eventSchema, UnionSchema<MessagingRealtimeEvent<any>>>();
    }

    {
        const procedureSchemas = createMessagingRealtimeProcedureSchemas(MessageSchema);

        type Procedures = {
            [Name in keyof typeof procedureSchemas]: (
                input: ObjectSchemaConfigType<(typeof procedureSchemas)[Name]["input"]>,
            ) => Promise<ObjectSchemaConfigType<(typeof procedureSchemas)[Name]["output"]>>;
        };

        assertEqualTypes<Procedures, MessagingRealtimeProcedures<any>>();
    }
}

export type MessagingRealtimeBroadcastNewMessageRequest = SchemaType<
    typeof MessagingRealtimeBroadcastNewMessageRequestSchema
>;

export const MessagingRealtimeBroadcastNewMessageRequestSchema = Schema.object({
    index: Schema.integer.min(0),
    version: Schema.integer.min(0),
    authorId: Schema.id<AccountId>(),
    createdTime: Schema.date,
    createdTimeZone: TimeZoneSchema,
    payload: MessageContentPayloadSchema,
    stream: MessageStreamSchema.nullable(),
});

export type MessagingRealtimeBroadcastPutMessageStreamPartRequest = SchemaType<
    typeof MessagingRealtimeBroadcastPutMessageStreamPartRequestSchema
>;

export const MessagingRealtimeBroadcastPutMessageStreamPartRequestSchema = Schema.object({
    index: Schema.integer.min(0),
    partIndex: Schema.integer.min(0),
    part: Schema.object({
        version: Schema.integer.min(0),
        payload: MessageStreamPartPayloadSchema,
        createdTime: Schema.date,
    }),
    completedTime: Schema.date.nullable().default(null),
});

export type MessagingRealtimeBroadcastCompleteMessageStreamRequest = SchemaType<
    typeof MessagingRealtimeBroadcastCompleteMessageStreamRequestSchema
>;

export const MessagingRealtimeBroadcastCompleteMessageStreamRequestSchema = Schema.object({
    index: Schema.integer.min(0),
    completedTime: Schema.date,
});
