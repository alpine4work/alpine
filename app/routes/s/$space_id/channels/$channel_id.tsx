import {Box} from "~/client/design/box";
import {ChannelView} from "~/client/forum/channel_view";
import {postContentViewMinHeight} from "~/client/forum/post_content_view";
import {createMetaFunction} from "~/client/remix/create_meta_function";
import {useLoaderDataWithSchema} from "~/client/remix/use_loader_data_with_schema";
import {getInitialVirtualizedScrollViewRenderedItemCount} from "~/client/virtualized/virtualized_scroll_view";
import {getChannel} from "~/server/dynamo/forum_table";
import {jsonWithSchema} from "~/server/remix/json_with_schema";
import {LoaderArgs} from "~/server/remix/loader_context";
import {ChannelModel} from "~/shared/forum/channel_model";
import {PostModel} from "~/shared/forum/post_model";
import {runAllPromises} from "~/shared/helpers/async/run_all_promises";
import {ChannelId} from "~/shared/id/types/id_types";
import {getChannelPosts} from "~/shared/rpc/forum_rpc_definitions";
import {Schema} from "~/shared/schema/schema";
import {TracerEventData} from "~/shared/tracer/types/tracer_event_data";

const LoaderSchema = Schema.object({
    channel: ChannelModel.schema(),
    channelPostsResult: Schema.object({
        hasMorePosts: Schema.boolean,
        posts: Schema.array(PostModel.schema()),
    }),
});

export async function loader({params, context: unauthenticatedContext}: LoaderArgs) {
    const channelId = Schema.id<ChannelId>().deserialize(params.channel_id ?? null);
    const context = await unauthenticatedContext.actor.authenticate();

    const [channel, channelPostsResult] = await runAllPromises([
        getChannel(context, channelId),
        getChannelPosts(context, {
            channelId,
            limit: getInitialVirtualizedScrollViewRenderedItemCount(
                context.loader.clientInfo,
                postContentViewMinHeight,
            ),
        }),
    ]);

    const propagateEventData: TracerEventData = {
        context: {channelId},
    };

    return jsonWithSchema(LoaderSchema, {channel, channelPostsResult}, {propagateEventData});
}

export const meta = createMetaFunction(LoaderSchema, ({data: {channel}}) => ({
    title: channel.name,
}));

export default function ChannelRoute() {
    const {channel, channelPostsResult} = useLoaderDataWithSchema(LoaderSchema);

    return (
        // Strange format to override the `<SpaceLayoutTopBar>` bottom border with a
        // lighter color since our `<ChannelView>` has a top bar of its own. We use a
        // lighter border so the two top bars look to be made of the same material.
        <Box
            flexGrow="1"
            overflow="hidden"
            position="relative"
            zIndex="20"
            borderTop="grey-5"
            style={{height: "calc(100% + 1px)", marginTop: -1}}
        >
            <ChannelView
                // Remount when navigating to a different channel.
                key={channel.id}
                initialChannel={channel}
                initialChannelPostsResult={channelPostsResult}
            />
        </Box>
    );
}
