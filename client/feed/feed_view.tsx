import {useCallback, useMemo, useState} from "react";
import {useAppContext} from "~/client/context/app_context.js";
import {Box} from "~/client/design/box.js";
import {FeedViewSideBar} from "~/client/feed/internal/feed_view_side_bar.js";
import {PostFeedList} from "~/client/forum/post_feed_list.js";
import {PostListView} from "~/client/forum/post_list_view.js";
import {useResizeObserver} from "~/client/helpers/use_resize_observer.js";
import {useNavigationBar} from "~/client/navigation/navigation_bar.js";
import {useClientInfo} from "~/client/remix/client_info_context.js";
import {usePlatform} from "~/client/remix/platform_context.js";
import {useRouteLayout} from "~/client/remix/route_layout_context.js";
import {useSpaceContext} from "~/client/spaces/space_context.js";
import {
    feedViewSideBarLeftFlex,
    feedViewSideBarRightFlex,
    feedViewSideBarRightMaxWidth,
} from "~/client/styles/feed_shared_styles.js";
import {postViewFlex} from "~/client/styles/forum_shared_styles.js";
import {searchEntitySideBarWidth} from "~/client/styles/search_shared_styles.js";
import {contentStyles} from "~/client/styles/styles.js";
import {FeedEntryCursor} from "~/shared/feed/feed_entry_cursor.js";
import {FeedEntryModel} from "~/shared/feed/feed_entry_model.js";
import {getFeedEntries} from "~/shared/rpc/feed_rpc_definitions.js";
import {RpcDefinitionOutputType} from "~/shared/rpc/rpc_definition.js";
import {searchByAffinity} from "~/shared/rpc/search_rpc_definitions.js";

export function FeedView({
    initialAffinitySearch,
    initialFeed,
}: {
    initialAffinitySearch: RpcDefinitionOutputType<typeof searchByAffinity>;
    initialFeed: {
        endCursor: FeedEntryCursor | null;
        hasMoreEntries: boolean;
        entries: ReadonlyArray<FeedEntryModel>;
    };
}) {
    const context = useAppContext();
    const clientInfo = useClientInfo();
    const platform = usePlatform();
    const routeLayout = useRouteLayout();
    const {space} = useSpaceContext();

    const [resizeRef, size] = useResizeObserver();

    const [feed, setFeed] = useState(() => PostFeedList.new(initialFeed));

    const sideBarLeftSize = useMemo(
        () =>
            routeLayout !== "narrow"
                ? ({maxWidth: searchEntitySideBarWidth, flex: feedViewSideBarLeftFlex} as const)
                : undefined,
        [routeLayout],
    );

    // While we don't actually render a right sidebar, on large screens (where
    // `spacingScale === "medium"`) reserve a little space to the right of
    // `<PostListView>` to visually balance post content next to the sidebar. Since
    // text in the sidebar creates a ragged right edge which creates a lot of extra
    // visual whitespace to the left of the post content.
    const sideBarRightSize = useMemo(
        () =>
            routeLayout !== "narrow"
                ? ({
                      maxWidth: feedViewSideBarRightMaxWidth,
                      flex: feedViewSideBarRightFlex,
                  } as const)
                : undefined,
        [routeLayout],
    );

    const navigationBar = useNavigationBar({
        isDisabled: routeLayout !== "narrow",
        title: space.name,
        withoutDisappearingTitle: true,
        titleJustifyContent: "center",
        // This is a route for a root tab in our mobile app so don't show the back
        // button. It wouldn't work.
        withoutMobileBackButton: true,
    });

    // On mobile, the comment button doesn't expand/collapse. Instead it opens the
    // post in a new route. `<PostListView>` will throw if you pass in `posts` with
    // expanded comments on mobile. So make sure to close them all.
    if (platform === "mobile" && feed.hasOpenPostComments()) {
        setFeed(feed.closeAllPostComments());
    }

    return (
        <Box ref={resizeRef} width="full" height="full" overflow="hidden">
            <PostListView
                navigationBar={routeLayout === "narrow" ? navigationBar : undefined}
                header={useMemo(
                    () => ({type: "FeedCreateSection", initialAffinitySearch}),
                    [initialAffinitySearch],
                )}
                posts={feed}
                onTogglePostComments={useCallback(
                    postId => setFeed(feed => feed.togglePostComments(postId)),
                    [],
                )}
                onUpdatePostComments={useCallback(
                    (postId, update) => setFeed(feed => feed.updatePostComments(postId, update)),
                    [],
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
                onPostRealtimeEventTransaction={useCallback(({eventTransaction}) => {
                    setFeed(feed => feed.handleEventTransaction(eventTransaction));
                }, [])}
                // The amount of space to reserve for our left sidebar. We render the sidebar
                // using `extraChildren`. We also reserve some right sidebar space on large
                // screens to visually center our post content.
                sideBarLeftSize={sideBarLeftSize}
                sideBarRightSize={sideBarRightSize}
                extraChildren={
                    sideBarLeftSize && (
                        <Box
                            zIndex="10"
                            position="sticky"
                            top="0"
                            width="full"
                            display="flex"
                            justifyContent="space-between"
                        >
                            <Box
                                overflow="hidden"
                                width="full"
                                maxWidth={sideBarLeftSize.maxWidth}
                                style={{flex: sideBarLeftSize.flex}}
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
                        </Box>
                    )
                }
            />
        </Box>
    );
}
