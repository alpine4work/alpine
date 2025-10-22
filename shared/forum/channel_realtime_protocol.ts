import {
    DynamoGeneralRealtimeEventStubSchema,
    createDynamoGeneralRealtimeEventSchema,
} from "~/shared/dynamo/dynamo_general_realtime_types.js";
import {
    ChannelContributorsModel,
    ChannelModel,
    ChannelPostFilesModel,
} from "~/shared/forum/channel_model.js";
import {PostModel} from "~/shared/forum/post_model.js";
import {createModelUnionSchema} from "~/shared/schema/model/create_model_union_schema.js";
import {Schema, SchemaType} from "~/shared/schema/schema.js";
import {
    WebSocketProtocolEventType,
    defineWebSocketProtocol,
} from "~/shared/web_socket/web_socket_protocol.js";

export type DynamoGeneralRealtimeChannelOrPostEvent = SchemaType<
    typeof DynamoGeneralRealtimeChannelOrPostEventSchema
>;

export const DynamoGeneralRealtimeChannelOrPostEventSchema = createDynamoGeneralRealtimeEventSchema(
    createModelUnionSchema({
        Channel: ChannelModel,
        ChannelContributors: ChannelContributorsModel,
        ChannelPostFiles: ChannelPostFilesModel,
        Post: PostModel,
    }),
);

export type ChannelRealtimeEvent = WebSocketProtocolEventType<typeof ChannelRealtimeProtocol>;

export const ChannelRealtimeProtocol = defineWebSocketProtocol({
    procedures: {},
    events: {
        RealtimeEventTransaction: Schema.object({
            type: Schema.value("RealtimeEventTransaction"),
            eventTransaction: Schema.array(DynamoGeneralRealtimeChannelOrPostEventSchema),
        }),
    },
});

export const ChannelBroadcastRealtimeEventTransactionSchema = Schema.object({
    eventTransaction: Schema.array(DynamoGeneralRealtimeEventStubSchema),
});
