import {ChatMessageModel} from "~/shared/chat/chat_model";
import {
    WebSocketProtocolEventType,
    defineWebSocketProtocol,
} from "~/shared/cloudflare/web_socket_protocol";
import {
    createMessagingRealtimeEventSchemas,
    createMessagingRealtimeProcedureSchemas,
} from "~/shared/messaging/messaging_realtime_protocol";

export type ChatRealtimeEvent = WebSocketProtocolEventType<typeof ChatRealtimeProtocol>;

export const ChatRealtimeProtocol = defineWebSocketProtocol({
    procedures: createMessagingRealtimeProcedureSchemas(ChatMessageModel.schema()),
    events: createMessagingRealtimeEventSchemas(ChatMessageModel.schema()),
});
