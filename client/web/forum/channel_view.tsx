import {Link as LinkIcon} from "phosphor-react";
import {useCallback, useEffect, useMemo, useRef, useState} from "react";
import {createAccessPolicyStore} from "~/client/web/access/create_access_policy_store.js";
import {useAppContext} from "~/client/web/context/app_context.js";
import {Box} from "~/client/web/design/box.js";
import {MenuAction} from "~/client/web/design/menu.js";
import {MobileFullScreenModal} from "~/client/web/design/mobile_full_screen_modal.js";
import {useRynamoIndexQueryBase} from "~/client/web/dynamo/use_rynamo_index_query.js";
import {useRynamoQuery} from "~/client/web/dynamo/use_rynamo_query.js";
import {ChannelMobileEditor} from "~/client/web/forum/channel_mobile_editor.js";
import {channelAccessLevelText} from "~/client/web/forum/internal/channel_access_level_text.js";
import {ChannelViewAside} from "~/client/web/forum/internal/channel_view_aside.js";
import {ChannelViewNameEditor} from "~/client/web/forum/internal/channel_view_name_editor.js";
import {ChannelViewSubscribeButton} from "~/client/web/forum/internal/channel_view_subscribe_button.js";
import {optimisticCreatePostEventEmitter} from "~/client/web/forum/internal/optimistic_create_post_event_emitter.js";
import {
    PostListHeader,
    PostQueryList,
    PostQueryListRynamoIndexQuery,
} from "~/client/web/forum/post_list.js";
import {PostListView} from "~/client/web/forum/post_list_view.js";
import {useDevConsoleTool} from "~/client/web/helpers/dev_console.js";
import {useStateWithOptimisticUpdates} from "~/client/web/helpers/use_state_with_optimistic_updates.js";
import {useStore} from "~/client/web/helpers/use_store.js";
import {writeTextToClipboard} from "~/client/web/helpers/write_text_to_clipboard.js";
import {LockBoldFillIcon} from "~/client/web/icons/lock_bold_fill_icon.js";
import {useNavigationBar} from "~/client/web/navigation/navigation_bar.js";
import {getClientInfo} from "~/client/web/remix/client_info_context.js";
import {usePlatform} from "~/client/web/remix/platform_context.js";
import {useRouteLayout} from "~/client/web/remix/route_layout_context.js";
import {getInitialAppRenderSpacingScale} from "~/client/web/remix/spacing_scale_context.js";
import {useNavigate} from "~/client/web/remix/use_navigate.js";
import {useSearchEntityRegistry} from "~/client/web/search/core/search_entity_registry_context.js";
import {useSearchFavoriteEntityMenuAction} from "~/client/web/search/core/use_search_favorite_affinity_entity_menu_action.js";
import {useSiteNavigationBarTitleBreadcrumb} from "~/client/web/sites/breadcrumb/use_site_navigation_bar_title_breadcrumb.js";
import {useSiteContextIfExists} from "~/client/web/sites/context/site_context.js";
import {useSiteRegistry} from "~/client/web/sites/context/site_registry_context.js";
import {applySiteAccessPolicyChange} from "~/client/web/sites/helpers/apply_site_access_policy_change.js";
import {useSpaceContext} from "~/client/web/spaces/context/space_context.js";
import {
    channelViewAsidePostFileMaxCount,
    postContentViewMinHeightPx,
    postListViewAsideMaxWidth,
} from "~/client/web/styles/forum_shared_styles.js";
import {contentStyles, sprinkles} from "~/client/web/styles/styles.js";
import {getInitialVirtualizedScrollViewRenderedItemCount} from "~/client/web/virtualized/get_initial_virtualized_scroll_view_rendered_item_count.js";
import {useWebSocket} from "~/client/web/web_socket/use_web_socket.js";
import {
    getAccountAccessLevelAssumingSpaceAccess,
    hasAccessLevel,
} from "~/shared/access/access_policy.js";
import {addRemLengths, spacing} from "~/shared/design/core/spacing.js";
import {doubleClickDelayMs} from "~/shared/design/core/timing.js";
import {RynamoIndexQueryResult, RynamoQueryResult} from "~/shared/dynamo/rynamo_types.js";
import {PermissionDeniedError} from "~/shared/error/error.open_source.js";
import {ChannelModel, ChannelOrMetadataModel} from "~/shared/forum/channel_model.js";
import {ChannelRealtimeProtocol} from "~/shared/forum/channel_realtime_protocol.js";
import {channelPermissionDeniedErrorDisplayMessageByExpectedAccessLevel} from "~/shared/forum/forum_error_messages.js";
import {PostModel} from "~/shared/forum/post_model.js";
import {emptyArray} from "~/shared/helpers/array/empty_array.open_source.js";
import {assert} from "~/shared/helpers/control/assert.open_source.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.open_source.js";
import {cast} from "~/shared/helpers/control/cast.open_source.js";
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
    initialChannelResult: RynamoQueryResult<ChannelOrMetadataModel>;
    initialPostsResult: RynamoIndexQueryResult<PostModel>;
    initialIsSubscribed: boolean;
    initialIsFavorite: boolean;
}) {
    const context = useAppContext();
    const platform = usePlatform();
    const routeLayout = useRouteLayout();
    const navigate = useNavigate();
    const {space, currentAccount} = useSpaceContext();
    const searchEntityRegistry = useSearchEntityRegistry();
    const siteRegistry = useSiteRegistry();
    const siteContext = useSiteContextIfExists();

    assert(initialChannelResult.items[0]?.model instanceof ChannelModel);

    const channelId = initialChannelResult.items[0].model.id;

    const shouldConnectToChannelRealtime = currentAccount !== null;

    const {isConnected, subscribeToEvents, subscribeToPongs, toggleShouldConnect} = useWebSocket(
        "ChannelRealtimeService",
        ChannelRealtimeProtocol,
        shouldConnectToChannelRealtime ? `/api/durable-objects/channels/${channelId}` : null,
    );

    const {query: channelAndMetadataQuery, handleEvent: handleEventForChannel} = useRynamoQuery(
        initialChannelResult,
        {
            isConnected,
            subscribeToPongs,
            subscribeToEvents: useCallback(
                subscriber => subscribeToEvents(event => subscriber(event.events)),
                [subscribeToEvents],
            ),
            backfillQuery: useCallback(
                async checkpoint => {
                    const {backfillChannelResult} = await backfillChannelAndMetadata(context, {
                        channelId,
                        checkpoint,
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
        },
    );

    const channelItem = channelAndMetadataQuery.getFirstItemIfExists();
    assert(channelItem?.model instanceof ChannelModel);
    const channel = channelItem.model;

    const accessPolicy = useStore(
        useMemo(
            () => createAccessPolicyStore(channel.accessPolicy, siteRegistry),
            [channel.accessPolicy, siteRegistry],
        ),
    );

    const accessLevel = useMemo(
        () => getAccountAccessLevelAssumingSpaceAccess(accessPolicy, currentAccount?.id),
        [accessPolicy, currentAccount?.id],
    );

    if (accessLevel === null) {
        throw new PermissionDeniedError("Current account lost access to channel", {
            displayMessage: channelPermissionDeniedErrorDisplayMessageByExpectedAccessLevel.View,
        });
    }

    // Update `SearchEntityRegistry` with the latest channel name. Now as the name
    // changes in realtime, any `SearchEntityModel`s rendered elsewhere in the product
    // will also update.
    useMemo(() => {
        return searchEntityRegistry.getEntityStore(
            new SearchEntityModel({
                type: "Channel",
                channel: {
                    id: channel.id,
                    version: channel.version,
                },
                title: channel.name,
            }),
        );
    }, [channel.name, channel.id, channel.version, searchEntityRegistry]);

    const [posts, setPosts, setPostsOptimistically] = useStateWithOptimisticUpdates(() =>
        PostQueryList.new(initialPostsResult),
    );

    // On mobile, the comment button doesn't expand/collapse. Instead it opens the post
    // in a new route. `<PostListView>` will throw if you pass in `posts` with expanded
    // comments on mobile. So make sure to close them all.
    if (platform === "mobile" && posts.hasOpenPostComments()) {
        setPosts(posts => posts.closeAllPostComments());
    }

    useDevConsoleTool("channel", () => ({
        posts,
        toggleShouldConnect,
    }));

    useRynamoIndexQueryBase(
        {
            query: posts.query,
            onUpdateQuery: useCallback(
                (update: (query: PostQueryListRynamoIndexQuery) => PostQueryListRynamoIndexQuery) =>
                    setPosts(posts => posts.updateQuery(update)),
                [setPosts],
            ),
        },
        {
            isConnected,
            subscribeToPongs,
            subscribeToEvents: useCallback(
                subscriber => subscribeToEvents(event => subscriber(event.events)),
                [subscribeToEvents],
            ),
            backfillQuery: useCallback(
                async checkpoint => {
                    const {backfillPostsResult} = await backfillChannelPosts(context, {
                        channelId,
                        checkpoint,
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

    // When a post is created, we should get it from our channel WebSocket connection.
    // But in case our WebSocket connection is slow, `<NewPostView>` emits an event
    // after a post has been successfully created and we handle that event here.
    useEffect(() => {
        return optimisticCreatePostEventEmitter.subscribe(event => {
            if (event.channelId !== channel.id) return;
            setPosts(posts => posts.updateQuery(query => query.handleEvents(event.events)));
        });
    }, [channel.id, setPosts]);

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
        const url = new URL(`/channel/${channel.id}`, window.location.href);
        await writeTextToClipboard(url.toString());
    };

    const lastPointerDownTimeRef = useRef<number | null>(null);
    const navigationBarTitleBreadcrumb = useSiteNavigationBarTitleBreadcrumb({accessPolicy});

    const navigationBar = useNavigationBar({
        withoutDisappearingTitle: true,
        title: (
            <Box
                display="flex"
                alignItems="center"
                gap={platform === "mobile" ? "1.5" : "2"}
                minWidth="0"
            >
                {!accessPolicy.defaultGrant && !accessPolicy.urlGrant && (
                    // We add a lock icon to private channels because unlike other entities we don't
                    // show the share switch in the navigation bar. Since knowing whether a channel is
                    // public or private is important context, we include a lock to make sure you know
                    // the channel is private before posting.
                    <LockBoldFillIcon
                        className={sprinkles({flexShrink: "0"})}
                        size={spacing[platform === "mobile" ? "3" : "4"]}
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

                            // Immediately apply a realtime event transaction to update our channel in case our
                            // realtime WebSocket connection is slow.
                            handleEventForChannel(event.events);
                        }}
                    />
                ) : (
                    <Box
                        onPointerDown={event => {
                            const currentTime = Date.now();
                            const lastPointerDownTime = lastPointerDownTimeRef.current;
                            lastPointerDownTimeRef.current = currentTime;

                            if (lastPointerDownTime === null) return;

                            if (currentTime - lastPointerDownTime > doubleClickDelayMs) return;

                            if (hasAccessLevel(accessLevel, "Manage") && platform !== "mobile") {
                                // Disable selection from double click.
                                //
                                // We implement double click with `onPointerDown` instead of `onDoubleClick`
                                // because `onDoubleClick` fires one pointer up but the browser performs text
                                // selection on double click pointer down. So there's a small visual glitch where
                                // you can see the browser selection after double click before pointer up when you
                                // use `onDoubleClick`,
                                event.preventDefault();

                                setIsEditingNameInline(true);
                            }
                        }}
                    >
                        {channel.name}
                    </Box>
                )}
            </Box>
        ),
        titleBreadcrumb: navigationBarTitleBreadcrumb,
        desktopMaxWidth:
            routeLayout !== "narrow"
                ? addRemLengths(contentStyles.contentMaxWidth, postListViewAsideMaxWidth)
                : contentStyles.contentMaxWidth,
        // Create a bit of space to the left so we don't cut off the channel name editor
        // border.
        desktopTitleLeftSlop: "1",
        desktopTitleFontSize: "400",
        desktopTitleFontWeight: "bold",
        // Don't render the subscribe button if the account doesn't have space access.
        desktopAdditionalActions: currentAccount ? (
            <ChannelViewSubscribeButton
                channelId={channelId}
                initialIsSubscribed={initialIsSubscribed}
            />
        ) : undefined,
        // Always put the share UI in the more menu. You should add users to a channel by
        // clicking the invite button in `<ChannelViewContributorsSection>`. Since in a
        // public channel it doesn't make sense to invite people from the share overlay.
        // Having both the share menu visible and the invite button in
        // `<ChannelViewContributorsSection>` may make it unclear what to use for adding
        // people to a channel.
        withWideRouteLayoutShareMenuItem: true,
        // Don't render the share button if the account doesn't have space access. They
        // won't be allowed to see the names of accounts in the share dialog.
        shareButton: currentAccount
            ? {
                  entityNoun: "channel",
                  entityId: `Channel:${channelId}`,
                  accessPolicy,
                  onAccessPolicyChange: async (notification, accessPolicy) => {
                      if (accessPolicy.type === "Site") {
                          await applySiteAccessPolicyChange({
                              context,
                              accessPolicy,
                              handleEventForSite: assertExists(siteContext).handleEventForSite,
                          });
                          return;
                      }

                      const event = await updateChannelAccessPolicy(context, {
                          channelId,
                          accessPolicy,
                          notification,
                      });

                      handleEventForChannel(event.events);
                  },
                  onCopyLink: handleCopyLink,
                  accessLevelText: channelAccessLevelText,
              }
            : undefined,
        // Move the menu further away from the subscribe button. It's quite large and the
        // default offset renders our menu too close to the subscribe button in my design
        // opinion.
        menuOffset: platform !== "mobile" ? "2.5" : undefined,
        menuActions: [
            [
                {
                    label: "Copy link",
                    icon: <LinkIcon />,
                    iconPlacement: "end",
                    pressErrorTitle: "Couldn\u2019t copy channel link",
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
                              pressErrorTitle: "Couldn\u2019t open files",
                              onPress: () => navigate(`/channel/${channelId}/files?from=channel`),
                          },
                      ],
                  ]
                : emptyArray),
        ],
        defaultPreviousRoute: `/home/${space.id}`,
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

                // Immediately apply a realtime event transaction to update our channel in case our
                // realtime WebSocket connection is slow.
                handleEventForChannel(event.events);
            },
            onAddAccountGrantsToAccessPolicy: async ({accountGrantById, notification}) => {
                const event = await addAccountGrantsToChannelAccessPolicy(context, {
                    channelId,
                    accountGrantById,
                    notification,
                });

                handleEventForChannel(event.events);
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
            // TODO(#sites-redesign): `width="full"` here makes the People/About right-rail
            // section placement correct when the channel is rendered inside site chrome, but
            // throws off the channel content layout when the channel is standalone. Pick a
            // single layout pattern that works in both — likely moving the width constraint up
            // to whichever wrapper owns the chrome.
            width={accessPolicy.type === "Site" ? "full" : undefined}
        >
            <PostListView
                header={channelHeader}
                footer={useMemo(() => ({type: "MarginBottom"}), [])}
                posts={posts}
                onTogglePostComments={useCallback(
                    postId => setPosts(posts => posts.togglePostComments(postId)),
                    [setPosts],
                )}
                onUpdatePostComments={useCallback(
                    (postId, update) => setPosts(posts => posts.updatePostComments(postId, update)),
                    [setPosts],
                )}
                onUpdatePostCommentsOptimistically={useCallback(
                    (postId, promise, update) =>
                        setPostsOptimistically(promise, (posts, promiseValue) =>
                            posts.updatePostComments(postId, comments =>
                                update(comments, promiseValue),
                            ),
                        ),
                    [setPostsOptimistically],
                )}
                onLoadMorePosts={async ({limit}) => {
                    const {postsResult} = await getChannelPosts(context, {
                        channelId: channel.id,
                        limit,
                        beforeCursor: posts.query.getPreviousPageCursorIfExists(),
                    });

                    setPosts(posts => posts.updateQuery(query => query.loadMore(postsResult)));
                }}
                shouldBeConnectedToChannelRealtime={shouldConnectToChannelRealtime}
                onPostRealtimeEvents={useCallback(
                    events => {
                        setPosts(posts => posts.updateQuery(query => query.handleEvents(events)));
                    },
                    [setPosts],
                )}
                onOptimisticPostRealtimeEvents={useCallback(
                    (promise, postId, update) => {
                        setPostsOptimistically(promise, (posts, promiseValue) => {
                            // Once `promise` resolves, use the event transaction from `promise` to update the
                            // posts instead of our optimistic updater.
                            if (promiseValue) {
                                return posts.updateQuery(query => query.handleEvents(promiseValue));
                            }

                            const oldPostItem = posts.getPostRealtimeItemIfExists(postId);
                            if (!oldPostItem) return posts;
                            const newPost = update(oldPostItem.model);

                            const newPostItem = {
                                ...oldPostItem,
                                // Always pretend like our optimistic update is one version higher than what's
                                // currently in state. Once `promise` resolves then we'll update the item with the
                                // real version.
                                version: oldPostItem.version + 1,
                                model: newPost,
                            };

                            return posts.updateQuery(query =>
                                query.handleEvents([
                                    {type: "PutItem", item: newPostItem, indexes: new Map()},
                                ]),
                            );
                        });
                    },
                    [setPostsOptimistically],
                )}
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
                                const {events} = await updateChannelNameAndDescription(context, {
                                    channelId,
                                    name,
                                    description,
                                });

                                // Immediately apply a realtime event transaction to update our channel in case our
                                // realtime WebSocket connection is slow.
                                handleEventForChannel(events);
                            }}
                            onCloseWithAnimation={() => onCloseWithAnimation()}
                        />
                    )}
                </MobileFullScreenModal>
            )}
        </Box>
    );
}
