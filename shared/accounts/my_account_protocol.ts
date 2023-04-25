import {
    WebSocketProtocolEventType,
    defineWebSocketProtocol,
} from "~/shared/cloudflare/web_socket_protocol";
import {createDynamoGeneralRealtimeEventSchema} from "~/shared/dynamo/dynamo_general_realtime_types";
import {SpaceId} from "~/shared/id/types/id_types";
import {InboxItemModelSchema} from "~/shared/models/inbox_model";
import {Schema} from "~/shared/schema/schema";

export type MyAccountEvent = WebSocketProtocolEventType<typeof MyAccountProtocol>;

export const MyAccountProtocol = defineWebSocketProtocol({
    procedures: {
        backfillInbox: {
            input: {
                spaceId: Schema.id<SpaceId>(),
            },
            output: {},
        },
    },
    events: {
        InboxRealtimeEventTransaction: Schema.object({
            type: Schema.value("InboxRealtimeEventTransaction"),
            eventTransaction: Schema.array(
                createDynamoGeneralRealtimeEventSchema(InboxItemModelSchema),
            ),
        }),
    },
});
