import {MessageContentSchema} from "~/shared/content/message_content_schema";
import {WebSocketConnectionId} from "~/shared/id/types/id_types";
import {MessageChange, MessageChangeSchema} from "~/shared/messaging/message_change_schema";
import {AccountModel} from "~/shared/models/account_model";
import {MessageModel} from "~/shared/models/message_model";
import {Schema, SchemaType} from "~/shared/schema/schema";

export type MessagingTypingState = SchemaType<typeof MessagingTypingStateSchema>;

/**
 * If a user is actively typing in their message input we will send typing state
 */
export const MessagingTypingStateSchema = Schema.object({
    isTyping: Schema.value(true),
    startTime: Schema.date,
    account: AccountModel.schema(),
});

export type MessagingRealtimeMessageFromClient = SchemaType<
    typeof MessagingRealtimeMessageFromClientSchema
>;

export const MessagingRealtimeMessageFromClientSchema = Schema.union({
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
    BackfillMessagesRequest: Schema.object({
        type: Schema.value("BackfillMessagesRequest"),
        clientMessageCount: Schema.integer,
        clientLastMessageChangeTime: Schema.date.nullable(),
        newMessageLimit: Schema.integer,
    }),

    /**
     * Create a new message and send a realtime message to all other connected
     * clients.
     */
    CreateMessage: Schema.object({
        type: Schema.value("CreateMessage"),
        parentMessageIndex: Schema.integer.nullable(),
        content: MessageContentSchema,
    }),

    /**
     * Update the contents of a message and send a realtime message to all
     * other connected clients.
     */
    UpdateMessageContent: Schema.object({
        type: Schema.value("UpdateMessageContent"),
        messageIndex: Schema.integer,
        content: MessageContentSchema,
    }),

    /**
     * Delete a message and send a realtime message to all other connected
     * clients.
     */
    DeleteMessage: Schema.object({
        type: Schema.value("DeleteMessage"),
        messageIndex: Schema.integer,
    }),

    /**
     * Has the client started typing in their message input?
     */
    StartTyping: Schema.object({
        type: Schema.value("StartTyping"),
    }),

    /**
     * Has the client stopped typing in their message input?
     */
    StopTyping: Schema.object({
        type: Schema.value("StopTyping"),
    }),
});

export type MessagingRealtimeMessageFromServer<Message extends MessageModel> =
    | {
          readonly type: "BackfillMessagesResponse";
          readonly messageCount: number;
          readonly lastMessageChangeTime: Date | null;
          readonly newMessages: ReadonlyArray<Message>;
          readonly newOtherReferencedMessages: ReadonlyArray<Message>;
          readonly messageChangesResult:
              | {
                    readonly type: "Available";
                    readonly changes: ReadonlyArray<MessageChange>;
                }
              | {
                    readonly type: "Unavailable";
                };
          readonly typingStateByConnectionId: ReadonlyMap<
              WebSocketConnectionId,
              MessagingTypingState
          >;
      }
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
      };

export function createMessagingRealtimeMessageFromServerSchema<Message extends MessageModel>(
    _MessageSchema: Schema<Message>,
): Schema<MessagingRealtimeMessageFromServer<Message>> {
    // A generic type in `Schema` confuses `Optionalize` so treat message schema as
    // any within this function.
    const MessageSchema = _MessageSchema as Schema<any>;

    return Schema.union({
        /**
         * Response to a `BackfillMessagesRequest` message. Contains the actual
         * message count and an array of new messages we should load.
         *
         * `typingStateByConnectionId` contains the typing state for all connected
         * clients. If a client does not exist in this map it means they have no typing
         * state. If you receive this message you should reset all your typing states
         * and treat this map as the new state.
         *
         * Ordering guarantee: You will get no `NewMessage` WebSocket messages until
         * your first `BackfillMessagesResponse` WebSocket message.
         */
        BackfillMessagesResponse: Schema.object({
            type: Schema.value("BackfillMessagesResponse"),
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
        }),

        /**
         * A new message was created! The message could have been created by our
         * account or a different account. Or our account on a different browser.
         *
         * Ordering guarantee: You will get no `NewMessage` WebSocket messages until
         * you have sent `BackfillMessagesRequest` and received a
         * `BackfillMessagesResponse`. After that you are guaranteed to get every
         * message in order. You will not get message N+1 before message N, you'll
         * always get message N first and then message N+1.
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
         * update message at any time in any order. You should make sure to only show
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
    });
}
