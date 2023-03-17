import {MessageContentSchema} from "~/shared/content/message_content_schema";
import {MessageChange, MessageChangeSchema} from "~/shared/messaging/message_change_schema";
import {MessageModel} from "~/shared/models/message_model";
import {Schema, SchemaType} from "~/shared/schema/schema";

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
      }
    | {
          readonly type: "NewMessage";
          readonly message: Message;
      }
    | {
          readonly type: "ChangeMessage";
          readonly change: MessageChange;
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
    });
}
