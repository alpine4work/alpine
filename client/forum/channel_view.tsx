import {useCallback, useEffect, useMemo, useRef, useState} from "react";
import {useAppContext} from "~/client/context/app_context.js";
import {Box} from "~/client/design/box.js";
import {NavigationBarRef, useNavigationBar} from "~/client/design/navigation_bar.js";
import {useDevConsoleTool} from "~/client/dev/dev_console.js";
import {useDynamoGeneralRealtimeIndexQueryBase} from "~/client/dynamo/use_dynamo_general_realtime_index_query.js";
import {useDynamoGeneralRealtimeItem} from "~/client/dynamo/use_dynamo_general_realtime_item.js";
import {ChannelViewAside} from "~/client/forum/channel_view_aside.js";
import {ChannelViewNameEditor} from "~/client/forum/channel_view_name_editor.js";
import {createPostEventEmitter} from "~/client/forum/new_post_view.js";
import {postContentViewMinHeightWithClosedCommentSection} from "~/client/forum/post_content_view.js";
import {
    PostListChannelHeader,
    PostQueryList,
    PostQueryListDynamoGeneralRealtimeIndexQuery,
} from "~/client/forum/post_list.js";
import {
    PostListView,
    postListViewAsideMaxWidth,
    postViewMaxWidth,
} from "~/client/forum/post_list_view.js";
import {writeTextToClipboard} from "~/client/helpers/write_text_to_clipboard.js";
import {getClientInfoWithoutListening} from "~/client/remix/client_info_context.js";
import {useIsMobile} from "~/client/remix/use_is_mobile.js";
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
    updateChannelDescription,
    updateChannelName,
} from "~/shared/rpc/forum_rpc_definitions.js";

export function ChannelView({
    withMobileLayout: withMobileLayoutProp,
    initialChannel,
    initialPostsResult,
}: {
    withMobileLayout: boolean;
    initialChannel: DynamoGeneralRealtimeItem<ChannelModel>;
    initialPostsResult: DynamoGeneralRealtimeIndexQueryResult<PostModel>;
}) {
    const context = useAppContext();
    const isMobile = useIsMobile();

    const withMobileLayout = isMobile || withMobileLayoutProp;

    const channelId = initialChannel.model.id;

    const {isConnected, subscribeToEvents, toggleShouldConnect} = useWebSocket(
        ChannelRealtimeProtocol,
        `/api/durable-objects/channels/${channelId}`,
    );

    const {
        item: {model: channel},
        handleEventTransaction: handleEventTransactionForChannel,
    } = useDynamoGeneralRealtimeItem(initialChannel, {
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
                ) => setPosts(posts => posts.updateQuery(update)),
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
                        postContentViewMinHeightWithClosedCommentSection,
                    ),
                    beforeCursor: null,
                });
                return postsResult;
            }, [channelId, context]),
        },
    );

    // When a post is created, we should get it from our channel WebSocket
    // connection. But in case our WebSocket connection is slow, `<NewPostView>`
    // emits an event after a post has been successfully created and we handle
    // that event here.
    useEffect(() => {
        return createPostEventEmitter.subscribe(event =>
            setPosts(posts =>
                posts.updateQuery(query =>
                    query.handleEventTransaction(event.readTime, event.eventTransaction),
                ),
            ),
        );
    }, []);

    const [isEditingName, setIsEditingName] = useState(false);
    if (isEditingName && isMobile) setIsEditingName(false);

    const [isEditingDescription, setIsEditingDescription] = useState(false);
    if (isEditingDescription && isMobile) setIsEditingDescription(false);

    const hasAside =
        !withMobileLayout && (!isContentEmpty(channel.description.doc) || isEditingDescription);

    const navigationBarRef = useRef<NavigationBarRef>(null);

    const navigationBar = useNavigationBar({
        ref: navigationBarRef,
        withMobileLayout,
        withoutDisappearingTitle: true,
        title: isEditingName ? (
            <ChannelViewNameEditor
                isCreatingChannel={false}
                initialName={channel.name}
                onCancel={() => setIsEditingName(false)}
                onSave={async name => {
                    const event = await updateChannelName(context, {
                        channelId,
                        name,
                    });

                    setIsEditingName(false);

                    // Immediately apply a realtime event transaction to update our channel in case
                    // our realtime WebSocket connection is slow.
                    handleEventTransactionForChannel(event.eventTransaction);
                }}
            />
        ) : (
            <Box
                display="inline"
                onDoubleClick={event => {
                    // Disable selection from double click.
                    event.preventDefault();

                    setIsEditingName(true);
                }}
            >
                {channel.name}
            </Box>
        ),
        desktopMaxWidth: hasAside
            ? addRemLengths(spacing[postViewMaxWidth], spacing[postListViewAsideMaxWidth])
            : postViewMaxWidth,
        // Create a bit of space to the left so we don't cut off the channel name
        // editor border.
        desktopTitleLeftSlop: "1",
        desktopTitleFontSize: "400",
        desktopTitleFontWeight: "bold",
        menuActions: [
            [
                {
                    label: "Copy link",
                    pressErrorTitle: "Couldn’t copy channel link",
                    onPress: async () => {
                        const url = new URL(
                            `/s/${channel.spaceId}/channels/${channel.id}`,
                            window.location.href,
                        );
                        await writeTextToClipboard(url.toString());
                    },
                },
            ],
            [
                {
                    label: "Edit name",
                    onPress: () => setIsEditingName(true),
                },
                {
                    label: "Edit description",
                    onPress: () => setIsEditingDescription(true),
                },
            ],
        ],
    });

    const channelHeader = useMemo(
        (): PostListChannelHeader & {isOnlyNavigationBar: false} => ({
            isOnlyNavigationBar: false,
            channel,
            isCreatingChannel: false,
            isEditingDescription,
            onCancelDescriptionEditing: () => setIsEditingDescription(false),
            onSaveDescription: async description => {
                const event = await updateChannelDescription(context, {
                    channelId,
                    description,
                });

                setIsEditingDescription(false);

                // Immediately apply a realtime event transaction to update our channel in case
                // our realtime WebSocket connection is slow.
                handleEventTransactionForChannel(event.eventTransaction);
            },
        }),
        [channel, channelId, context, handleEventTransactionForChannel, isEditingDescription],
    );

    return (
        <PostListView
            withMobileLayout={withMobileLayout}
            channelHeader={channelHeader}
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

                setPosts(posts => posts.updateQuery(query => query.loadMore(postsResult)));
            }}
            shouldBeConnectedToChannelRealtime={true}
            onPostRealtimeEventTransaction={useCallback(event => {
                setPosts(posts =>
                    posts.updateQuery(query =>
                        query.handleEventTransaction(event.readTime, event.eventTransaction),
                    ),
                );
            }, [])}
            aside={
                hasAside && (
                    <ChannelViewAside
                        channel={channel}
                        isEditingDescription={isEditingDescription}
                        onCancelEditingDescription={channelHeader.onCancelDescriptionEditing}
                        onSaveDescription={channelHeader.onSaveDescription}
                    />
                )
            }
            navigationBar={{...navigationBar, navigationBarRef}}
        />
    );
}
