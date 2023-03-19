import {
    MessagingRealtimeMessageFromClientSchema,
    createMessagingRealtimeMessageFromServerSchema,
} from "~/shared/messaging/messaging_realtime_schema";
import {ChatMessageModel} from "~/shared/models/chat_model";
import {Schema, SchemaType} from "~/shared/schema/schema";

export type ChatRealtimeMessageFromClient = SchemaType<typeof ChatRealtimeMessageFromClientSchema>;

export const ChatRealtimeMessageFromClientSchema = Schema.union({
    /**
     * Some realtime message regarding this chat's messages.
     */
    ChatMessages: Schema.object({
        type: Schema.value("ChatMessages"),
        message: MessagingRealtimeMessageFromClientSchema,
    }),
});

export type ChatRealtimeMessageFromServer = SchemaType<typeof ChatRealtimeMessageFromServerSchema>;

export const ChatRealtimeMessageFromServerSchema = Schema.union({
    /**
     * Some realtime message regarding this chat's messages.
     */
    ChatMessages: Schema.object({
        type: Schema.value("ChatMessages"),
        message: createMessagingRealtimeMessageFromServerSchema(ChatMessageModel.schema()),
    }),
});
