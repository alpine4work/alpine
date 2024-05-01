import {useCallback, useMemo, useRef, useState} from "react";
import {usePress} from "react-aria";
import {useAppContext} from "~/client/context/app_context.js";
import {NavigationBarRef, useNavigationBar} from "~/client/design/navigation_bar.js";
import {useDynamoGeneralRealtimeItem} from "~/client/dynamo/use_dynamo_general_realtime_item.js";
import {postContentViewMinHeightWithClosedCommentSection} from "~/client/forum/post_content_view.js";
import {PostBasicList} from "~/client/forum/post_list.js";
import {PostListView} from "~/client/forum/post_list_view.js";
import {useIsMobile} from "~/client/remix/use_is_mobile.js";
import {useLoaderDataWithSchema} from "~/client/remix/use_loader_data_with_schema.js";
import {useNavigate} from "~/client/remix/use_navigate.js";
import {metaTitlePostfix} from "~/client/remix/use_update_meta_title.js";
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
import {PostModel} from "~/shared/forum/post_model.js";
import {runAllPromises} from "~/shared/helpers/async/run_all_promises.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.js";
import {isId} from "~/shared/id/id.js";
import {ChannelId, SpaceId} from "~/shared/id/types/id_types.js";
import {getChannelWithStrongReadConsistency} from "~/shared/rpc/forum_rpc_definitions.js";
import {getInboxChannelPostsEntryPosts} from "~/shared/rpc/notifications_rpc_definitions.js";
import {Schema} from "~/shared/schema/schema.js";
import {sprinkles} from "~/shared/styles/styles.js";
import {TracerEventData} from "~/shared/tracer/types/tracer_event_data.js";

const LoaderSchema = Schema.object({
    channel: createDynamoGeneralRealtimeItemSchema(ChannelModel.schema()),
    bucketGeneration: Schema.integer,
    postsResult: Schema.object({
        hasMorePosts: Schema.boolean,
        posts: Schema.array(createDynamoGeneralRealtimeItemSchema(PostModel.schema())),
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

export const meta = () => [{title: `New posts notification${metaTitlePostfix}`}];

export default function ChannelPostsRoute({
    withMobileLayout: withMobileLayoutProp = false,
}: {
    withMobileLayout?: boolean;
}) {
    const context = useAppContext();
    const isMobile = useIsMobile();
    const {space} = useSpaceContext();
    const navigate = useNavigate();

    const withMobileLayout = isMobile || withMobileLayoutProp;

    const {
        channel: initialChannel,
        bucketGeneration,
        postsResult: initialPostsResult,
    } = useLoaderDataWithSchema(LoaderSchema);

    const channelId = initialChannel.model.id;

    // While you're viewing new posts in a channel, this accrues affinity points to
    // the channel. Since you're taking time to pay attention to what's new in a
    // channel.
    useSearchAffinityViewInteraction(`Channel:${channelId}`);

    const {isConnected, subscribeToEvents} = useWebSocket(
        ChannelRealtimeProtocol,
        `/api/durable-objects/channels/${channelId}`,
    );

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

    const {isPressed: isTitlePressed, pressProps: titlePressProps} = usePress({
        onPress: () => {
            // TODO(calebmer, #global-loading-indicator): Some global loading indicator?
            void navigate(`/s/${channel.model.spaceId}/channels/${channel.model.id}`, {
                // Don't let the route open in `<PeekStack>`.
                stopPropagation: true,
            });
        },
    });

    const navigationBarRef = useRef<NavigationBarRef>(null);

    const navigationBar = useNavigationBar({
        isDisabled: !withMobileLayout,
        ref: navigationBarRef,
        withMobileLayout,
        title: (
            <span
                {...titlePressProps}
                className={sprinkles({
                    cursor: "pointer",
                    opacity: isTitlePressed ? "60" : undefined,
                })}
            >
                {channel.model.name}
            </span>
        ),
        subtitle: `New post${posts.getPostCount() === 1 && !posts.hasMorePosts() ? "" : "s"}`,
        withoutDisappearingTitle: true,
    });

    return (
        <PostListView
            withMobileLayout={withMobileLayout}
            channelHeader={useMemo(
                () =>
                    withMobileLayout
                        ? {isOnlyNavigationBar: true, shouldNotShowChannelId: channel.model.id}
                        : undefined,
                [channel.model.id, withMobileLayout],
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
                    afterPostId: posts.getLastPostIdIfExists(),
                });

                setPosts(posts => posts.loadMorePosts(postsResult));
            }}
            shouldBeConnectedToChannelRealtime={true}
            onPostRealtimeEventTransaction={useCallback(({eventTransaction}) => {
                setPosts(posts => posts.handleEventTransaction(eventTransaction));
            }, [])}
            navigationBar={{...navigationBar, navigationBarRef}}
        />
    );
}
