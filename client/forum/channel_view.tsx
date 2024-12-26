import {useCallback, useEffect, useMemo, useState} from "react";
import {useAppContext} from "~/client/context/app_context.js";
import {Box} from "~/client/design/box.js";
import {MobileFullScreenModal} from "~/client/design/mobile_full_screen_modal.js";
import {useNavigationBar} from "~/client/design/navigation_bar.js";
import {useDevConsoleTool} from "~/client/dev/dev_console.js";
import {useDynamoGeneralRealtimeIndexQueryBase} from "~/client/dynamo/use_dynamo_general_realtime_index_query.js";
import {useDynamoGeneralRealtimeQuery} from "~/client/dynamo/use_dynamo_general_realtime_query.js";
import {ChannelMobileEditor} from "~/client/forum/channel_mobile_editor.js";
import {ChannelViewAside} from "~/client/forum/internal/channel_view_aside.js";
import {ChannelViewNameEditor} from "~/client/forum/internal/channel_view_name_editor.js";
import {optimisticCreatePostEventEmitter} from "~/client/forum/internal/optimistic_create_post_event_emitter.js";
import {
    PostListChannelHeader,
    PostQueryList,
    PostQueryListDynamoGeneralRealtimeIndexQuery,
} from "~/client/forum/post_list.js";
import {PostListView} from "~/client/forum/post_list_view.js";
import {writeTextToClipboard} from "~/client/helpers/write_text_to_clipboard.js";
import {getClientInfo} from "~/client/remix/client_info_context.js";
import {usePlatform} from "~/client/remix/platform_context.js";
import {useRouteLayout} from "~/client/remix/route_layout_context.js";
import {getInitialAppRenderSpacingScale} from "~/client/remix/spacing_scale_context.js";
import {useNavigate} from "~/client/remix/use_navigate.js";
import {useSpaceContext} from "~/client/spaces/space_context.js";
import {
    channelViewAsidePostFileCount,
    postContentViewMinHeightWithClosedCommentSectionPx,
    postListViewAsideMaxWidth,
} from "~/client/styles/forum_shared_styles.js";
import {contentStyles} from "~/client/styles/styles.js";
import {getInitialVirtualizedScrollViewRenderedItemCount} from "~/client/virtualized/get_initial_virtualized_scroll_view_rendered_item_count.js";
import {useWebSocket} from "~/client/web_socket/use_web_socket.js";
import {addRemLengths} from "~/shared/design/core/spacing.js";
import {
    DynamoGeneralRealtimeIndexQueryResult,
    DynamoGeneralRealtimeQueryResult,
} from "~/shared/dynamo/dynamo_general_realtime_types.js";
import {ChannelModel, ChannelOrMetadataModel} from "~/shared/forum/channel_model.js";
import {ChannelRealtimeProtocol} from "~/shared/forum/channel_realtime_protocol.js";
import {PostModel} from "~/shared/forum/post_model.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {
    backfillChannelAndMetadata,
    backfillChannelPosts,
    getChannelAndMetadata,
    getChannelPosts,
    updateChannelDescription,
    updateChannelName,
    updateChannelNameAndDescription,
} from "~/shared/rpc/forum_rpc_definitions.js";

export function ChannelView({
    initialChannelResult,
    initialPostsResult,
}: {
    initialChannelResult: DynamoGeneralRealtimeQueryResult<ChannelOrMetadataModel>;
    initialPostsResult: DynamoGeneralRealtimeIndexQueryResult<PostModel>;
}) {
    const context = useAppContext();
    const platform = usePlatform();
    const routeLayout = useRouteLayout();
    const navigate = useNavigate();
    const {space} = useSpaceContext();

    assert(initialChannelResult.items[0]?.model instanceof ChannelModel);

    const channelId = initialChannelResult.items[0].model.id;

    const {isConnected, subscribeToEvents, toggleShouldConnect} = useWebSocket(
        "ChannelRealtimeService",
        ChannelRealtimeProtocol,
        `/api/durable-objects/channels/${channelId}`,
    );

    const {query: channelAndMetadataQuery, handleEvent: handleEventForChannel} =
        useDynamoGeneralRealtimeQuery(initialChannelResult, {
            isConnected,
            subscribeToEvents: useCallback(
                subscriber => subscribeToEvents(event => subscriber(event)),
                [subscribeToEvents],
            ),
            backfillQuery: useCallback(
                async ({readTime}) => {
                    const {backfillChannelResult} = await backfillChannelAndMetadata(context, {
                        channelId,
                        readTime,
                    });
                    return backfillChannelResult;
                },
                [context, channelId],
            ),
            reloadQuery: useCallback(async () => {
                const {channelResult} = await getChannelAndMetadata(context, {
                    channelId,
                    postFilesLimit: channelViewAsidePostFileCount,
                });
                return channelResult;
            }, [channelId, context]),
        });

    const channelItem = channelAndMetadataQuery.getFirstItemIfExists();
    assert(channelItem?.model instanceof ChannelModel);
    const channel = channelItem.model;

    const [posts, setPosts] = useState(() => PostQueryList.new(initialPostsResult));

    // On mobile, the comment button doesn't expand/collapse. Instead it opens the
    // post in a new route. `<PostListView>` will throw if you pass in `posts` with
    // expanded comments on mobile. So make sure to close them all.
    if (platform === "mobile" && posts.hasOpenPostComments()) {
        setPosts(posts.closeAllPostComments());
    }

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
                const clientInfo = getClientInfo();

                const {postsResult} = await getChannelPosts(context, {
                    channelId,
                    limit: getInitialVirtualizedScrollViewRenderedItemCount(
                        clientInfo,
                        postContentViewMinHeightWithClosedCommentSectionPx[
                            getInitialAppRenderSpacingScale(clientInfo)
                        ],
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
        return optimisticCreatePostEventEmitter.subscribe(event => {
            if (event.channelId !== channel.id) return;

            setPosts(posts =>
                posts.updateQuery(query =>
                    query.handleEventTransaction(event.readTime, event.eventTransaction),
                ),
            );
        });
    }, [channel.id]);

    const [isEditingNameInline, setIsEditingNameInline] = useState(false);
    if (isEditingNameInline && platform === "mobile") setIsEditingNameInline(false);

    const [isEditingDescriptionInline, setIsEditingDescriptionInline] = useState(false);
    if (isEditingDescriptionInline && platform === "mobile") setIsEditingDescriptionInline(false);

    const [editNameAndDescriptionMobileModalState, setEditNameAndDescriptionMobileModalState] =
        useState<{readonly initiallyFocus: "Name" | "Description"} | null>(null);
    if (editNameAndDescriptionMobileModalState && platform !== "mobile")
        setEditNameAndDescriptionMobileModalState(null);

    const navigationBar = useNavigationBar({
        withoutDisappearingTitle: true,
        title: isEditingNameInline ? (
            <ChannelViewNameEditor
                isCreatingChannel={false}
                initialName={channel.name}
                onCancel={() => setIsEditingNameInline(false)}
                onSave={async name => {
                    const event = await updateChannelName(context, {
                        channelId,
                        name,
                    });

                    setIsEditingNameInline(false);

                    // Immediately apply a realtime event transaction to update our channel in case
                    // our realtime WebSocket connection is slow.
                    handleEventForChannel(event);
                }}
            />
        ) : (
            <Box
                display="inline"
                onDoubleClick={event => {
                    // Disable selection from double click.
                    event.preventDefault();

                    if (platform !== "mobile") {
                        setIsEditingNameInline(true);
                    }
                }}
            >
                {channel.name}
            </Box>
        ),
        desktopMaxWidth:
            routeLayout !== "narrow"
                ? addRemLengths(contentStyles.contentMaxWidth, postListViewAsideMaxWidth)
                : contentStyles.contentMaxWidth,
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
                    onPress: () => {
                        if (platform !== "mobile") {
                            setIsEditingNameInline(true);
                        } else {
                            setEditNameAndDescriptionMobileModalState({initiallyFocus: "Name"});
                        }
                    },
                },
                {
                    label: "Edit description",
                    onPress: () => {
                        if (platform !== "mobile") {
                            setIsEditingDescriptionInline(true);
                        } else {
                            setEditNameAndDescriptionMobileModalState({
                                initiallyFocus: "Description",
                            });
                        }
                    },
                },
            ],
            ...(routeLayout === "narrow"
                ? [
                      [
                          {
                              label: "See all files",
                              pressErrorTitle: "Couldn’t open files",
                              onPress: () =>
                                  navigate(
                                      `/s/${space.id}/channels/${channelId}/files?from=channel`,
                                  ),
                          },
                      ],
                  ]
                : []),
        ],
    });

    const channelHeader = useMemo(
        (): PostListChannelHeader & {isOnlyNavigationBar: false} => ({
            isOnlyNavigationBar: false,
            channel,
            isCreatingChannel: false,
            isEditingDescription: isEditingDescriptionInline,
            onCancelDescriptionEditing: () => setIsEditingDescriptionInline(false),
            onSaveDescription: async description => {
                const event = await updateChannelDescription(context, {
                    channelId,
                    description,
                });

                setIsEditingDescriptionInline(false);

                // Immediately apply a realtime event transaction to update our channel in case
                // our realtime WebSocket connection is slow.
                handleEventForChannel(event);
            },
        }),
        [channel, channelId, context, handleEventForChannel, isEditingDescriptionInline],
    );

    return (
        <Box
            position="relative"
            flexGrow="1"
            display="flex"
            flexDirection="column"
            overflow="hidden"
            height="full"
        >
            <PostListView
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
                    routeLayout !== "narrow" && (
                        <ChannelViewAside
                            channel={channel}
                            channelAndMetadataQuery={channelAndMetadataQuery}
                            isEditingDescription={isEditingDescriptionInline}
                            onCancelEditingDescription={channelHeader.onCancelDescriptionEditing}
                            onSaveDescription={channelHeader.onSaveDescription}
                        />
                    )
                }
                navigationBar={navigationBar}
            />
            {editNameAndDescriptionMobileModalState && (
                <MobileFullScreenModal
                    onClose={() => setEditNameAndDescriptionMobileModalState(null)}
                >
                    {({onCloseWithAnimation}) => (
                        <ChannelMobileEditor
                            title="Edit channel"
                            initiallyFocus={editNameAndDescriptionMobileModalState.initiallyFocus}
                            initialName={channel.name}
                            initialDescription={channel.description}
                            onSave={async ({name, description}) => {
                                const event = await updateChannelNameAndDescription(context, {
                                    channelId,
                                    name,
                                    description,
                                });

                                // Immediately apply a realtime event transaction to update our channel in case
                                // our realtime WebSocket connection is slow.
                                handleEventForChannel(event);
                            }}
                            onCloseWithAnimation={() => onCloseWithAnimation()}
                        />
                    )}
                </MobileFullScreenModal>
            )}
        </Box>
    );
}
