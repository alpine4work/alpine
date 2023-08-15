import {ChatMessageModel} from "~/shared/chat/chat_model.js";
import {
    WebSocketProtocolEventType,
    defineWebSocketProtocol,
} from "~/shared/web_socket/web_socket_protocol.js";
import {
    createMessagingRealtimeEventSchemas,
    createMessagingRealtimeProcedureSchemas,
} from "~/shared/messaging/messaging_realtime_protocol.js";

export type ChatRealtimeEvent = WebSocketProtocolEventType<typeof ChatRealtimeProtocol>;

export const ChatRealtimeProtocol = defineWebSocketProtocol({
    procedures: createMessagingRealtimeProcedureSchemas(ChatMessageModel.schema()),
    events: createMessagingRealtimeEventSchemas(ChatMessageModel.schema()),
});
