import {useLoaderDataWithSchema} from "~/client/remix/use_loader_data_with_schema";
import {getChannel} from "~/server/dynamo/channels_table";
import {jsonWithSchema} from "~/server/remix/json_with_schema";
import {LoaderArgs} from "~/server/remix/loader_context";
import {ChannelModel} from "~/shared/channels/channel_model";
import {NotFoundError} from "~/shared/error/error";
import {Schema} from "~/shared/schema/schema";
import {TracerEventData} from "~/shared/tracer/types/tracer_event_data";

const schema = Schema.object({
    channel: ChannelModel.schema(),
});

export async function loader({params, context}: LoaderArgs) {
    const channelId = Schema.id.deserialize(params.channel_id ?? null);

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
        <main>
            <h1>{channel.name}</h1>
        </main>
    );
}
