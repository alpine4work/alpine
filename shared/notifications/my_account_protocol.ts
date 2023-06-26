import {
    WebSocketProtocolEventType,
    defineWebSocketProtocol,
} from "~/shared/cloudflare/web_socket_protocol.js";
import {createDynamoGeneralRealtimeEventSchema} from "~/shared/dynamo/dynamo_general_realtime_types.js";
import {InboxItemModelSchema} from "~/shared/notifications/inbox_model.js";
import {Schema} from "~/shared/schema/schema.js";

export type MyAccountEvent = WebSocketProtocolEventType<typeof MyAccountProtocol>;

export const MyAccountProtocol = defineWebSocketProtocol({
    procedures: {},
    events: {
        InboxRealtimeEventTransaction: Schema.object({
            type: Schema.value("InboxRealtimeEventTransaction"),
            readTime: Schema.date,
            eventTransaction: Schema.array(
                createDynamoGeneralRealtimeEventSchema(InboxItemModelSchema),
            ),
        }),
    },
});
