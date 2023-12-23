import {Box} from "~/client/design/box.js";
import {ChannelView} from "~/client/forum/channel_view.js";
import {postContentViewMinHeight} from "~/client/forum/post_content_view.js";
import {createMetaFunction} from "~/client/remix/create_meta_function.js";
import {useLoaderDataWithSchema} from "~/client/remix/use_loader_data_with_schema.js";
import {useSearchEntityAffinityViewInteraction} from "~/client/search/use_search_entity_view_affinity_interaction.js";
import {getInitialVirtualizedScrollViewRenderedItemCount} from "~/client/virtualized/virtualized_scroll_view.js";
import {getChannel} from "~/server/forum/data/forum_table.js";
import {jsonWithSchema} from "~/server/remix/json_with_schema.js";
import {LoaderArgs} from "~/server/remix/loader_context.js";
import {ChannelModel} from "~/shared/forum/channel_model.js";
import {PostModel} from "~/shared/forum/post_model.js";
import {runAllPromises} from "~/shared/helpers/async/run_all_promises.js";
import {ChannelId} from "~/shared/id/types/id_types.js";
import {getChannelPosts} from "~/shared/rpc/forum_rpc_definitions.js";
import {Schema} from "~/shared/schema/schema.js";
import {TracerEventData} from "~/shared/tracer/types/tracer_event_data.js";

const LoaderSchema = Schema.object({
    channel: ChannelModel.schema(),
    channelPostsResult: Schema.object({
        hasMorePosts: Schema.boolean,
        posts: Schema.array(PostModel.schema()),
    }),
});

export async function loader({params, context: unauthenticatedContext}: LoaderArgs) {
    const channelId = Schema.id<ChannelId>().deserialize(params.channelId ?? null);
    const context = await unauthenticatedContext.actor.authenticate();

    const [channel, channelPostsResult] = await runAllPromises([
        getChannel(context, channelId),
        getChannelPosts(context, {
            channelId,
            limit: getInitialVirtualizedScrollViewRenderedItemCount(
                context.loader.getClientInfo(),
                postContentViewMinHeight,
            ),
        }),
    ]);

    const propagateEventData: TracerEventData = {
        context: {channelId},
    };

    return jsonWithSchema(LoaderSchema, {channel, channelPostsResult}, {propagateEventData});
}

export const meta = createMetaFunction(LoaderSchema, ({data: {channel}}) => [
    {title: channel.name},
]);

export default function ChannelRoute() {
    const {channel, channelPostsResult} = useLoaderDataWithSchema(LoaderSchema);

    useSearchEntityAffinityViewInteraction(`Channel:${channel.id}`);

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
