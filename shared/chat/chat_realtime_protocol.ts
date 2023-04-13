import {
    WebSocketProtocolEventType,
    defineWebSocketProtocol,
} from "~/shared/cloudflare/web_socket_protocol";
import {
    createMessagingRealtimeEventSchemas,
    createMessagingRealtimeProcedureSchemas,
} from "~/shared/messaging/messaging_realtime_protocol";
import {ChatMessageModel} from "~/shared/models/chat_model";

export type ChatRealtimeEvent = WebSocketProtocolEventType<typeof ChatRealtimeProtocol>;

export const ChatRealtimeProtocol = defineWebSocketProtocol({
    procedures: createMessagingRealtimeProcedureSchemas(ChatMessageModel.schema()),
    events: createMessagingRealtimeEventSchemas(ChatMessageModel.schema()),
});
