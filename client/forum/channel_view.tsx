import {useCallback, useMemo, useRef, useState} from "react";
import {useAppContext} from "~/client/context/app_context.js";
import {NavigationBarRef, useNavigationBar} from "~/client/design/navigation_bar.js";
import {useDevConsoleTool} from "~/client/dev/dev_console.js";
import {useDynamoGeneralRealtimeIndexQueryBase} from "~/client/dynamo/use_dynamo_general_realtime_index_query.js";
import {useDynamoGeneralRealtimeItem} from "~/client/dynamo/use_dynamo_general_realtime_item.js";
import {ChannelViewAside} from "~/client/forum/channel_view_aside.js";
import {postContentViewMinHeight} from "~/client/forum/post_content_view.js";
import {
    PostQueryList,
    PostQueryListDynamoGeneralRealtimeIndexQuery,
} from "~/client/forum/post_list.js";
import {
    PostListView,
    postListViewAsideMaxWidth,
    postViewMaxWidth,
} from "~/client/forum/post_list_view.js";
import {getClientInfoWithoutListening} from "~/client/remix/client_info_context.js";
import {getInitialVirtualizedScrollViewRenderedItemCount} from "~/client/virtualized/virtualized_scroll_view.js";
import {useWebSocket} from "~/client/web_socket/use_web_socket.js";
import {isContentEmpty} from "~/shared/content/is_content_empty.js";
import {addRemLengths, spacing} from "~/shared/design/spacing.js";
import {
    DynamoGeneralRealtimeIndexQueryResult,
    DynamoGeneralRealtimeItem,
} from "~/shared/dynamo/dynamo_general_realtime_types.js";
import {ChannelModel} from "~/shared/forum/channel_model.js";
import {ChannelRealtimeProtocol} from "~/shared/forum/channel_realtime_protocol.js";
import {PostModel} from "~/shared/forum/post_model.js";
import {
    backfillChannelPosts,
    getChannelPosts,
    getChannelWithStrongReadConsistency,
} from "~/shared/rpc/forum_rpc_definitions.js";

export function ChannelView({
    withMobileLayout,
    initialChannel,
    initialPostsResult,
}: {
    withMobileLayout: boolean;
    initialChannel: DynamoGeneralRealtimeItem<ChannelModel>;
    initialPostsResult: DynamoGeneralRealtimeIndexQueryResult<PostModel>;
}) {
    const context = useAppContext();

    const channelId = initialChannel.model.id;

    const {isConnected, subscribeToEvents, toggleShouldConnect} = useWebSocket(
        ChannelRealtimeProtocol,
        `/api/durable-objects/channels/${channelId}`,
    );

    const {model: channel} = useDynamoGeneralRealtimeItem(initialChannel, {
        isConnected,
        subscribeToEvents: useCallback(
            subscriber => subscribeToEvents(event => subscriber(event.eventTransaction)),
            [subscribeToEvents],
        ),
        reloadItemWithStrongReadConsistency: useCallback(async () => {
            const {channel} = await getChannelWithStrongReadConsistency(context, {channelId});
            return channel;
        }, [channelId, context]),
    });

    const [posts, setPosts] = useState(() => PostQueryList.new(initialPostsResult));

    useDevConsoleTool("channel", () => ({
        posts,
        toggleShouldConnect,
    }));

    useDynamoGeneralRealtimeIndexQueryBase(
        {
            query: posts.query,
            onUpdateQuery: useCallback(
                (
                    update: (
                        query: PostQueryListDynamoGeneralRealtimeIndexQuery,
                    ) => PostQueryListDynamoGeneralRealtimeIndexQuery,
                ) => setPosts(posts => posts.updateQuery(update(posts.query))),
                [],
            ),
        },
        {
            isConnected,
            subscribeToEvents,
            backfillQuery: useCallback(
                async ({readTime}) => {
                    const {backfillPostsResult} = await backfillChannelPosts(context, {
                        channelId,
                        readTime,
                    });
                    return backfillPostsResult;
                },
                [channelId, context],
            ),
            reloadQuery: useCallback(async () => {
                const {postsResult} = await getChannelPosts(context, {
                    channelId,
                    limit: getInitialVirtualizedScrollViewRenderedItemCount(
                        getClientInfoWithoutListening(),
                        postContentViewMinHeight,
                    ),
                    beforeCursor: null,
                });
                return postsResult;
            }, [channelId, context]),
        },
    );

    // NOCOMMIT: Get rid of `<ChannelViewTopBar>`

    const hasAside = !isContentEmpty(channel.description.doc);

    const navigationBarRef = useRef<NavigationBarRef>(null);

    const navigationBar = useNavigationBar({
        ref: navigationBarRef,
        withMobileLayout,
        withoutDisappearingTitle: true,
        title: channel.name,
        desktopTitleMaxWidth: hasAside
            ? addRemLengths(spacing[postViewMaxWidth], spacing[postListViewAsideMaxWidth])
            : postViewMaxWidth,
        desktopTitleFontSize: "400",
        desktopTitleFontWeight: "bold",
    });

    return (
        <PostListView
            withMobileLayout={withMobileLayout}
            channelHeader={useMemo(() => ({channel}), [channel])}
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
                const {postsResult} = await getChannelPosts(context, {
                    channelId: channel.id,
                    limit,
                    beforeCursor: posts.query.getPreviousPageCursorIfExists(),
                });

                setPosts(posts => posts.updateQuery(posts.query.loadMore(postsResult)));
            }}
            aside={hasAside && <ChannelViewAside channel={channel} />}
            navigationBar={{...navigationBar, navigationBarRef}}
        />
    );
}
