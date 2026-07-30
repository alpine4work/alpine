import {createRynamoEventSchema} from "~/shared/dynamo/rynamo_types.js";
import {InboxItemModelSchema} from "~/shared/notifications/inbox_model.js";
import {Schema, SchemaType} from "~/shared/schema/schema.js";
import {
    WebSocketProtocolEventType,
    defineWebSocketProtocol,
} from "~/shared/web_socket/web_socket_protocol.js";

export type RynamoInboxItemEvent = SchemaType<typeof RynamoInboxItemEventSchema>;

const RynamoInboxItemEventSchema = createRynamoEventSchema(InboxItemModelSchema);

export type MyAccountEvent = WebSocketProtocolEventType<typeof MyAccountProtocol>;

export const MyAccountProtocol = defineWebSocketProtocol({
    procedures: {},
    events: {
        InboxRealtimeEvents: Schema.object({
            type: Schema.value("InboxRealtimeEvents"),
            events: Schema.array(RynamoInboxItemEventSchema),
        }),
    },
});

export const MyAccountBroadcastInboxRealtimeEventsSchema = Schema.object({
    events: Schema.array(RynamoInboxItemEventSchema),
});
