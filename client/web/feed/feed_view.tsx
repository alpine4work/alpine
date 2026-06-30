import {useCallback, useMemo, useState} from "react";
import {useAppContext} from "~/client/web/context/app_context.js";
import {Box} from "~/client/web/design/box.js";
import {FeedViewSideBar} from "~/client/web/feed/internal/feed_view_side_bar.js";
import {PostFeedList} from "~/client/web/forum/post_feed_list.js";
import {PostListView} from "~/client/web/forum/post_list_view.js";
import {useDevConsoleTool} from "~/client/web/helpers/dev_console.js";
import {useResizeObserver} from "~/client/web/helpers/use_resize_observer.js";
import {useStateWithOptimisticUpdates} from "~/client/web/helpers/use_state_with_optimistic_updates.js";
import {useNavigationBar} from "~/client/web/navigation/navigation_bar.js";
import {useClientInfo} from "~/client/web/remix/client_info_context.js";
import {usePlatform} from "~/client/web/remix/platform_context.js";
import {useRouteLayout} from "~/client/web/remix/route_layout_context.js";
import {useSpaceContext} from "~/client/web/spaces/context/space_context.js";
import {
    feedViewSideBarLeftFlex,
    feedViewSideBarRightFlex,
    feedViewSideBarWidth,
} from "~/client/web/styles/feed_shared_styles.js";
import {postViewFlex} from "~/client/web/styles/forum_shared_styles.js";
import {contentStyles} from "~/client/web/styles/styles.js";
import {FeedEntryCursor} from "~/shared/feed/feed_entry_cursor.js";
import {FeedEntryModel} from "~/shared/feed/feed_entry_model.js";
import {getFeedEntries} from "~/shared/rpc/feed_rpc_definitions.js";
import {RpcDefinitionOutputType} from "~/shared/rpc/rpc_definition.js";
import {searchByAffinity} from "~/shared/rpc/search_rpc_definitions.js";

export function FeedView({
    initialAffinitySearch,
    initialFeed,
    withMarginBottom,
}: {
    initialAffinitySearch: RpcDefinitionOutputType<typeof searchByAffinity>;
    initialFeed: {
        endCursor: FeedEntryCursor | null;
        hasMoreEntries: boolean;
        entries: ReadonlyArray<FeedEntryModel>;
    };
    withMarginBottom?: boolean;
}) {
    const context = useAppContext();
    const clientInfo = useClientInfo();
    const platform = usePlatform();
    const routeLayout = useRouteLayout();
    const {space} = useSpaceContext();

    const [resizeRef, size] = useResizeObserver();

    const [feed, setFeed, setFeedOptimistically] = useStateWithOptimisticUpdates(() =>
        PostFeedList.new(initialFeed),
    );

    const [isLeftSideBarHiddenForDev, setIsLeftSideBarHiddenForDev] = useState(false);

    useDevConsoleTool("feed", () => ({
        toggleLeftSideBarVisibility: () => {
            setIsLeftSideBarHiddenForDev(isVisible => !isVisible);
        },
    }));

    const sideBarLeftSize = useMemo(
        () =>
            routeLayout !== "narrow" && !isLeftSideBarHiddenForDev
                ? ({maxWidth: feedViewSideBarWidth, flex: feedViewSideBarLeftFlex} as const)
                : undefined,
        [isLeftSideBarHiddenForDev, routeLayout],
    );

    // While we don't actually render a right sidebar, on large screens (where
    // `spacingScale === "medium"`) reserve a little space to the right of
    // `<PostListView>` to visually balance post content next to the sidebar. Since
    // text in the sidebar creates a ragged right edge which creates a lot of extra
    // visual whitespace to the left of the post content.
    const sideBarRightSize = useMemo(
        () =>
            routeLayout !== "narrow" && !isLeftSideBarHiddenForDev
                ? ({maxWidth: feedViewSideBarWidth, flex: feedViewSideBarRightFlex} as const)
                : undefined,
        [isLeftSideBarHiddenForDev, routeLayout],
    );

    const navigationBar = useNavigationBar({
        isDisabled: routeLayout !== "narrow",
        title: space.name,
        withoutDisappearingTitle: true,
        titleJustifyContent: "center",
        // This is a route for a root tab in our mobile app so don't show the back button.
        // It wouldn't work.
        withoutMobileBackButton: true,
    });

    // On mobile, the comment button doesn't expand/collapse. Instead it opens the post
    // in a new route. `<PostListView>` will throw if you pass in `posts` with expanded
    // comments on mobile. So make sure to close them all.
    if (platform === "mobile" && feed.hasOpenPostComments()) {
        setFeed(feed => feed.closeAllPostComments());
    }

    return (
        <Box ref={resizeRef} width="full" height="full" overflow="hidden">
            <PostListView
                navigationBar={routeLayout === "narrow" ? navigationBar : undefined}
                header={useMemo(
                    () => ({type: "FeedCreateSection", initialAffinitySearch}),
                    [initialAffinitySearch],
                )}
                footer={useMemo(() => {
                    if (!withMarginBottom) return;
                    return {type: "MarginBottom"};
                }, [withMarginBottom])}
                posts={feed}
                onTogglePostComments={useCallback(
                    postId => {
                        setFeed(feed => feed.togglePostComments(postId));
                    },
                    [setFeed],
                )}
                onUpdatePostComments={useCallback(
                    (postId, update) => {
                        setFeed(feed => feed.updatePostComments(postId, update));
                    },
                    [setFeed],
                )}
                onUpdatePostCommentsOptimistically={useCallback(
                    (postId, promise, update) =>
                        setFeedOptimistically(promise, (feed, promiseValue) =>
                            feed.updatePostComments(postId, comments =>
                                update(comments, promiseValue),
                            ),
                        ),
                    [setFeedOptimistically],
                )}
                onLoadMorePosts={async ({limit}) => {
                    const output = await getFeedEntries(context, {
                        spaceId: space.id,
                        limit,
                        afterCursor: feed.endCursor ?? undefined,
                    });
                    setFeed(feed => feed.loadMoreEntries(output));
                }}
                shouldBeConnectedToChannelRealtime={false}
                onPostRealtimeEvents={useCallback(
                    events => {
                        setFeed(feed => feed.handleEvents(events));
                    },
                    [setFeed],
                )}
                onOptimisticPostRealtimeEvents={useCallback(
                    (promise, postId, update) => {
                        setFeedOptimistically(promise, (feed, promiseValue) => {
                            // Once `promise` resolves, use the event transaction from `promise` to update the
                            // posts instead of our optimistic updater.
                            if (promiseValue) {
                                return feed.handleEvents(promiseValue);
                            }

                            const oldPostItem = feed.getPostRealtimeItemIfExists(postId);
                            if (!oldPostItem) return feed;
                            const newPost = update(oldPostItem.model);

                            const newPostItem = {
                                ...oldPostItem,
                                // Always pretend like our optimistic update is one version higher than what's
                                // currently in state. Once `promise` resolves then we'll update the item with the
                                // real version.
                                version: oldPostItem.version + 1,
                                model: newPost,
                            };

                            return feed.handleEvents([
                                {type: "PutItem", item: newPostItem, indexes: new Map()},
                            ]);
                        });
                    },
                    [setFeedOptimistically],
                )}
                // The amount of space to reserve for our left sidebar. We render the sidebar using
                // `extraChildren`. We also reserve some right sidebar space on large screens to
                // visually center our post content.
                sideBarLeftSize={sideBarLeftSize}
                sideBarRightSize={sideBarRightSize}
                extraChildren={
                    sideBarLeftSize &&
                    sideBarRightSize && (
                        <Box
                            pointerEvents="none"
                            zIndex="40"
                            position="sticky"
                            top="0"
                            width="full"
                            display="flex"
                            justifyContent="space-between"
                        >
                            <Box
                                overflow="hidden"
                                width="full"
                                style={{
                                    flex: sideBarLeftSize.flex,
                                    maxWidth: sideBarLeftSize.maxWidth,
                                }}
                            >
                                <FeedViewSideBar
                                    height={size?.height ?? clientInfo.screenHeight}
                                    initialAffinitySearch={initialAffinitySearch}
                                />
                            </Box>
                            <Box
                                width="full"
                                maxWidth={contentStyles.contentMaxWidth}
                                style={{flex: postViewFlex}}
                            />
                            <Box
                                width="full"
                                style={{
                                    flex: sideBarRightSize.flex,
                                    maxWidth: sideBarRightSize.maxWidth,
                                }}
                            />
                        </Box>
                    )
                }
            />
        </Box>
    );
}
