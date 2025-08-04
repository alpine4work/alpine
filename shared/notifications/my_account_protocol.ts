import {createDynamoGeneralRealtimeEventSchema} from "~/shared/dynamo/dynamo_general_realtime_types.js";
import {InboxItemModelSchema} from "~/shared/notifications/inbox_model.js";
import {Schema, SchemaType} from "~/shared/schema/schema.js";
import {
    WebSocketProtocolEventType,
    defineWebSocketProtocol,
} from "~/shared/web_socket/web_socket_protocol.js";

export type DynamoGeneralRealtimeInboxItemEvent = SchemaType<
    typeof DynamoGeneralRealtimeInboxItemEventSchema
>;

const DynamoGeneralRealtimeInboxItemEventSchema =
    createDynamoGeneralRealtimeEventSchema(InboxItemModelSchema);

export type MyAccountEvent = WebSocketProtocolEventType<typeof MyAccountProtocol>;

export const MyAccountProtocol = defineWebSocketProtocol({
    procedures: {},
    events: {
        InboxRealtimeEventTransaction: Schema.object({
            type: Schema.value("InboxRealtimeEventTransaction"),
            readTime: Schema.date,
            eventTransaction: Schema.array(DynamoGeneralRealtimeInboxItemEventSchema),
        }),
    },
});

export const MyAccountBroadcastInboxRealtimeEventTransactionSchema = Schema.object({
    readTime: Schema.date,
    eventTransaction: Schema.array(DynamoGeneralRealtimeInboxItemEventSchema),
});
