import {Step} from "prosemirror-transform";
import {ContentReferences, ContentReferencesSchema} from "~/shared/content/content_references.js";
import {FileEntityId, FileIdOrFileEntityIdSchema} from "~/shared/files/file_entity_id.js";
import {assertEqualTypes} from "~/shared/helpers/control/assert_equal_types.js";
import {AccountId, FileId, WebSocketConnectionId} from "~/shared/id/types/id_types.js";
import {MessageChange, MessageChangeSchema} from "~/shared/messaging/message_change_schema.js";
import {
    MessageContent,
    MessageContentSchema,
    MessageContentStepSchema,
} from "~/shared/messaging/message_content_schema.js";
import {MessageModel} from "~/shared/messaging/message_model.js";
import {
    MessageContentPayloadParent,
    MessageContentPayloadParentSchema,
    MessageContentPayloadSchema,
    MessageStreamPartPayload,
    MessageStreamPartPayloadSchema,
    MessageStreamSchema,
} from "~/shared/messaging/message_schema.js";
import {ObjectSchemaConfigType, Schema, SchemaType, UnionSchema} from "~/shared/schema/schema.js";
import {AccountModel} from "~/shared/spaces/account_model.js";

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
    clientMessageCount: number;
    clientLastMessageChangeTime: Date | null;
    newMessageLimit: number;
}) => Promise<BackfillMessagesProcedureOutput<Message>>;

export type BackfillMessagesProcedureOutput<Message extends MessageModel> = {
    messageCount: number;
    lastMessageChangeTime: Date | null;
    newMessages: ReadonlyArray<Message>;
    newOtherReferencedMessages: ReadonlyArray<Message>;
    messageChangesResult:
        | {
              type: "Available";
              changes: ReadonlyArray<MessageChange>;
          }
        | {
              type: "Unavailable";
          };
    typingStateByConnectionId: ReadonlyMap<WebSocketConnectionId, MessagingTypingState>;
};

export type CreateMessageProcedure = (input: {
    parent: MessageContentPayloadParent | null;
    content: MessageContent;
    fileIds: ReadonlyArray<FileId | FileEntityId>;
}) => Promise<{}>;

export type UpdateMessageContentProcedure = (input: {
    messageIndex: number;
    version: number;
    steps: ReadonlyArray<Step>;
}) => Promise<{}>;

export type DeleteMessageProcedure = (input: {messageIndex: number}) => Promise<{}>;

export type StartTypingInMessageInputProcedure = (input: {}) => Promise<{}>;

export type StopTypingInMessageInputProcedure = (input: {}) => Promise<{}>;

export type MessagingRealtimeProcedures<Message extends MessageModel> = {
    backfillMessages: BackfillMessagesProcedure<Message>;
    createMessage: CreateMessageProcedure;
    updateMessageContent: UpdateMessageContentProcedure;
    deleteMessage: DeleteMessageProcedure;
    startTypingInMessageInput: StartTypingInMessageInputProcedure;
    stopTypingInMessageInput: StopTypingInMessageInputProcedure;
};

export function createMessagingRealtimeProcedureSchemas<Message extends MessageModel>(
    MessageSchema: Schema<Message>,
) {
    return {
        /**
         * When you connect to the messaging realtime WebSocket you should send a
         * `BackfillMessagesRequest`. You will not get `NewMessage` realtime
         * messages until you do.
         *
         * This makes sure the client and server are in sync about what the client's
         * state is. If the WebSocket server has received new messages since the client
         * loaded its data from the HTTP server then we will send a backfill response
         * with those new messages.
         */
        backfillMessages: {
            input: {
                clientMessageCount: Schema.integer,
                clientLastMessageChangeTime: Schema.date.nullable(),
                newMessageLimit: Schema.integer,
            },
            /**
             * Response to a backfill call. Contains the actual message count and an array
             * of new messages we should load.
             *
             * `typingStateByConnectionId` contains the typing state for all connected
             * clients. If a client does not exist in this map it means they have no typing
             * state. If you receive this message you should reset all your typing states
             * and treat this map as the new state.
             *
             * Ordering guarantee: After your first backfill `NewMessage` WebSocket events
             * will arrive in order. Before they may arrive out of order.
             */
            output: {
                messageCount: Schema.integer,
                lastMessageChangeTime: Schema.date.nullable(),
                newMessages: Schema.array(MessageSchema),
                newOtherReferencedMessages: Schema.array(MessageSchema),
                messageChangesResult: Schema.union({
                    Available: Schema.object({
                        type: Schema.value("Available"),
                        changes: Schema.array(MessageChangeSchema),
                    }),
                    Unavailable: Schema.object({
                        type: Schema.value("Unavailable"),
                    }),
                }),
                typingStateByConnectionId: Schema.map(
                    Schema.id<WebSocketConnectionId>(),
                    MessagingTypingStateSchema,
                ),
            },
        },

        /**
         * Create a new message and send a realtime message to all other connected
         * clients.
         */
        createMessage: {
            input: {
                parent: MessageContentPayloadParentSchema.nullable(),
                content: MessageContentSchema,
                fileIds: Schema.array(FileIdOrFileEntityIdSchema),
            },
            output: {},
        },

        /**
         * Update the contents of a message and send a realtime message to all
         * other connected clients.
         */
        updateMessageContent: {
            input: {
                messageIndex: Schema.integer,
                version: Schema.integer,
                steps: Schema.array(MessageContentStepSchema),
            },
            output: {},
        },

        /**
         * Delete a message and send a realtime message to all other connected
         * clients.
         */
        deleteMessage: {
            input: {
                messageIndex: Schema.integer,
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
          readonly type: "ChangeMessage";
          readonly change: MessageChange;
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
          };
          readonly references: ContentReferences;
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
         * A new message was created! The message could have been created by our
         * account or a different account. Or our account on a different browser.
         *
         * Ordering guarantee: After you have sent a `BackfillMessagesRequest` and
         * received a `BackfillMessagesResponse`. After that you are guaranteed to get
         * every message in order. You will not get message N+1 before message N,
         * you'll always get message N first and then message N+1.
         *
         * You will not get new messages during a backfill. Before a backfill you will
         * receive new messages in any arbitrary order. So message N+1 may arrive
         * before message N. Generally you should ignore this message until after your
         * backfill finishes. This behavior is useful for documents where we want to
         * update the comment thread count when new messages are created but we don't
         * care about strict message ordering until the user opens the comment thread
         * (and we send the backfill request).
         */
        NewMessage: Schema.object({
            type: Schema.value("NewMessage"),
            message: MessageSchema,
            /**
             * Atomically update this other typing state in the same action as we send
             * a message.
             */
            updateOtherTypingState: Schema.object({
                connectionId: Schema.id<WebSocketConnectionId>(),
                typingState: MessagingTypingStateSchema.nullable(),
            }).nullable(),
        }),

        /**
         * A message was changed.
         *
         * Ordering guarantee: There are no ordering guarantees. You may receive an
         * update message at any time in any order. You may receive this message before
         * a backfill but not during a backfill. You should make sure to only show
         * the update with the greatest change time. Change time will increase
         * monotonically for each message on each update.
         */
        ChangeMessage: Schema.object({
            type: Schema.value("ChangeMessage"),
            change: MessageChangeSchema,
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
            }),
            references: ContentReferencesSchema,
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
    authorId: Schema.id<AccountId>(),
    createdTime: Schema.date,
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
    }),
});

export type MessagingRealtimeBroadcastCompleteMessageStreamRequest = SchemaType<
    typeof MessagingRealtimeBroadcastCompleteMessageStreamRequestSchema
>;

export const MessagingRealtimeBroadcastCompleteMessageStreamRequestSchema = Schema.object({
    index: Schema.integer.min(0),
    completedTime: Schema.date,
});
