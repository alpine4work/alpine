import {
    DynamoGeneralRealtimeEventStubSchema,
    createDynamoGeneralRealtimeEventSchema,
} from "~/shared/dynamo/dynamo_general_realtime_types.js";
import {Schema, SchemaType} from "~/shared/schema/schema.js";
import {SiteOrSiteEntryModelSchema} from "~/shared/sites/site_model.js";
import {
    WebSocketProtocolEventType,
    defineWebSocketProtocol,
} from "~/shared/web_socket/web_socket_protocol.js";

/**
 * Schema for realtime events that can occur in a Site partition. Includes both
 * site attribute changes and site item changes.
 */
export type DynamoGeneralRealtimeSiteEvent = SchemaType<
    typeof DynamoGeneralRealtimeSiteEventSchema
>;

export const DynamoGeneralRealtimeSiteEventSchema = createDynamoGeneralRealtimeEventSchema(
    SiteOrSiteEntryModelSchema,
);

export type SiteRealtimeEvent = WebSocketProtocolEventType<typeof SiteRealtimeProtocol>;

/**
 * WebSocket protocol for Site realtime updates. Clients connect to receive updates
 * when site attributes or items change.
 */
export const SiteRealtimeProtocol = defineWebSocketProtocol({
    procedures: {},
    events: {
        RealtimeEventTransaction: Schema.object({
            type: Schema.value("RealtimeEventTransaction"),
            eventTransaction: Schema.array(DynamoGeneralRealtimeSiteEventSchema),
        }),
    },
});

/**
 * Schema for broadcasting realtime event stubs to the durable object. Stubs are
 * transformed to full events with authorization before being sent to connected
 * clients.
 */
export const SiteBroadcastRealtimeEventTransactionSchema = Schema.object({
    eventTransaction: Schema.array(DynamoGeneralRealtimeEventStubSchema),
});
