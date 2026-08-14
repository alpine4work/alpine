import {RynamoEventStubSchema, createRynamoEventSchema} from "~/shared/dynamo/rynamo_types.js";
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

export type RynamoChannelOrPostEvent = SchemaType<typeof RynamoChannelOrPostEventSchema>;

export const RynamoChannelOrPostEventSchema = createRynamoEventSchema(
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
        RealtimeEvents: Schema.object({
            type: Schema.value("RealtimeEvents"),
            events: Schema.array(RynamoChannelOrPostEventSchema),
        }),
    },
});

export const ChannelBroadcastRealtimeEventsSchema = Schema.object({
    events: Schema.array(RynamoEventStubSchema),
});
