import {useCallback, useState} from "react";
import {useAppContext} from "~/client/context/app_context.js";
import {postContentViewMinHeight} from "~/client/forum/post_content_view.js";
import {PostBasicList} from "~/client/forum/post_list.js";
import {PostListView} from "~/client/forum/post_list_view.js";
import {useLoaderDataWithSchema} from "~/client/remix/use_loader_data_with_schema.js";
import {metaTitlePostfix} from "~/client/remix/use_update_meta_title.js";
import {useSearchAffinityViewInteraction} from "~/client/search/use_search_affinity_view_interaction.js";
import {useSpaceContext} from "~/client/spaces/space_context.js";
import {getInitialVirtualizedScrollViewRenderedItemCount} from "~/client/virtualized/virtualized_scroll_view.js";
import {jsonWithSchema} from "~/server/remix/json_with_schema.js";
import {LoaderArgs} from "~/server/remix/loader_context.js";
import {InvalidArgumentError} from "~/shared/error/error.js";
import {PostModel} from "~/shared/forum/post_model.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.js";
import {isId} from "~/shared/id/id.js";
import {ChannelId, SpaceId} from "~/shared/id/types/id_types.js";
import {getInboxChannelPostsEntryPosts} from "~/shared/rpc/notifications_rpc_definitions.js";
import {Schema} from "~/shared/schema/schema.js";
import {TracerEventData} from "~/shared/tracer/types/tracer_event_data.js";

const LoaderSchema = Schema.object({
    channelId: Schema.id<ChannelId>(),
    bucketGeneration: Schema.integer,
    postsResult: Schema.object({
        hasMorePosts: Schema.boolean,
        posts: Schema.array(PostModel.schema()),
    }),
});

export async function loader({params, context}: LoaderArgs) {
    const spaceId = Schema.id<SpaceId>().deserialize(params.spaceId ?? null);
    const channelIdAndBucketGeneration = assertExists(params.channelIdAndBucketGeneration);
    const [channelId, bucketGenerationString, ...otherParts] =
        channelIdAndBucketGeneration.split("-");

    if (otherParts.length !== 0)
        throw new InvalidArgumentError("Only expected two parts in the URL");

    if (!channelId || !isId<ChannelId>(channelId))
        throw new InvalidArgumentError("Expected `ChannelId`");

    const bucketGeneration =
        bucketGenerationString && /^\d+$/.test(bucketGenerationString)
            ? parseInt(bucketGenerationString, 10)
            : null;

    if (bucketGeneration === null || !Number.isInteger(bucketGeneration))
        throw new InvalidArgumentError("Expected bucket generation to be an integer");

    const postsResult = await getInboxChannelPostsEntryPosts(context, {
        spaceId,
        channelId,
        bucketGeneration,
        limit: getInitialVirtualizedScrollViewRenderedItemCount(
            context.loader.getClientInfo(),
            postContentViewMinHeight,
        ),
        afterPostId: null,
    });

    const propagateEventData: TracerEventData = {
        context: {
            channelId,
        },
    };

    return jsonWithSchema(
        LoaderSchema,
        {channelId, bucketGeneration, postsResult},
        {propagateEventData},
    );
}

export const meta = () => [{title: `New posts notification${metaTitlePostfix}`}];

export default function ChannelPostsRoute({withMobileLayout}: {withMobileLayout?: boolean}) {
    const context = useAppContext();
    const {space} = useSpaceContext();
    const {
        channelId,
        bucketGeneration,
        postsResult: initialPostsResult,
    } = useLoaderDataWithSchema(LoaderSchema);

    // While you're viewing new posts in a channel, this accrues affinity points to
    // the channel. Since you're taking time to pay attention to what's new in a
    // channel.
    useSearchAffinityViewInteraction(`Channel:${channelId}`);

    const [posts, setPosts] = useState(() =>
        PostBasicList.empty
            .insertManyPostsAtEnd(initialPostsResult.posts)
            .setHasMorePosts(initialPostsResult.hasMorePosts),
    );

    return (
        <PostListView
            withMobileLayout={withMobileLayout}
            posts={posts}
            onTogglePostComments={useCallback(
                postId => setPosts(posts => posts.togglePostComments(postId)),
                [],
            )}
            onUpdatePostComments={useCallback(
                (postId, update) => setPosts(posts => posts.updatePostComments(postId, update)),
                [],
            )}
            onLoadMorePosts={async ({limit}) => {
                const postsResult = await getInboxChannelPostsEntryPosts(context, {
                    spaceId: space.id,
                    channelId,
                    bucketGeneration,
                    limit,
                    afterPostId: posts.getLastPostIfExists()?.post.id ?? null,
                });

                setPosts(posts =>
                    posts
                        .insertManyPostsAtEnd(postsResult.posts)
                        .setHasMorePosts(postsResult.hasMorePosts),
                );
            }}
        />
    );
}
