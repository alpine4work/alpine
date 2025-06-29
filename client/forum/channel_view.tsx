import {Link as LinkIcon, Lock} from "phosphor-react";
import {useCallback, useEffect, useMemo, useState} from "react";
import {useAppContext} from "~/client/context/app_context.js";
import {Box} from "~/client/design/box.js";
import {MenuAction} from "~/client/design/menu.js";
import {MobileFullScreenModal} from "~/client/design/mobile_full_screen_modal.js";
import {useDevConsoleTool} from "~/client/dev/dev_console.js";
import {useDynamoGeneralRealtimeIndexQueryBase} from "~/client/dynamo/use_dynamo_general_realtime_index_query.js";
import {useDynamoGeneralRealtimeQuery} from "~/client/dynamo/use_dynamo_general_realtime_query.js";
import {ChannelMobileEditor} from "~/client/forum/channel_mobile_editor.js";
import {channelAccessLevelText} from "~/client/forum/internal/channel_access_level_text.js";
import {ChannelViewAside} from "~/client/forum/internal/channel_view_aside.js";
import {ChannelViewNameEditor} from "~/client/forum/internal/channel_view_name_editor.js";
import {ChannelViewSubscribeButton} from "~/client/forum/internal/channel_view_subscribe_button.js";
import {optimisticCreatePostEventEmitter} from "~/client/forum/internal/optimistic_create_post_event_emitter.js";
import {
    PostListHeader,
    PostQueryList,
    PostQueryListDynamoGeneralRealtimeIndexQuery,
} from "~/client/forum/post_list.js";
import {PostListView} from "~/client/forum/post_list_view.js";
import {writeTextToClipboard} from "~/client/helpers/write_text_to_clipboard.js";
import {useNavigationBar} from "~/client/navigation/navigation_bar.js";
import {getClientInfo} from "~/client/remix/client_info_context.js";
import {usePlatform} from "~/client/remix/platform_context.js";
import {useRouteLayout} from "~/client/remix/route_layout_context.js";
import {getInitialAppRenderSpacingScale} from "~/client/remix/spacing_scale_context.js";
import {useNavigate} from "~/client/remix/use_navigate.js";
import {useSearchEntityRegistry} from "~/client/search/core/search_entity_registry_context.js";
import {useSearchFavoriteEntityMenuAction} from "~/client/search/core/use_search_favorite_affinity_entity_menu_action.js";
import {useSpaceContext} from "~/client/spaces/space_context.js";
import {
    channelViewAsidePostFileMaxCount,
    postContentViewMinHeightPx,
    postListViewAsideMaxWidth,
} from "~/client/styles/forum_shared_styles.js";
import {contentStyles, sprinkles} from "~/client/styles/styles.js";
import {getInitialVirtualizedScrollViewRenderedItemCount} from "~/client/virtualized/get_initial_virtualized_scroll_view_rendered_item_count.js";
import {useWebSocket} from "~/client/web_socket/use_web_socket.js";
import {
    getAccountAccessLevelAssumingSpaceAccess,
    hasAccessLevel,
} from "~/shared/access/access_policy.js";
import {addRemLengths, spacing} from "~/shared/design/core/spacing.js";
import {
    DynamoGeneralRealtimeIndexQueryResult,
    DynamoGeneralRealtimeQueryResult,
} from "~/shared/dynamo/dynamo_general_realtime_types.js";
import {PermissionDeniedError} from "~/shared/error/error.js";
import {ChannelModel, ChannelOrMetadataModel} from "~/shared/forum/channel_model.js";
import {ChannelRealtimeProtocol} from "~/shared/forum/channel_realtime_protocol.js";
import {channelPermissionDeniedErrorDisplayMessageByExpectedAccessLevel} from "~/shared/forum/forum_error_messages.js";
import {PostModel} from "~/shared/forum/post_model.js";
import {emptyArray} from "~/shared/helpers/array/empty_array.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {cast} from "~/shared/helpers/control/cast.js";
import {
    addAccountGrantsToChannelAccessPolicy,
    backfillChannelAndMetadata,
    backfillChannelPosts,
    getChannelAndMetadata,
    getChannelPosts,
    updateChannelAccessPolicy,
    updateChannelDescription,
    updateChannelName,
    updateChannelNameAndDescription,
} from "~/shared/rpc/forum_rpc_definitions.js";
import {SearchEntityModel} from "~/shared/search/search_entity_model.js";

export function ChannelView({
    initialChannelResult,
    initialPostsResult,
    initialIsSubscribed,
    initialIsFavorite,
}: {
    initialChannelResult: DynamoGeneralRealtimeQueryResult<ChannelOrMetadataModel>;
    initialPostsResult: DynamoGeneralRealtimeIndexQueryResult<PostModel>;
    initialIsSubscribed: boolean;
    initialIsFavorite: boolean;
}) {
    const context = useAppContext();
    const platform = usePlatform();
    const routeLayout = useRouteLayout();
    const navigate = useNavigate();
    const {space, currentAccount} = useSpaceContext();
    const searchEntityRegistry = useSearchEntityRegistry();

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
                    postFilesLimit: channelViewAsidePostFileMaxCount,
                });
                return channelResult;
            }, [channelId, context]),
        });

    const channelItem = channelAndMetadataQuery.getFirstItemIfExists();
    assert(channelItem?.model instanceof ChannelModel);
    const channel = channelItem.model;

    const accessLevel = useMemo(
        () => getAccountAccessLevelAssumingSpaceAccess(channel.accessPolicy, currentAccount?.id),
        [channel.accessPolicy, currentAccount?.id],
    );

    if (accessLevel === null) {
        throw new PermissionDeniedError("Current account lost access to channel", {
            displayMessage: channelPermissionDeniedErrorDisplayMessageByExpectedAccessLevel.View,
        });
    }

    // Update `SearchEntityRegistry` with the latest channel name. Now as the
    // name changes in realtime, any `SearchEntityModel`s rendered elsewhere in
    // the product will also update.
    useMemo(() => {
        return searchEntityRegistry.getEntityStore(
            new SearchEntityModel({
                id: `Channel:${channelId}`,
                title: channel.name,
                titleVersion: {type: "Integer", version: channelItem.version},
                media: null,
            }),
        );
    }, [channel.name, channelId, channelItem.version, searchEntityRegistry]);

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
                        postContentViewMinHeightPx[getInitialAppRenderSpacingScale(clientInfo)],
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

    const favoriteMenuAction = useSearchFavoriteEntityMenuAction(
        `Channel:${channelId}`,
        initialIsFavorite,
    );

    const handleCopyLink = async () => {
        const url = new URL(`/s/${channel.spaceId}/channels/${channel.id}`, window.location.href);
        await writeTextToClipboard(url.toString());
    };

    const navigationBar = useNavigationBar({
        withoutDisappearingTitle: true,
        title: (
            <Box display="flex" alignItems="center" gap="1.5">
                {platform !== "mobile" &&
                    !channel.accessPolicy.defaultGrant &&
                    !channel.accessPolicy.urlGrant && (
                        // We add a lock icon to private channels because unlike other entities we don't
                        // show the share switch in the navigation bar. Since knowing whether a channel
                        // is public or private is important context, we include a lock to make sure you
                        // know the channel is private before posting.
                        //
                        // We don't show the lock on mobile since none of our entities have logic to
                        // show their share state on mobile without opening the more menu.
                        <Lock
                            className={sprinkles({flexShrink: "0"})}
                            size={spacing["4"]}
                            weight="fill"
                        />
                    )}
                {isEditingNameInline ? (
                    <ChannelViewNameEditor
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
                        onDoubleClick={event => {
                            if (!hasAccessLevel(accessLevel, "Manage")) return;

                            // Disable selection from double click.
                            event.preventDefault();

                            if (platform !== "mobile") {
                                setIsEditingNameInline(true);
                            }
                        }}
                    >
                        {channel.name}
                    </Box>
                )}
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
        desktopAdditionalActions: (
            <ChannelViewSubscribeButton
                channelId={channelId}
                initialIsSubscribed={initialIsSubscribed}
            />
        ),
        // Always put the share UI in the more menu. You should add users to a channel
        // by clicking the invite button in `<ChannelViewContributorsSection>`. Since
        // in a public channel it doesn't make sense to invite people from the share
        // overlay. Having both the share menu visible and the invite button in
        // `<ChannelViewContributorsSection>` may make it unclear what to use for
        // adding people to a channel.
        withWideRouteLayoutShareMenuItem: true,
        shareButton: {
            entityNoun: "channel",
            entityId: `Channel:${channelId}`,
            // Channels don't currently support URL grants. So hide the URL grant input.
            withoutUrlGrantIfNull: true,
            accessPolicy: channel.accessPolicy,
            onAccessPolicyChange: async (notification, accessPolicy) => {
                const event = await updateChannelAccessPolicy(context, {
                    channelId,
                    accessPolicy,
                    notification,
                });

                handleEventForChannel(event);
            },
            onCopyLink: handleCopyLink,
            accessLevelText: channelAccessLevelText,
        },
        // Move the menu further away from the subscribe button. It's quite large and
        // the default offset renders our menu too close to the subscribe button in my
        // design opinion.
        menuOffset: platform !== "mobile" ? "2.5" : undefined,
        menuActions: [
            [
                {
                    label: "Copy link",
                    icon: <LinkIcon />,
                    iconPlacement: "end",
                    pressErrorTitle: "Couldn’t copy channel link",
                    onPress: handleCopyLink,
                },
                ...(favoriteMenuAction ? [favoriteMenuAction] : emptyArray),
            ],
            ...(hasAccessLevel(accessLevel, "Manage")
                ? cast<Array<Array<MenuAction>>>([
                      [
                          {
                              label: "Edit name",
                              onPress: () => {
                                  if (platform !== "mobile") {
                                      setIsEditingNameInline(true);
                                  } else {
                                      setEditNameAndDescriptionMobileModalState({
                                          initiallyFocus: "Name",
                                      });
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
                  ])
                : emptyArray),
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
                : emptyArray),
        ],
    });

    const channelHeader = useMemo(
        (): PostListHeader & {type: "Channel"} => ({
            type: "Channel",
            channel,
            channelAndMetadataQuery,
            initialIsSubscribed,
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
            onAddAccountGrantsToAccessPolicy: async ({accountGrantById, notification}) => {
                const event = await addAccountGrantsToChannelAccessPolicy(context, {
                    channelId,
                    accountGrantById,
                    notification,
                });

                handleEventForChannel(event);
            },
        }),
        [
            channel,
            channelAndMetadataQuery,
            channelId,
            context,
            handleEventForChannel,
            initialIsSubscribed,
            isEditingDescriptionInline,
        ],
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
                header={channelHeader}
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
                            onAddAccountGrantsToAccessPolicy={
                                channelHeader.onAddAccountGrantsToAccessPolicy
                            }
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
