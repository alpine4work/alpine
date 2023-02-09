import {useState} from "react";
import {postContentViewMinHeight} from "~/client/forum/post_content_view";
import {PostList} from "~/client/forum/post_list";
import {PostListView} from "~/client/forum/post_list_view";
import {useLoaderDataWithSchema} from "~/client/remix/use_loader_data_with_schema";
import {getInitialVirtualizedScrollViewRenderedItemCount} from "~/client/virtualized/virtualized_scroll_view";
import {getChannel, getChannelPosts} from "~/server/dynamo/forum_table";
import {jsonWithSchema} from "~/server/remix/json_with_schema";
import {LoaderArgs} from "~/server/remix/loader_context";
import {NotFoundError} from "~/shared/error/error";
import {ChannelId} from "~/shared/id/types/id_types";
import {ChannelModel} from "~/shared/models/channel_model";
import {PostModel} from "~/shared/models/post_model";
import {Schema} from "~/shared/schema/schema";
import {sprinkles} from "~/shared/styles/styles";
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
    const context = await unauthenticatedContext.auth.authenticate();

    const channelPromise = getChannel(context, channelId);

    const channelPostsResultPromise = getChannelPosts(context, {
        channelId,
        limit: getInitialVirtualizedScrollViewRenderedItemCount(
            context.loader.clientInfo,
            postContentViewMinHeight,
        ),
    });

    const channel = await channelPromise;
    if (!channel) throw new NotFoundError("Channel not found");

    const channelPostsResult = await channelPostsResultPromise;

    const propagateEventData: TracerEventData = {
        context: {channelId},
    };

    return jsonWithSchema(LoaderSchema, {channel, channelPostsResult}, {propagateEventData});
}

export default function ChannelRoute() {
    const {channel, channelPostsResult} = useLoaderDataWithSchema(LoaderSchema);

    const [list, setList] = useState(() =>
        PostList.empty.setChannelHeader({channel}).insertManyAtStart(channelPostsResult.posts),
    );

    return (
        <main className={sprinkles({height: "full"})}>
            <PostListView
                list={list}
                onTogglePostComments={index => setList(list => list.togglePostComments(index))}
                onUpdatePostComments={(postId, update) =>
                    setList(list => list.updatePostComments(postId, update))
                }
            />
        </main>
    );
}
