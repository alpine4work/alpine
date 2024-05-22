import {useCallback, useMemo, useRef, useState} from "react";
import {useAppContext} from "~/client/context/app_context.js";
import {NavigationBarRef, useNavigationBar} from "~/client/design/navigation_bar.js";
import {printPrettySmallNumberSummary} from "~/client/design/pretty_number.js";
import {useDynamoGeneralRealtimeItem} from "~/client/dynamo/use_dynamo_general_realtime_item.js";
import {postContentViewMinHeightWithClosedCommentSection} from "~/client/forum/post_content_view.js";
import {PostBasicList} from "~/client/forum/post_list.js";
import {PostListView} from "~/client/forum/post_list_view.js";
import {PostView} from "~/client/forum/post_view.js";
import {getInitialLoadMessageCount} from "~/client/messaging/messaging_view.js";
import {createMetaFunction} from "~/client/remix/create_meta_function.js";
import {useIsMobile} from "~/client/remix/use_is_mobile.js";
import {useLoaderDataWithSchema} from "~/client/remix/use_loader_data_with_schema.js";
import {useSearchAffinityViewInteraction} from "~/client/search/use_search_affinity_view_interaction.js";
import {useSpaceContext} from "~/client/spaces/space_context.js";
import {getInitialVirtualizedScrollViewRenderedItemCount} from "~/client/virtualized/virtualized_scroll_view.js";
import {useWebSocket} from "~/client/web_socket/use_web_socket.js";
import {getChannel} from "~/server/forum/data/forum_table.js";
import {jsonWithSchema} from "~/server/remix/json_with_schema.js";
import {LoaderArgs} from "~/server/remix/loader_context.js";
import {createDynamoGeneralRealtimeItemSchema} from "~/shared/dynamo/dynamo_general_realtime_types.js";
import {InvalidArgumentError} from "~/shared/error/error.js";
import {ChannelModel} from "~/shared/forum/channel_model.js";
import {ChannelRealtimeProtocol} from "~/shared/forum/channel_realtime_protocol.js";
import {PostCommentModel, PostModel} from "~/shared/forum/post_model.js";
import {emptyArray} from "~/shared/helpers/array/empty_array.js";
import {runAllPromises} from "~/shared/helpers/async/run_all_promises.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.js";
import {isId} from "~/shared/id/id.js";
import {ChannelId, PostId, SpaceId} from "~/shared/id/types/id_types.js";
import {getChannelWithStrongReadConsistency} from "~/shared/rpc/forum_rpc_definitions.js";
import {getInboxChannelPostsEntryPosts} from "~/shared/rpc/notifications_rpc_definitions.js";
import {Schema} from "~/shared/schema/schema.js";
import {TracerEventData} from "~/shared/tracer/types/tracer_event_data.js";

const LoaderSchema = Schema.object({
    channel: createDynamoGeneralRealtimeItemSchema(ChannelModel.schema()),
    bucketGeneration: Schema.integer,
    postsResult: Schema.object({
        totalPostCount: Schema.integer,
        hasMorePosts: Schema.boolean,
        posts: Schema.array(createDynamoGeneralRealtimeItemSchema(PostModel.schema())),
        initialCommentsByPostId: Schema.map(
            Schema.id<PostId>(),
            Schema.object({
                comments: Schema.array(PostCommentModel.schema()),
                otherReferencedComments: Schema.array(PostCommentModel.schema()),
            }),
        ),
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

    const [channel, postsResult] = await runAllPromises([
        getChannel(await context.actor.authenticate(), channelId),
        getInboxChannelPostsEntryPosts(context, {
            spaceId,
            channelId,
            bucketGeneration,
            limit: getInitialVirtualizedScrollViewRenderedItemCount(
                context.loader.getClientInfo(),
                postContentViewMinHeightWithClosedCommentSection,
            ),
            commentLimit: getInitialLoadMessageCount(context.loader.getClientInfo()),
            afterPostId: null,
        }),
    ]);

    const propagateEventData: TracerEventData = {
        context: {
            channelId,
        },
    };

    return jsonWithSchema(
        LoaderSchema,
        {channel, bucketGeneration, postsResult},
        {propagateEventData},
    );
}

export const meta = createMetaFunction(
    LoaderSchema,
    ({
        data: {
            channel,
            postsResult: {totalPostCount},
        },
    }) => [
        {
            title: `${printPrettySmallNumberSummary(totalPostCount, "new post")} in ${
                channel.model.name
            }`,
        },
    ],
);

export default function ChannelPostsRouteWrapper({
    withMobileLayout = false,
}: {
    withMobileLayout?: boolean;
}) {
    const {channel, postsResult} = useLoaderDataWithSchema(LoaderSchema);

    // While you're viewing new posts in a channel, this accrues affinity points to
    // the channel. Since you're taking time to pay attention to what's new in a
    // channel.
    useSearchAffinityViewInteraction(`Channel:${channel.model.id}`);

    if (postsResult.posts.length === 1 && !postsResult.hasMorePosts) {
        const post = postsResult.posts[0]!;

        return (
            <PostView
                // Remount when navigating to a different post.
                key={post.model.id}
                initialPost={post}
                initialPostComments={
                    postsResult.initialCommentsByPostId.get(post.model.id)?.comments ?? emptyArray
                }
                initialOtherReferencedPostComments={
                    postsResult.initialCommentsByPostId.get(post.model.id)
                        ?.otherReferencedComments ?? emptyArray
                }
                initialScrollToPostCommentIndex={null}
                withMobileLayout={withMobileLayout}
            />
        );
    } else {
        return <ChannelPostsRoute withMobileLayout={withMobileLayout} />;
    }
}

function ChannelPostsRoute({withMobileLayout: withMobileLayoutProp}: {withMobileLayout: boolean}) {
    const context = useAppContext();
    const isMobile = useIsMobile();
    const {space} = useSpaceContext();

    const withMobileLayout = isMobile || withMobileLayoutProp;

    const {
        channel: initialChannel,
        bucketGeneration,
        postsResult: initialPostsResult,
    } = useLoaderDataWithSchema(LoaderSchema);

    // Shouldn't have loaded initial comments since all the posts should have
    // collapsed comments.
    assert(initialPostsResult.initialCommentsByPostId.size === 0);

    const channelId = initialChannel.model.id;

    const {isConnected, subscribeToEvents} = useWebSocket(
        "ChannelRealtimeService",
        ChannelRealtimeProtocol,
        `/api/durable-objects/channels/${channelId}`,
    );

    const totalPostCount = initialPostsResult.totalPostCount;

    const [posts, setPosts] = useState(() =>
        PostBasicList.new({
            type: "Many",
            posts: initialPostsResult.posts,
            hasMorePosts: initialPostsResult.hasMorePosts,
        }),
    );

    // On mobile, the comment button doesn't expand/collapse. Instead it opens the
    // post in a new route. `<PostListView>` will throw if you pass in `posts` with
    // expanded comments on mobile. So make sure to close them all.
    if (isMobile && posts.hasOpenPostComments()) {
        setPosts(posts.closeAllPostComments());
    }

    const {item: channel} = useDynamoGeneralRealtimeItem(initialChannel, {
        isConnected,
        subscribeToEvents: useCallback(
            subscriber =>
                subscribeToEvents(({eventTransaction}) => {
                    subscriber(eventTransaction);
                    setPosts(posts => posts.handleEventTransaction(eventTransaction));
                }),
            [subscribeToEvents],
        ),
        reloadItemWithStrongReadConsistency: useCallback(async () => {
            const {channel} = await getChannelWithStrongReadConsistency(context, {channelId});
            return channel;
        }, [channelId, context]),
    });

    const navigationBarRef = useRef<NavigationBarRef>(null);

    const navigationBar = useNavigationBar({
        isDisabled: !isMobile,
        ref: navigationBarRef,
        withMobileLayout,
        title: printPrettySmallNumberSummary(totalPostCount, "new post"),
        withoutDisappearingTitle: true,
    });

    return (
        <PostListView
            withMobileLayout={withMobileLayout}
            channelHeader={useMemo(
                () =>
                    isMobile
                        ? {isOnlyNavigationBar: true, shouldNotShowChannelId: null}
                        : undefined,
                [isMobile],
            )}
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
                    channelId: channel.model.id,
                    bucketGeneration,
                    limit,
                    commentLimit: 0,
                    afterPostId: posts.getLastPostIdIfExists(),
                });

                // Shouldn't have loaded initial comments since all the posts should have
                // collapsed comments.
                assert(postsResult.initialCommentsByPostId.size === 0);

                setPosts(posts => posts.loadMorePosts(postsResult));
            }}
            shouldBeConnectedToChannelRealtime={true}
            onPostRealtimeEventTransaction={useCallback(({eventTransaction}) => {
                setPosts(posts => posts.handleEventTransaction(eventTransaction));
            }, [])}
            navigationBar={{...navigationBar, navigationBarRef}}
            // Safe area inset is already accounted for on mobile thanks to the
            // `navigationBar`.
            withSafeAreaInsetTop={!isMobile}
        />
    );
}
