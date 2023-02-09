import {Box} from "~/client/design/box";
import {Spacer} from "~/client/design/spacer";
import {PostCreator} from "~/client/posts/post_creator";
import {useLoaderDataWithSchema} from "~/client/remix/use_loader_data_with_schema";
import {getChannel} from "~/server/dynamo/forum_table";
import {jsonWithSchema} from "~/server/remix/json_with_schema";
import {LoaderArgs} from "~/server/remix/loader_context";
import {Spacing} from "~/shared/design/spacing";
import {NotFoundError} from "~/shared/error/error";
import {ChannelId} from "~/shared/id/types/id_types";
import {ChannelModel} from "~/shared/models/channel_model";
import {Schema} from "~/shared/schema/schema";
import {sprinkles} from "~/shared/styles/styles";
import {TracerEventData} from "~/shared/tracer/types/tracer_event_data";

const LoaderSchema = Schema.object({
    channel: ChannelModel.schema(),
});

const padding: Spacing = "4";

export async function loader({params, context}: LoaderArgs) {
    const channelId = Schema.id<ChannelId>().deserialize(params.channel_id ?? null);

    const channel = await getChannel(await context.auth.authenticate(), channelId);
    if (!channel) throw new NotFoundError("Channel not found");

    const propagateEventData: TracerEventData = {
        context: {channelId},
    };

    return jsonWithSchema(LoaderSchema, {channel}, {propagateEventData});
}

export default function ChannelRoute() {
    const {channel} = useLoaderDataWithSchema(LoaderSchema);

    return (
        <main className={sprinkles({height: "full"})}>
            <h1>{channel.name}</h1>
            <Spacer space="6" />
            <div className={sprinkles({paddingX: padding})}>
                <div
                    className={sprinkles({
                        marginX: "auto",
                        maxWidth: "160",
                        backgroundColor: "grey-0",
                        borderRadius: "md",
                        boxShadow: "elevation-5",
                    })}
                >
                    <PostCreator channelId={channel.id} />
                </div>
            </div>
        </main>
    );
}
