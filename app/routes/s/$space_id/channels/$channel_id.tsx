import {Box} from "~/client/design/box";
import {Spacer} from "~/client/design/spacer";
import {PostCreator} from "~/client/posts/post_creator";
import {useLoaderDataWithSchema} from "~/client/remix/use_loader_data_with_schema";
import {getChannel} from "~/server/dynamo/channels_table";
import {jsonWithSchema} from "~/server/remix/json_with_schema";
import {LoaderArgs} from "~/server/remix/loader_context";
import {ChannelModel} from "~/shared/channels/channel_model";
import {NotFoundError} from "~/shared/error/error";
import {ChannelId} from "~/shared/id/types/id_types";
import {Schema} from "~/shared/schema/schema";
import {sprinkles} from "~/shared/styles/styles";
import {TracerEventData} from "~/shared/tracer/types/tracer_event_data";

const schema = Schema.object({
    channel: ChannelModel.schema(),
});

export async function loader({params, context}: LoaderArgs) {
    const channelId = Schema.id<ChannelId>().deserialize(params.channel_id ?? null);

    const channel = await getChannel(await context.auth.authenticate(), channelId);
    if (!channel) throw new NotFoundError("Channel not found");

    const propagateEventData: TracerEventData = {
        context: {channelId},
    };

    return jsonWithSchema(schema, {channel}, {propagateEventData});
}

export default function ChannelRoute() {
    const {channel} = useLoaderDataWithSchema(schema);

    return (
        <main
            className={sprinkles({
                height: "full",
                display: "flex",
                justifyContent: "center",
                backgroundColor: {light: "grey-5", dark: "grey-0"},
            })}
        >
            <Box maxWidth="160" width="full" padding="4">
                <h1>{channel.name}</h1>
                <Spacer space="6" />
                <PostCreator />
            </Box>
        </main>
    );
}
