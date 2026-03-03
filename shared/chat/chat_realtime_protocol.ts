import {AccessPolicySchema} from "~/shared/access/access_policy.js";
import {ShareNotificationSchema} from "~/shared/access/share_notification.js";
import {ChatMessageModel, ChatModel} from "~/shared/chat/chat_model.js";
import {
    createMessagingRealtimeEventSchemas,
    createMessagingRealtimeProcedureSchemas,
} from "~/shared/messaging/messaging_realtime_protocol.js";
import {Schema} from "~/shared/schema/schema.js";
import {
    WebSocketProtocolEventType,
    defineWebSocketProtocol,
} from "~/shared/web_socket/web_socket_protocol.js";

export type ChatRealtimeEvent = WebSocketProtocolEventType<typeof ChatRealtimeProtocol>;

export const ChatRealtimeProtocol = defineWebSocketProtocol({
    procedures: {
        ...createMessagingRealtimeProcedureSchemas(ChatMessageModel.schema()),

        convertDirectChatToRoomChat: {
            input: {
                name: Schema.string,
            },
            output: {
                chat: ChatModel.schema(),
            },
        },

        updateRoomChatName: {
            input: {
                name: Schema.string,
            },
            output: {
                chat: ChatModel.schema(),
            },
        },

        updateRoomChatAccessPolicy: {
            input: {
                accessPolicy: AccessPolicySchema,
                notification: ShareNotificationSchema.nullable(),
            },
            output: {
                chat: ChatModel.schema(),
            },
        },
    },
    events: {
        ...createMessagingRealtimeEventSchemas(ChatMessageModel.schema()),

        /**
         * Was `ChatModel` updated? For instance when converting a direct chat to a room
         * chat or updating a room chat's name.
         */
        UpdateChat: Schema.object({
            type: Schema.value("UpdateChat"),
            chat: ChatModel.schema(),
        }),
    },
});
