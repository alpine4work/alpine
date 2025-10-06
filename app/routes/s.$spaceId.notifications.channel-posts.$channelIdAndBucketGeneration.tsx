import {ReactElement, useCallback, useMemo, useState} from "react";
import {deserializeSpaceIdForLoader} from "~/app/helpers/deserialize_id_for_loader.js";
import {useAppContext} from "~/client/context/app_context.js";
import {useDynamoGeneralRealtimeItem} from "~/client/dynamo/use_dynamo_general_realtime_item.js";
import {PostBasicList} from "~/client/forum/post_list.js";
import {PostListView} from "~/client/forum/post_list_view.js";
import {PostView} from "~/client/forum/post_view.js";
import {useInboxBannerOutletContainer} from "~/client/inbox/use_inbox_banner_outlet_container.js";
import {getInitialLoadMessageCount} from "~/client/messaging/get_initial_load_message_count.js";
import {useNavigationBar} from "~/client/navigation/navigation_bar.js";
import {createMetaFunction} from "~/client/remix/create_meta_function.js";
import {usePlatform} from "~/client/remix/platform_context.js";
import {getInitialAppRenderSpacingScale} from "~/client/remix/spacing_scale_context.js";
import {useLoaderDataWithSchema} from "~/client/remix/use_loader_data_with_schema.js";
import {useSearchAffinityViewEntityInteraction} from "~/client/search/use_search_affinity_view_entity_interaction.js";
import {useSpaceContext} from "~/client/spaces/space_context.js";
import {postContentViewMinHeightPx} from "~/client/styles/forum_shared_styles.js";
import {contentStyles} from "~/client/styles/styles.js";
import {getInitialVirtualizedScrollViewRenderedItemCount} from "~/client/virtualized/get_initial_virtualized_scroll_view_rendered_item_count.js";
import {useWebSocket} from "~/client/web_socket/use_web_socket.js";
import {getChannel} from "~/server/forum/data/get_channel.js";
import {getInboxEntry} from "~/server/notifications/data/notifications_actions.js";
import {jsonWithSchema} from "~/server/remix/json_with_schema.js";
import {LoaderArgs} from "~/server/remix/loader_context.js";
import {printPrettySmallNumberSummary} from "~/shared/design/print_pretty_small_number_summary.js";
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
import {ChannelId, PostId} from "~/shared/id/types/id_types.js";
import {InboxEntryModelSchema} from "~/shared/notifications/inbox_model.js";
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
    inboxEntry: createDynamoGeneralRealtimeItemSchema(InboxEntryModelSchema).nullable(),
});

export async function loader({params, request, context: unauthenticatedContext}: LoaderArgs) {
    const context = (await unauthenticatedContext.actor.authenticate()).actor.authorizeSession();

    const spaceId = deserializeSpaceIdForLoader(params.spaceId ?? null);
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

    const url = new URL(request.url);

    const clientInfo = context.loader.getClientInfo();

    const [channel, postsResult, inboxEntry] = await runAllPromises([
        getChannel(context, channelId),
        getInboxChannelPostsEntryPosts(context, {
            spaceId,
            channelId,
            bucketGeneration,
            limit: getInitialVirtualizedScrollViewRenderedItemCount(
                clientInfo,
                postContentViewMinHeightPx[getInitialAppRenderSpacingScale(clientInfo)],
            ),
            commentLimit: getInitialLoadMessageCount(clientInfo),
            afterPostId: null,
        }),
        url.searchParams.get("inbox") === "show"
            ? getInboxEntry(context, {
                  spaceId,
                  key: {type: "ChannelPosts", channelId, bucketGeneration},
              })
            : null,
    ]);

    const propagateEventData: TracerEventData = {
        context: {
            channelId,
        },
    };

    return jsonWithSchema(
        LoaderSchema,
        {channel, bucketGeneration, postsResult, inboxEntry},
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

export default function ChannelPostsRouteWrapper() {
    const {channel, postsResult, inboxEntry} = useLoaderDataWithSchema(LoaderSchema);

    // While you're viewing new posts in a channel, this accrues affinity points to
    // the channel. Since you're taking time to pay attention to what's new in a
    // channel.
    useSearchAffinityViewEntityInteraction(`Channel:${channel.model.id}`);

    let node: ReactElement;

    if (postsResult.posts.length === 1 && !postsResult.hasMorePosts) {
        const post = postsResult.posts[0]!;

        node = (
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
                initialScroll={null}
            />
        );
    } else {
        node = <ChannelPostsRoute />;
    }

    return useInboxBannerOutletContainer(
        {
            initialEntry: inboxEntry,
            maxWidth: contentStyles.contentMaxWidth,
        },
        node,
    );
}

function ChannelPostsRoute() {
    const context = useAppContext();
    const platform = usePlatform();
    const {space} = useSpaceContext();

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
    if (platform === "mobile" && posts.hasOpenPostComments()) {
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

    const navigationBar = useNavigationBar({
        isDisabled: platform !== "mobile",
        title: printPrettySmallNumberSummary(totalPostCount, "new post"),
        withoutDisappearingTitle: true,
    });

    return (
        <PostListView
            header={useMemo(
                () => (platform === "mobile" ? {type: "NavigationBar"} : undefined),
                [platform],
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
            navigationBar={navigationBar}
            // Safe area inset is already accounted for on mobile thanks to the
            // `navigationBar`.
            withSafeAreaInsetTop={platform !== "mobile"}
        />
    );
}
