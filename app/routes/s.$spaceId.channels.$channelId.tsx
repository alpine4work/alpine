import {Box} from "~/client/design/box.js";
import {ChannelView} from "~/client/forum/channel_view.js";
import {postContentViewMinHeightWithClosedCommentSection} from "~/client/forum/post_content_view.js";
import {createMetaFunction} from "~/client/remix/create_meta_function.js";
import {useLoaderDataWithSchema} from "~/client/remix/use_loader_data_with_schema.js";
import {useSearchAffinityViewInteraction} from "~/client/search/use_search_affinity_view_interaction.js";
import {getInitialVirtualizedScrollViewRenderedItemCount} from "~/client/virtualized/virtualized_scroll_view.js";
import {getChannel} from "~/server/forum/data/forum_table.js";
import {jsonWithSchema} from "~/server/remix/json_with_schema.js";
import {LoaderArgs} from "~/server/remix/loader_context.js";
import {
    createDynamoGeneralRealtimeIndexQuerySchema,
    createDynamoGeneralRealtimeItemSchema,
} from "~/shared/dynamo/dynamo_general_realtime_types.js";
import {ChannelModel} from "~/shared/forum/channel_model.js";
import {PostModel} from "~/shared/forum/post_model.js";
import {runAllPromises} from "~/shared/helpers/async/run_all_promises.js";
import {ChannelId} from "~/shared/id/types/id_types.js";
import {getChannelPosts} from "~/shared/rpc/forum_rpc_definitions.js";
import {Schema} from "~/shared/schema/schema.js";
import {TracerEventData} from "~/shared/tracer/types/tracer_event_data.js";

const LoaderSchema = Schema.object({
    channel: createDynamoGeneralRealtimeItemSchema(ChannelModel.schema()),
    postsResult: createDynamoGeneralRealtimeIndexQuerySchema(PostModel.schema()),
});

export async function loader({params, context: unauthenticatedContext}: LoaderArgs) {
    const channelId = Schema.id<ChannelId>().deserialize(params.channelId ?? null);
    const context = await unauthenticatedContext.actor.authenticate();

    const [channel, {postsResult}] = await runAllPromises([
        getChannel(context, channelId),
        getChannelPosts(context, {
            channelId,
            limit: getInitialVirtualizedScrollViewRenderedItemCount(
                context.loader.getClientInfo(),
                postContentViewMinHeightWithClosedCommentSection,
            ),
            beforeCursor: null,
        }),
    ]);

    const propagateEventData: TracerEventData = {
        context: {channelId},
    };

    return jsonWithSchema(LoaderSchema, {channel, postsResult}, {propagateEventData});
}

export const meta = createMetaFunction(LoaderSchema, ({data: {channel}}) => [
    {title: channel.model.name},
]);

export default function ChannelRoute({withMobileLayout = false}: {withMobileLayout?: boolean}) {
    const {channel, postsResult} = useLoaderDataWithSchema(LoaderSchema);

    useSearchAffinityViewInteraction(`Channel:${channel.model.id}`);

    return (
        <Box flexGrow="1" overflow="hidden" position="relative" zIndex="20" height="full">
            <ChannelView
                // Remount when navigating to a different channel.
                key={channel.model.id}
                withMobileLayout={withMobileLayout}
                initialChannel={channel}
                initialPostsResult={postsResult}
            />
        </Box>
    );
}
