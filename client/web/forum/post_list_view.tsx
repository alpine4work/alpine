import classNames from "classnames";
import {SpinnerGap} from "phosphor-react";
import {
    Memo,
    ReactNode,
    Ref,
    RefObject,
    forwardRef,
    useCallback,
    useEffect,
    useId,
    useImperativeHandle,
    useMemo,
    useRef,
    useState,
} from "react";
import {
    ContentBlockWidthContextProvider,
    useContentBlockAvailableWidth,
} from "~/client/web/content/content_block_width.js";
import {MessageInputRef} from "~/client/web/content/messaging/message_input_base.js";
import {useAppContext} from "~/client/web/context/app_context.js";
import {MobileFullScreenModal} from "~/client/web/design/mobile_full_screen_modal.js";
import {
    flushNavigationBarScrollEventEmitter,
    navigationBarHeight,
} from "~/client/web/design/navigation_bar_helpers.js";
import {safeAreaOnlyScrollbarInsetTop} from "~/client/web/design/scrollbar.js";
import {Spacer} from "~/client/web/design/spacer.js";
import {useScrollToAvoidBottomBarsAndMobileKeyboard} from "~/client/web/design/use_scroll_to_avoid_bottom_bars_and_mobile_keyboard.js";
import {ChannelViewHeader} from "~/client/web/forum/internal/channel_view_header.js";
import {FeedCreateSection} from "~/client/web/forum/internal/feed_create_section.js";
import {FeedEntryView} from "~/client/web/forum/internal/feed_entry_view.js";
import {
    PostCommentInput,
    PostRealtimeProcedures,
} from "~/client/web/forum/internal/post_comment_input.js";
import {usePostEditing} from "~/client/web/forum/internal/post_editing.js";
import {PostMobileEditor} from "~/client/web/forum/internal/post_mobile_editor.js";
import {resolveFlexSizes} from "~/client/web/forum/internal/resolve_flex_sizes.js";
import {PostCommentView} from "~/client/web/forum/post_comment_view.js";
import {
    PostContentView,
    PostContentViewInitialScroll,
} from "~/client/web/forum/post_content_view.js";
import {
    PostListFooter,
    PostListHeader,
    PostListInterface,
    PostListPostContentItem,
    PostListWithHeaderOrWithFooter,
} from "~/client/web/forum/post_list.js";
import {useConstant} from "~/client/web/helpers/lifecycle/use_constant.js";
import {useEvent} from "~/client/web/helpers/lifecycle/use_event.js";
import {useLayoutEffectWithoutServerSideWarning} from "~/client/web/helpers/lifecycle/use_layout_effect_without_server_side_warning.js";
import {useErrorState} from "~/client/web/helpers/use_error_state.js";
import {useResizeObserver} from "~/client/web/helpers/use_resize_observer.js";
import {getInitialLoadMessageCount} from "~/client/web/messaging/get_initial_load_message_count.js";
import {useMessageEditing} from "~/client/web/messaging/message_editing.js";
import {MessageList} from "~/client/web/messaging/message_list.js";
import {MessageListMessageShimmer} from "~/client/web/messaging/message_list_message_shimmer.js";
import {MessagingTypingIndicators} from "~/client/web/messaging/messaging_typing_indicators.js";
import {MessagingViewPointerToolbar} from "~/client/web/messaging/messaging_view_pointer_toolbar.js";
import {
    OnDeleteMessageReactionFunction,
    OnSetMessageReactionFunction,
} from "~/client/web/messaging/set_or_delete_message_reaction_with_optimistic_update.js";
import {tryLoadingMessages} from "~/client/web/messaging/try_loading_messages.js";
import {
    JumpToMessageRangeOptions,
    useJumpToMessageRange,
} from "~/client/web/messaging/use_jump_to_message_range.js";
import {useJumpToPostRange} from "~/client/web/messaging/use_jump_to_post_range.js";
import {NavigationBarResult} from "~/client/web/navigation/navigation_bar_types.js";
import {getClientInfo} from "~/client/web/remix/client_info_context.js";
import {usePlatform} from "~/client/web/remix/platform_context.js";
import {useRouteLayout} from "~/client/web/remix/route_layout_context.js";
import {
    getSpacingScaleWithoutListening,
    useSpacingScale,
} from "~/client/web/remix/spacing_scale_context.js";
import {useNavigate} from "~/client/web/remix/use_navigate.js";
import {PostShimmer} from "~/client/web/shimmer/post_shimmer.js";
import {useSiteRegistry} from "~/client/web/sites/context/site_registry_context.js";
import {useSpaceContext} from "~/client/web/spaces/space_context.js";
import {feedCreateSectionMinHeight} from "~/client/web/styles/feed_shared_styles.js";
import {
    feedEntryHeight,
    postContentViewCommentMargin,
    postContentViewMinHeightPx,
    postListViewAsideFlex,
    postListViewAsideMaxWidth,
    postListViewMarginAfterPostWithOpenComments,
    postViewFlex,
    postViewMinHeightPx,
} from "~/client/web/styles/forum_shared_styles.js";
import {
    messageInputMinHeightPx,
    messageViewMinHeightPx,
    messagingTypingIndicatorsMinHeightPx,
    messagingViewMarginBottom,
} from "~/client/web/styles/messaging_shared_styles.js";
import {peekStackOverlayBorderRadius} from "~/client/web/styles/peek_shared_styles.js";
import {contentStyles, spinAnimationClassName, sprinkles} from "~/client/web/styles/styles.js";
import {renderVirtualizedScrollViewItemWithExpensiveFeaturesDisabledDuringScroll} from "~/client/web/virtualized/helpers/render_virtualized_scroll_view_item_with_expensive_features_disabled_during_scroll.js";
import {
    VirtualizedScrollView,
    VirtualizedScrollViewRef,
    VirtualizedScrollViewRenderItem,
} from "~/client/web/virtualized/virtualized_scroll_view.js";
import {
    LocalAccessPolicy,
    getAccountAccessLevelAssumingSpaceAccess,
    hasAccessLevel,
} from "~/shared/access/access_policy.js";
import {greyElevated1ClassName} from "~/shared/design/core/constant_class_names.js";
import {
    ParsableRemLength,
    Spacing,
    addRemLengths,
    convertRemLengthToPx,
    parseRemLength,
    screenPaddingX,
    spacing,
} from "~/shared/design/core/spacing.js";
import {delayLoadingIndicatorLimitMs} from "~/shared/design/core/timing.js";
import {RynamoEvent} from "~/shared/dynamo/rynamo_types.js";
import {InternalError} from "~/shared/error/error.js";
import {FileAttachmentTarget} from "~/shared/files/file_attachment_target.js";
import {ChannelPreviewModel} from "~/shared/forum/channel_model.js";
import {PostCommentModel, PostModel} from "~/shared/forum/post_model.js";
import {createPromiseResolver} from "~/shared/helpers/async/promise_resolver.js";
import {wait} from "~/shared/helpers/async/wait.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.js";
import {cast} from "~/shared/helpers/control/cast.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.js";
import {LazyMap} from "~/shared/helpers/control/lazy_map.js";
import {areRangesOverlapping} from "~/shared/helpers/geometry/are_ranges_overlapping.js";
import {DefaultWeakMap} from "~/shared/helpers/map/default_weak_map.js";
import {emptyMap} from "~/shared/helpers/map/empty_map.js";
import {clamp} from "~/shared/helpers/number/clamp.js";
import {MaybePromise} from "~/shared/helpers/types/maybe_promise.js";
import {PostId} from "~/shared/id/types/id_types.js";
import {MessageContentPayloadParent} from "~/shared/messaging/message_schema.js";
import {
    getPostCommentsFromEnd,
    getPostCommentsFromStart,
    updatePostContent,
} from "~/shared/rpc/forum_rpc_definitions.js";
import {ConstStore} from "~/shared/store/const_store.js";
import {Store} from "~/shared/store/store.js";

// NOTE(calebmer): You are not allowed to use the `<Box>` component in this
// file. It is critical for scroll performance that this component renders
// fast. Manually use the `sprinkles()` function instead. This reduces the
// number of fibers React needs to render. One day we'd like to introduce
// transformations that automatically inline `<Box>` components and
// `sprinkles()` functions at which point using `<Box>` would not make a
// performance difference.
//
// Assign a variable to null so you get a TypeScript error if you try to
// use `<Box>`.
//
// eslint-disable-next-line @typescript-eslint/no-unused-vars
const Box = null;

const postListViewCardBackgroundClassName = sprinkles({
    zIndex: "10",
    pointerEvents: "none",
    position: "absolute",
    top: "0",
    bottom: "-1",
    left: "-0.5",
    right: "-0.5",
    backgroundColor: "grey-0",
    // Same border radius as a peek. Expanded posts should feel like inline peeks.
    borderRadius: peekStackOverlayBorderRadius,
    boxShadow: "elevation-30",
});

const PostListViewForwardRef = forwardRef(PostListView);
export {PostListViewForwardRef as PostListView};

export type PostListViewRef = {
    /**
     * Jump to the provided post comment. If the post or post comment do not exist an
     * error will be thrown.
     */
    jumpToPostCommentRange(options: JumpToMessageRangeOptions<PostId>): void;

    /**
     * Start editing the post with the provided `PostId`.
     */
    startEditingPost(post: PostModel): void;
};

/**
 * Renders a virtualized list of posts which can expand their comments inline.
 *
 * This component handles all rendering for a post unit. Including rendering an
 * individual post on a post route. Since even when rendering an individual post
 * you still need to virtualize the list of comments. This means there is some
 * confusing overloading because features like `header` and `aside` which are
 * important in the context of a channel are not important in the context of
 * rendering a single post.
 */
function PostListView(
    {
        header,
        footer,
        posts: postsWithoutHeader,
        onTogglePostComments,
        onUpdatePostComments,
        onUpdatePostCommentsOptimistically,
        onLoadMorePosts,
        shouldBeConnectedToChannelRealtime,
        onPostRealtimeEvents,
        onOptimisticPostRealtimeEvents,
        aside,
        sideBarLeftSize,
        sideBarRightSize,
        extraChildren,
        navigationBar,
        withSafeAreaInsetTop = false,
        initialScrollForFirstPost,
        initialParentByPostId = emptyMap,
        isPostArchived,
        onArchivePost,
        onUnarchivePost,
    }: {
        /**
         * If this post list is rendering a channel, you may provide this prop and we will
         * render an area at the top of the list describing the channel.
         */
        header?: Memo<PostListHeader>;

        /**
         * You may provide this prop and we will render an area at the bottom of the list
         * with whatever you want.
         */
        footer?: Memo<PostListFooter>;

        /**
         * The post content to be rendered in this post list view.
         */
        posts: PostListInterface;

        /**
         * Toggle the comments for a post open and closed.
         */
        onTogglePostComments: Memo<(postId: PostId) => void>;

        /**
         * Arbitrarily update the comments for a post. When we render a post's comments
         * we'll connect to realtime for that post. As realtime updates come in, we'll call
         * this function with any updates to the post's comments.
         */
        onUpdatePostComments: Memo<
            (
                postId: PostId,
                update: (
                    postComments: MessageList<PostCommentModel>,
                ) => MessageList<PostCommentModel>,
            ) => void
        >;

        /**
         * Arbitrarily update the comments for a post optimistically. If the promise
         * rejects then we undo the optimistic update.
         */
        onUpdatePostCommentsOptimistically: Memo<
            <PromiseValue>(
                postId: PostId,
                promise: Promise<PromiseValue>,
                update: (
                    postComments: MessageList<PostCommentModel>,
                    promiseValue: PromiseValue | undefined,
                ) => MessageList<PostCommentModel>,
            ) => void
        >;

        /**
         * If the post list has more posts then this function should load those posts. This
         * function is required if you initialize the component with many posts and set
         * `hasMorePosts` to true. Not providing it will throw an error when the user
         * reaches the end of the list.
         */
        onLoadMorePosts?: (options: {
            limit: number;
            afterCursor?: {createdTime: Date; postId: PostId};
        }) => Promise<void>;

        /**
         * If true, our parent component is telling us it has connected to
         * `ChannelRealtimeService` and will be updating `posts` when realtime events come
         * in. It means we don't need to handle realtime events for posts in
         * `<PostCommentInput>` and we don't need to backfill the post model.
         */
        shouldBeConnectedToChannelRealtime: boolean;

        /**
         * Apply a realtime event transaction for posts.
         *
         * This is used:
         *
         * - After successfully updating post content we call this in case our realtime
         *   WebSocket connection is slow.
         *
         * - To update our post data with events we've received from `PostRealtimeService`
         *   (which we connect to in `<PostCommentInput>`) when
         *   `shouldBeConnectedToChannelRealtime` is false. If
         *   `shouldBeConnectedToChannelRealtime` is true then we should be getting
         *   realtime updates from `ChannelRealtimeService`.
         */
        onPostRealtimeEvents: Memo<(events: ReadonlyArray<RynamoEvent<PostModel>>) => void>;

        /**
         * Make an arbitrary update to a post optimistically. Must provide a promise that
         * resolves to a realtime event transaction. If the promise resolves then the event
         * transaction update is applied. If the promise rejects then we revert the
         * optimistic update.
         *
         * Similar to `onPostRealtimeEvents` but allows for an optimistic update.
         */
        onOptimisticPostRealtimeEvents: Memo<
            (
                promise: Promise<ReadonlyArray<RynamoEvent<PostModel>>>,
                postId: PostId,
                update: (post: PostModel) => PostModel,
            ) => void
        >;

        /**
         * An element we render to the side of the post list but still within the scroll
         * view. The aside is sticky so it will always be visible as you scroll.
         *
         * If the aside's height is larger than the window then we you scroll down the
         * aside will scroll down. Once you reach the bottom of the aside it will stop
         * scrolling and stick to the bottom. Then when you scroll back up the aside will
         * scroll up until you reach the aside's top, then it will stick again.
         *
         * This deep integration with the positioning of posts and the scroll view is why
         * it needs to be a prop on this element.
         *
         * On mobile the aside will not be rendered.
         */
        // TODO(calebmer): Could we get rid of the `aside` prop and use `sideBarRightSize`
        // instead? I think if we add scroll event functions then it's doable.
        aside?: ReactNode;

        /**
         * Space allocated for a sidebar rendered to the left of the post list. Doesn't
         * actually render a sidebar, you have to render the sidebar yourself. Probably
         * using the `extraChildren` prop.
         */
        sideBarLeftSize?: Memo<{maxWidth: ParsableRemLength; flex: number}>;

        /**
         * Space allocated for a sidebar rendered to the right of the post list. Doesn't
         * actually render a sidebar, you have to render the sidebar yourself. Probably
         * using the `extraChildren` prop.
         */
        sideBarRightSize?: Memo<{maxWidth: ParsableRemLength; flex: number}>;

        /**
         * Extra children to be rendered in our post list's `<VirtualizedScrollView>`.
         * Passed into the `<VirtualizedScrollView>`'s `extraChildren` prop.
         */
        extraChildren?: ReactNode;

        /**
         * If you want to include a navigation bar in this list view you may pass in the
         * result of `useNavigationBar()` here and the virtualized scroll view will be
         * properly configured.
         */
        navigationBar?: NavigationBarResult;

        /**
         * Should we make room for top safe area? False by default. If you set the
         * `navigationBar` prop then it will mostly handle safe area for you.
         */
        withSafeAreaInsetTop?: boolean;

        /**
         * How to initially scroll the first `<PostContentView>` component in our list.
         */
        initialScrollForFirstPost?: Memo<PostContentViewInitialScroll> | null;

        /**
         * Initial message input parent for some post in the list.
         */
        initialParentByPostId?: ReadonlyMap<PostId, MessageContentPayloadParent>;

        /**
         * Is this post archived?
         *
         * We should the inbox archival button if this property is provided (even if always
         * returns false).
         */
        isPostArchived?: Memo<(postId: PostId) => boolean>;

        /**
         * Archive an individual post.
         */
        onArchivePost?: Memo<(postId: PostId) => MaybePromise<void>>;

        /**
         * Unarchive an individual post.
         */
        onUnarchivePost?: Memo<(postId: PostId) => MaybePromise<void>>;
    },
    ref: Ref<PostListViewRef>,
) {
    const context = useAppContext();
    const platform = usePlatform();
    const spacingScale = useSpacingScale();
    const routeLayout = useRouteLayout();
    const navigate = useNavigate();
    const {space, currentAccount} = useSpaceContext();
    const siteRegistry = useSiteRegistry();

    const viewRef = useRef<VirtualizedScrollViewRef>(null);
    const [viewContainerRef, viewSize] = useResizeObserver();
    const [asideRef, asideSize] = useResizeObserver({
        withSuppressResizeLoopErrorNotification: true,
    });

    const lastScrollOffsetRef = useRef(0);
    const [scrollDirectionState, setScrollDirectionState] = useState<{
        scrollDirection: "Up" | "Down";
        asideBufferedHeight: number;
    }>({
        scrollDirection: "Down",
        asideBufferedHeight: 0,
    });

    const posts = useMemo(() => {
        if (!header && !footer) return postsWithoutHeader;

        return new PostListWithHeaderOrWithFooter(
            header ?? null,
            footer ?? null,
            postsWithoutHeader,
        );
    }, [header, footer, postsWithoutHeader]);

    const hasAside = routeLayout !== "narrow" && !!aside;
    const hasNavigationBar = !!navigationBar?.navigationBar;
    const hasHeader = !!header;

    const shouldNotShowChannelId = header
        ? header.type === "NavigationBar"
            ? (header.shouldNotShowChannelId ?? null)
            : header.type === "Channel"
              ? header.channel.id
              : null
        : null;

    // Always pin the post comment input to the bottom of the list view on mobile
    // layout of a single post. We use a heuristic of one post with always open
    // comments to determine if we're in a single post context.
    const isPostView =
        hasNavigationBar &&
        !header &&
        posts.isSinglePost() &&
        posts.getPostContentItemIfExists(0)?.postCommentsState === "AlwaysOpen";

    // On mobile, the comment button doesn't expand/collapse. Instead it opens the post
    // in a new route. Because:
    //
    // - It's a challenging UI problem to have a sticky comment input while also
    //   avoiding the keyboard and tab bar.
    // - Because there's less space in peeks/mobile, it may be harder to mentally stay
    //   aware of the fact that you're looking at a comment section in the middle of a
    //   feed of posts. Opening in a new route with a post-specific header lets the
    //   user stay focused.
    if (routeLayout === "narrow" && !isPostView) {
        assert(
            !posts.hasOpenPostComments(),
            "Posts can\u2019t have open comments on narrow route layouts",
        );
    }

    const originalContentBlockAvailableWidth = useContentBlockAvailableWidth();

    const contentBlockAvailableWidth = useMemo(() => {
        const sizes: Array<{maxSize: number; flex: number}> = [];

        if (sideBarLeftSize) {
            sizes.push({
                maxSize: convertRemLengthToPx(sideBarLeftSize.maxWidth, spacingScale),
                flex: sideBarLeftSize.flex,
            });
        }

        sizes.push({
            maxSize: convertRemLengthToPx(contentStyles.contentMaxWidth, spacingScale),
            flex: postViewFlex,
        });

        if (hasAside) {
            sizes.push({
                maxSize: convertRemLengthToPx(postListViewAsideMaxWidth, spacingScale),
                flex: postListViewAsideFlex,
            });
        }

        if (sideBarRightSize) {
            sizes.push({
                maxSize: convertRemLengthToPx(sideBarRightSize.maxWidth, spacingScale),
                flex: sideBarRightSize.flex,
            });
        }

        const resolvedSizes = resolveFlexSizes(originalContentBlockAvailableWidth, sizes);

        return assertExists(sideBarLeftSize ? resolvedSizes[1] : resolvedSizes[0]);
    }, [
        hasAside,
        originalContentBlockAvailableWidth,
        sideBarLeftSize,
        sideBarRightSize,
        spacingScale,
    ]);

    const isLoadingRef = useRef(false);
    const setErrorState = useErrorState();

    const tryLoadingMoreData = useEvent(
        (
            renderedRange: {startIndex: number; endIndex: number} | null,
        ): {isLoading: false} | {isLoading: true; promise: Promise<void>} => {
            // If we're already loading, don't try to load more comments.
            if (isLoadingRef.current) return {isLoading: false};

            const result = actuallyTryLoadingMoreData(renderedRange);
            if (!result.isLoading) return result;

            isLoadingRef.current = true;
            result.promise.then(
                () => {
                    isLoadingRef.current = false;
                },
                error => {
                    isLoadingRef.current = false;
                    setErrorState(error);
                },
            );
            return result;

            // Try to load more data without worrying about managing coordination with
            // `isLoadingRef` or error handling.
            function actuallyTryLoadingMoreData(
                renderedRange: {startIndex: number; endIndex: number} | null,
            ): {isLoading: false} | {isLoading: true; promise: Promise<void>} {
                if (!renderedRange) return {isLoading: false};

                const view = assertExists(viewRef.current);

                let nextIndex = renderedRange.startIndex;
                while (nextIndex <= renderedRange.endIndex) {
                    const item = posts.getPostContentItemIfExists(nextIndex);

                    // Skip non-posts (like channel header)
                    if (!item) {
                        nextIndex++;
                        continue;
                    }

                    nextIndex =
                        item.postCommentInputItemIndex !== null
                            ? item.postCommentInputItemIndex + 1
                            : item.postContentItemIndex + 1;

                    // The post comments are not open, there's nothing to load here.
                    if (item.postCommentInputItemIndex === null) continue;

                    // There are no comments in this post, nothing to load here.
                    if (item.postContentItemIndex + 1 === item.postCommentInputItemIndex) continue;

                    const postCommentRangeStartIndex = item.postContentItemIndex + 1;
                    const postCommentRangeEndIndex = item.postCommentInputItemIndex - 1;

                    // We are rendering the post but we are not rendering any of the posts comments.
                    // Don't load anything new.
                    if (
                        !areRangesOverlapping(
                            postCommentRangeStartIndex,
                            postCommentRangeEndIndex,
                            renderedRange.startIndex,
                            renderedRange.endIndex,
                        )
                    ) {
                        continue;
                    }

                    const renderedPostCommentRangeStartIndex =
                        Math.max(postCommentRangeStartIndex, renderedRange.startIndex) -
                        (item.postContentItemIndex + 1);
                    const renderedPostCommentRangeEndIndex =
                        Math.min(postCommentRangeEndIndex, renderedRange.endIndex) -
                        (item.postContentItemIndex + 1);

                    const result = tryLoadingMessages({
                        viewHeight: view.getHeight(),
                        messages: item.postComments,
                        range: {
                            startIndex: renderedPostCommentRangeStartIndex,
                            endIndex: renderedPostCommentRangeEndIndex,
                        },
                        loadFromStart: async ({afterMessageIndex, beforeMessageIndex, limit}) => {
                            const {checkpoint, commentCount, comments, otherReferencedComments} =
                                await getPostCommentsFromStart(context, {
                                    postId: item.post.id,
                                    afterCommentIndex: afterMessageIndex,
                                    beforeCommentIndex: beforeMessageIndex,
                                    limit,
                                });
                            return {
                                checkpoint,
                                messageCount: commentCount,
                                messages: comments,
                                otherReferencedMessages: otherReferencedComments,
                            };
                        },
                        loadFromEnd: async ({afterMessageIndex, beforeMessageIndex, limit}) => {
                            const {checkpoint, commentCount, comments, otherReferencedComments} =
                                await getPostCommentsFromEnd(context, {
                                    postId: item.post.id,
                                    afterCommentIndex: afterMessageIndex,
                                    beforeCommentIndex: beforeMessageIndex,
                                    limit,
                                });
                            return {
                                checkpoint,
                                messageCount: commentCount,
                                messages: comments,
                                otherReferencedMessages: otherReferencedComments,
                            };
                        },
                    });

                    if (result.isLoading) {
                        return {
                            isLoading: true,
                            promise: result.promise.then(result => {
                                onUpdatePostComments(item.post.id, postComments =>
                                    postComments
                                        .initializeCheckpointIfNeeded(result.checkpoint)
                                        .loadMessages(result),
                                );
                            }),
                        };
                    }
                }

                // If we are not loading any comments and the unloaded posts item is rendered, try
                // loading that...
                const renderedRangeEndItem = posts.getItem(renderedRange.endIndex);
                if (renderedRangeEndItem.type === "MoreUnloadedPosts") {
                    return {
                        isLoading: true,
                        promise: (async () => {
                            assert(
                                onLoadMorePosts,
                                "Must provided an `onLoadMorePosts` prop when the post list has more posts",
                            );

                            const spacingScale = getSpacingScaleWithoutListening();

                            // The limit of items we will load is two views worth of posts. This gives the user
                            // some space to scroll and read before we need to load more posts.
                            const limit = Math.max(
                                20,
                                Math.ceil(
                                    (view.getHeight() * 2) /
                                        postContentViewMinHeightPx[spacingScale],
                                ),
                            );

                            await onLoadMorePosts({
                                limit,
                            });
                        })(),
                    };
                }

                return {isLoading: false};
            }
        },
    );

    // Whenever our list data changes, try loading more comments. In case our rendered
    // range stayed the same but we see some some unloaded comments.
    //
    // This effect should also fire when `tryLoadingMorePostComments()` completes in
    // case it didn't fully load the list.
    useEffect(() => {
        // eslint-disable-next-line @typescript-eslint/no-unused-expressions
        posts;

        const view = assertExists(viewRef.current);
        tryLoadingMoreData(view.getRenderedRange());
    }, [posts, tryLoadingMoreData]);

    const loadInitialPostComments = useEvent(
        async (item: Pick<PostListPostContentItem, "post" | "postComments">): Promise<void> => {
            // If we're already loading, don't try to load more comments.
            if (isLoadingRef.current) return;
            isLoadingRef.current = true;

            try {
                const limit = getInitialLoadMessageCount(getClientInfo());

                // If we already have some loaded messages then we are trying to finish the initial
                // loaded message list by starting at our last loaded message.
                const lastLoadedMessage =
                    item.postComments.getLastLoadedMessageBeforeIfExists(limit);

                if (lastLoadedMessage === null || lastLoadedMessage.index < limit - 1) {
                    const {checkpoint, commentCount, comments, otherReferencedComments} =
                        await getPostCommentsFromStart(context, {
                            postId: item.post.id,
                            afterCommentIndex: lastLoadedMessage?.index ?? null,
                            beforeCommentIndex: null,
                            limit:
                                lastLoadedMessage !== null
                                    ? limit - (lastLoadedMessage.index + 1)
                                    : limit,
                        });

                    onUpdatePostComments(item.post.id, postComments =>
                        postComments.initializeCheckpointIfNeeded(checkpoint).loadMessages({
                            messageCount: commentCount,
                            messages: comments,
                            otherReferencedMessages: otherReferencedComments,
                        }),
                    );
                }

                isLoadingRef.current = false;
            } catch (error) {
                setErrorState(error);
            }
        },
    );

    // Post realtime is managed by the `<PostCommentInput>` component since the
    // `<PostCommentInput>` component is always mounted when the post's comments are
    // open. Since we need realtime actions in every part of the post we have
    // `<PostCommentInput>` stash the method to send them in this ref so they can be
    // called elsewhere.
    const proceduresByPostIdRef = useRef(new Map<PostId, PostRealtimeProcedures>());

    // Manages the current post being edited.
    //
    // At the post list level for the same reasons message editing is at the post list
    // level.
    const {postEditing, modals: postEditingModals} = usePostEditing({
        onUpdatePostContent: async ({postId, contentVersion, steps}) => {
            const event = await updatePostContent(context, {
                postId,
                contentVersion,
                steps,
            });

            onPostRealtimeEvents(event.events);
        },
    });

    // Manages the editable message.
    //
    // This is at the post list level because:
    //
    // 1. If a message is scrolled out of the virtualization window we still want it to
    //    be editable so it shouldn't lose state.
    //
    // 2. We want only one message to be editable at a time.
    const {messageEditing, modals: messageEditingModals} = useMessageEditing<PostId>({
        messageNoun: "comment",
        onUpdateMessageContent: async ({roomKey, messageIndex, contentVersion, steps}) => {
            const procedures = proceduresByPostIdRef.current.get(roomKey);
            if (!procedures) throw new InternalError("Post comment input isn\u2019t mounted");

            await procedures.updateCommentContent({
                commentIndex: messageIndex,
                contentVersion,
                steps,
            });
        },
        onDeleteMessage: async ({roomKey, messageIndex}) => {
            const procedures = proceduresByPostIdRef.current.get(roomKey);
            if (!procedures) throw new InternalError("Post comment input isn\u2019t mounted");

            await procedures.deleteComment({
                commentIndex: messageIndex,
            });
        },
    });

    // Manages which comment `<PostCommentInput>` is currently replying to.
    const [inputParentByPostId, setInputParentByPostId] =
        useState<ReadonlyMap<PostId, MessageContentPayloadParent>>(initialParentByPostId);

    const [isShowingAllContentByPostId, setIsShowingAllContentByPostId] =
        useState<ReadonlyMap<PostId, true>>(emptyMap);

    if (isPostView || routeLayout === "narrow") {
        // On narrow layouts, expanding content inline navigates to the post. Keep this
        // state empty so we never show inline expanded-content styling.
        if (isShowingAllContentByPostId.size > 0) {
            setIsShowingAllContentByPostId(emptyMap);
        }
    } else {
        // If we stop editing a post that was previously collapsed, we should now be
        // showing the post's entire content.
        if (
            postEditing.state.isEditing &&
            isShowingAllContentByPostId.get(postEditing.state.postId) !== true
        ) {
            const {postId} = postEditing.state;

            setIsShowingAllContentByPostId(oldIsShowingAllContentByPostId => {
                const newIsShowingAllContentByPostId = new Map(oldIsShowingAllContentByPostId);
                newIsShowingAllContentByPostId.set(postId, true);
                return newIsShowingAllContentByPostId;
            });
        }
    }

    const {jumpState: jumpToMessageRangeState, jumpToMessageRange} = useJumpToMessageRange<PostId>({
        viewRef,
        tryLoadingMoreData,
        scrollToIndexForMessageIndex: (postId, index) =>
            assertExists(posts.getPostByIdIfExists(postId)).getPostCommentIndex(index),
    });

    const {jumpState: jumpToPostRangeState, jumpToPostRange} = useJumpToPostRange({
        viewRef,
        scrollToIndexForPost: postId =>
            assertExists(posts.getPostByIdIfExists(postId)).postContentItemIndex,
    });

    // If we're jumping to a post while a post's content is closed then open the
    // content so we can see what the jump animation is trying to highlight!
    if (
        !isPostView &&
        routeLayout !== "narrow" &&
        jumpToPostRangeState &&
        isShowingAllContentByPostId.get(jumpToPostRangeState.options.postId) !== true
    ) {
        setIsShowingAllContentByPostId(oldIsShowingAllContentByPostId => {
            const newIsShowingAllContentByPostId = new Map(oldIsShowingAllContentByPostId);
            newIsShowingAllContentByPostId.set(jumpToPostRangeState.options.postId, true);
            return newIsShowingAllContentByPostId;
        });
    }

    const postEditingDispatch = postEditing.dispatch;

    useImperativeHandle(
        ref,
        () => ({
            jumpToPostCommentRange: jumpToMessageRange,
            startEditingPost: post => {
                postEditingDispatch({
                    type: "StartEditing",
                    postId: post.id,
                    contentVersion: post.contentUpdate?.mappings.length ?? 0,
                    content: post.content,
                    platform,
                });
            },
        }),
        [jumpToMessageRange, platform, postEditingDispatch],
    );

    // Make sure the bottom of the scroll view stays visible when the keyboard opens
    // and closes.
    useScrollToAvoidBottomBarsAndMobileKeyboard(viewRef, {
        getAnchorPosition: useEvent(oldVisibleRect => {
            // NOTE(calebmer, 2024-07-16): We used to anchor chat view scroll to the message
            // the user was replying to or editing. However, in practice this felt janky to me.
            // Scrolling wasn't predictable when swiping to reply to a message! I think
            // consistency is likely the better user experience here.
            //
            // To look at the old message anchoring code, git blame this comment to see the
            // commit where I remove it.

            return {top: oldVisibleRect.bottom, height: 0, isPinned: true};
        }),
    });

    // Don't render the post comment input (which should be the last item) if we are
    // pinning the comment input to the bottom of the view.
    const itemCount = posts.getItemCount() - (isPostView ? 1 : 0);

    const handleScroll = useEvent((scrollOffset: number) => {
        const view = assertExists(viewRef.current);

        scrollOffset = clamp(
            0,
            scrollOffset,
            Math.max(0, view.getContentHeight() - view.getHeight()),
        );

        const viewHeight = viewSize?.height ?? 0;
        const asideHeight = Math.max(viewHeight, asideSize?.height ?? 0);

        const lastScrollOffset = lastScrollOffsetRef.current;
        lastScrollOffsetRef.current = scrollOffset;

        setScrollDirectionState(scrollDirectionState => {
            const newScrollDirection = scrollOffset > lastScrollOffset ? "Down" : "Up";

            if (scrollDirectionState.scrollDirection === newScrollDirection)
                return scrollDirectionState;

            const asideScrollOffset = clamp(
                0,
                scrollOffset - scrollDirectionState.asideBufferedHeight,
                asideHeight - viewHeight,
            );

            const asideBufferedHeight = scrollOffset - asideScrollOffset;

            return {
                scrollDirection: newScrollDirection,
                asideBufferedHeight,
            };
        });
    });

    // We need to subscribe to synchronous scroll flushes for the same reason
    // `navigation_bar.tsx` does. We use a similar `position: sticky` pattern that
    // flips depending on the scroll direction. So if the scroll direction is changing
    // synchronously it's good to know so we can handle that.
    useEffect(() => {
        return flushNavigationBarScrollEventEmitter.subscribe(element => {
            const view = assertExists(viewRef.current);
            if (element !== view.getElement()) return;
            handleScroll(view.getScrollOffset());
        });
    }, [handleScroll]);

    // NOTE(calebmer): This is a bit of a paranoid protection. Whenever the number of
    // items in our view changes (especially when the number of items decreases) make
    // sure `asideBufferedHeight` is clamped to the correct range. We've observed a bug
    // where when collapsing the last post in a post list view, the post list view is
    // still scrollable and that's because the aside buffered height has not been
    // reset! This fixes that bug and makes sense in theory.
    //
    // It's a little hacky doing this in an effect that listens to `itemCount` changes.
    // It would be a little cleaner if we had a resize callback for content height or
    // height changes.
    useLayoutEffectWithoutServerSideWarning(() => {
        if (viewSize?.height === undefined) return;
        if (asideSize?.height === undefined) return;

        // eslint-disable-next-line @typescript-eslint/no-unused-expressions
        itemCount;

        const view = assertExists(viewRef.current);

        const scrollOffset = clamp(
            0,
            view.getScrollOffset(),
            Math.max(0, view.getContentHeight() - view.getHeight()),
        );

        const viewHeight = viewSize.height;
        const asideHeight = Math.max(viewHeight, asideSize.height);

        setScrollDirectionState(scrollDirectionState => {
            const asideScrollOffset = clamp(
                0,
                scrollOffset - scrollDirectionState.asideBufferedHeight,
                asideHeight - viewHeight,
            );

            const asideBufferedHeight = scrollOffset - asideScrollOffset;

            if (asideBufferedHeight === scrollDirectionState.asideBufferedHeight)
                return scrollDirectionState;

            return {
                scrollDirection: scrollDirectionState.scrollDirection,
                asideBufferedHeight,
            };
        });
    }, [asideSize?.height, itemCount, viewSize?.height]);

    const fileAttachmentTargetByPostId = useMemo(
        () =>
            new LazyMap(
                (postId: PostId) =>
                    ({
                        type: "PostComments",
                        postId,
                    }) satisfies FileAttachmentTarget as Memo<FileAttachmentTarget>,
            ),
        [],
    );

    const inputRefByPostId = useConstant(
        () =>
            new LazyMap<PostId, RefObject<MessageInputRef | null>>(() => ({
                current: null,
            })),
    );

    const focusPostCommentInputIfCommentsOpenRef = useRef<PostId | null>(null);

    useLayoutEffectWithoutServerSideWarning(() => {
        if (focusPostCommentInputIfCommentsOpenRef.current === null) return;

        const postId = focusPostCommentInputIfCommentsOpenRef.current;

        const post = posts.getPostByIdIfExists(postId);
        if (post === null) return;

        if (post.postCommentsState === "Closed") return;

        // Great! The post's comments are open. Let's focus the comment input now.
        focusPostCommentInputIfCommentsOpenRef.current = null;

        inputRefByPostId.get(postId).current?.focus();
    }, [posts, inputRefByPostId]);

    const idBase = useId();

    const sideBarLeftSpacer = useMemo(() => {
        if (!sideBarLeftSize) return null;

        return (
            <div
                className={sprinkles({width: "full"})}
                style={{
                    flex: sideBarLeftSize.flex,
                    maxWidth: parseRemLength(sideBarLeftSize.maxWidth) + "rem",
                }}
            />
        );
    }, [sideBarLeftSize]);

    const sideBarRightSpacer = useMemo(() => {
        if (!sideBarRightSize) return null;

        return (
            <div
                className={sprinkles({width: "full"})}
                style={{
                    flex: sideBarRightSize.flex,
                    maxWidth: parseRemLength(sideBarRightSize.maxWidth) + "rem",
                }}
            />
        );
    }, [sideBarRightSize]);

    const asideSpacer = useMemo(() => {
        if (!hasAside) return null;

        return (
            <div
                className={sprinkles({
                    width: "full",
                    maxWidth: postListViewAsideMaxWidth,
                })}
                style={{
                    flex: postListViewAsideFlex,
                }}
            />
        );
    }, [hasAside]);

    const topBorder = useMemo(() => {
        return (
            <div
                className={sprinkles({
                    position: "absolute",
                    left: screenPaddingX,
                    right: screenPaddingX,
                    height: "border",
                    backgroundColor: "grey-5",
                })}
                style={{top: -1}}
            />
        );
    }, []);

    const handleSetMessageReaction: Memo<OnSetMessageReactionFunction<PostId>> = useCallback(
        async (postId, {messageIndex, ...input}) => {
            const procedures = proceduresByPostIdRef.current.get(postId);
            if (!procedures) throw new InternalError("Post comment input isn\u2019t mounted");

            await procedures.setCommentReaction({
                commentIndex: messageIndex,
                ...input,
            });
        },
        [],
    );

    const handleDeleteMessageReaction: Memo<OnDeleteMessageReactionFunction<PostId>> = useCallback(
        async (postId, {messageIndex, ...input}) => {
            const procedures = proceduresByPostIdRef.current.get(postId);
            if (!procedures) throw new InternalError("Post comment input isn\u2019t mounted");

            await procedures.deleteCommentReaction({
                commentIndex: messageIndex,
                ...input,
            });
        },
        [],
    );

    const hasCommentAccessLevelByChannel = useMemo(
        () =>
            new DefaultWeakMap<ChannelPreviewModel, Store<boolean>>(channel => {
                function hasCommentAccessLevel(accessPolicy: LocalAccessPolicy) {
                    return hasAccessLevel(
                        getAccountAccessLevelAssumingSpaceAccess(accessPolicy, currentAccount?.id),
                        "Comment",
                    );
                }

                switch (channel.accessPolicy.data.type) {
                    case "Local":
                        return new ConstStore(hasCommentAccessLevel(channel.accessPolicy.data));
                    case "Site":
                        return siteRegistry
                            .getSiteStore(assertExists(channel.accessPolicy.data.site))
                            .map(site => hasCommentAccessLevel(site.accessPolicy));
                    default:
                        throw exhaustive(channel.accessPolicy.data);
                }
            }),
        [currentAccount?.id, siteRegistry],
    );

    const renderItem: VirtualizedScrollViewRenderItem = useCallback(
        index => {
            const item = posts.getItem(index);

            switch (item.type) {
                case "Header": {
                    return {
                        key: "Header",
                        minHeight: addRemLengths(
                            hasNavigationBar ? spacing[navigationBarHeight] : "0rem",
                            item.header.type === "FeedCreateSection"
                                ? feedCreateSectionMinHeight[platform]
                                : "0rem",
                        ),
                        node: (
                            <div
                                className={sprinkles({
                                    display: "flex",
                                    justifyContent: "center",
                                })}
                            >
                                {sideBarLeftSpacer}
                                <div
                                    className={sprinkles({
                                        width: "full",
                                        overflow: "hidden",
                                        maxWidth: contentStyles.contentMaxWidth,
                                        paddingTop: "safe-area-inset",
                                    })}
                                    style={{
                                        flex: postViewFlex,
                                    }}
                                >
                                    {hasNavigationBar && <Spacer space={navigationBarHeight} />}
                                    {item.header.type === "Channel" ? (
                                        <ChannelViewHeader
                                            header={item.header}
                                            hasNoPosts={posts.getItemCount() === 1}
                                        />
                                    ) : item.header.type === "FeedCreateSection" ? (
                                        <FeedCreateSection
                                            initialAffinitySearch={
                                                item.header.initialAffinitySearch
                                            }
                                        />
                                    ) : null}
                                </div>
                                {asideSpacer}
                                {sideBarRightSpacer}
                            </div>
                        ),
                    };
                }
                case "PostContent": {
                    const isPreviousItemPostWithCardBackground =
                        !isPostView && routeLayout !== "narrow"
                            ? isPostListPreviousItemPostWithCardBackground(
                                  posts,
                                  index,
                                  isShowingAllContentByPostId,
                              )
                            : false;

                    const isShowingAllContent =
                        isShowingAllContentByPostId.get(item.post.id) === true;

                    const hasCardBackground =
                        !isPostView &&
                        routeLayout !== "narrow" &&
                        (item.postCommentsState !== "Closed" || isShowingAllContent);

                    return {
                        key: `PostContent:${item.post.id}`,
                        minHeight: isPostView
                            ? postViewMinHeightPx[spacingScale]
                            : postContentViewMinHeightPx[spacingScale],
                        zIndex: hasCardBackground
                            ? item.postCommentsState !== "Closed"
                                ? "20"
                                : "10"
                            : "0",
                        node: (
                            <div
                                className={sprinkles({
                                    display: "flex",
                                    justifyContent: "center",
                                    paddingTop:
                                        withSafeAreaInsetTop && index === 0
                                            ? "safe-area-inset"
                                            : isPreviousItemPostWithCardBackground
                                              ? postListViewMarginAfterPostWithOpenComments
                                              : undefined,
                                    paddingBottom:
                                        index === posts.getItemCount() - (isPostView ? 2 : 1)
                                            ? "safe-area-inset"
                                            : undefined,
                                })}
                            >
                                {sideBarLeftSpacer}
                                <div
                                    className={classNames(
                                        sprinkles({
                                            position: "relative",
                                            width: "full",
                                            minWidth: "flex-fit",
                                            maxWidth: contentStyles.contentMaxWidth,
                                        }),
                                        hasCardBackground && greyElevated1ClassName,
                                    )}
                                    style={{flex: postViewFlex}}
                                >
                                    {!isPostView &&
                                        !hasCardBackground &&
                                        item.postCommentsState === "Closed" &&
                                        !isPreviousItemPostWithCardBackground &&
                                        topBorder}
                                    {hasCardBackground && item.postCommentsState === "Closed" && (
                                        <div className={postListViewCardBackgroundClassName} />
                                    )}
                                    {(isPostView || item.postCommentsState !== "Closed") && (
                                        <div
                                            className={sprinkles({
                                                position: "absolute",
                                                zIndex: "20",
                                                left: "0",
                                                right: "0",
                                                bottom: "0",
                                                height: "border",
                                                paddingX: screenPaddingX,
                                            })}
                                        >
                                            <div
                                                className={sprinkles({
                                                    height: "full",
                                                    width: "full",
                                                    backgroundColor: "grey-5",
                                                })}
                                            />
                                        </div>
                                    )}
                                    <PostContentView
                                        post={item.post}
                                        postComments={item.postComments}
                                        postCommentsState={item.postCommentsState}
                                        postEditing={postEditing}
                                        // If we are rendering in the context of a channel, don't render the channel in
                                        // posts.
                                        shouldShowChannel={
                                            shouldNotShowChannelId !== item.post.channel.id
                                        }
                                        isPostView={isPostView}
                                        // You shouldn't be able to react to a post if you don't have `Comment` access on
                                        // the post.
                                        //
                                        // Use the `accessPolicy` from `header` if applicable. Because we update the
                                        // `channel` in `header` in realtime. Whereas the `channel` preview in the
                                        // `PostModel` might not update in realtime.
                                        hasCommentAccessLevel={hasCommentAccessLevelByChannel.getOrSetDefault(
                                            header?.type === "Channel" &&
                                                header.channel.id === item.post.channel.id
                                                ? header.channel
                                                : item.post.channel,
                                        )}
                                        initialScroll={
                                            index === 0 || (hasHeader && index === 1)
                                                ? (initialScrollForFirstPost ?? null)
                                                : null
                                        }
                                        jumpState={
                                            jumpToPostRangeState?.options.postId === item.post.id
                                                ? jumpToPostRangeState
                                                : null
                                        }
                                        idBase={idBase}
                                        onTogglePostComments={() => {
                                            if (item.postCommentsState === "Closed") {
                                                focusPostCommentInputIfCommentsOpenRef.current =
                                                    item.post.id;
                                            }

                                            onTogglePostComments(item.post.id);
                                        }}
                                        onLoadInitialPostComments={() =>
                                            loadInitialPostComments(item)
                                        }
                                        onScrollToIfNotVisible={() => {
                                            assertExists(viewRef.current).scrollToKeyIfExists(
                                                `PostContent:${item.post.id}`,
                                                {withAnchor: true},
                                            );
                                        }}
                                        isShowingAllContent={isShowingAllContent}
                                        onIsShowingAllContentChange={isShowingAllContent => {
                                            // If you want to see the whole post in a peek (or on mobile) we navigate you to
                                            // the post view instead of showing it inline. Since a post could be quite long it
                                            // would be easy to lose your place.
                                            if (
                                                isShowingAllContent &&
                                                routeLayout === "narrow" &&
                                                !isPostView
                                            ) {
                                                navigate(
                                                    `/s/${item.post.spaceId}/posts/${item.post.id}`,
                                                );
                                                return;
                                            }

                                            setIsShowingAllContentByPostId(
                                                oldIsShowingAllContentByPostId => {
                                                    const newIsShowingAllContentByPostId = new Map(
                                                        oldIsShowingAllContentByPostId,
                                                    );
                                                    if (isShowingAllContent) {
                                                        newIsShowingAllContentByPostId.set(
                                                            item.post.id,
                                                            true,
                                                        );
                                                    } else {
                                                        newIsShowingAllContentByPostId.delete(
                                                            item.post.id,
                                                        );
                                                    }
                                                    return newIsShowingAllContentByPostId;
                                                },
                                            );
                                        }}
                                        onOptimisticPostRealtimeEvents={
                                            onOptimisticPostRealtimeEvents
                                        }
                                        isPostArchived={isPostArchived}
                                        onArchivePost={onArchivePost}
                                        onUnarchivePost={onUnarchivePost}
                                    />
                                </div>
                                {asideSpacer}
                                {sideBarRightSpacer}
                            </div>
                        ),
                        renderAdditionalItemIndexes:
                            item.postCommentInputItemIndex !== null && !isPostView
                                ? [item.postCommentInputItemIndex]
                                : undefined,
                    };
                }

                case "LoadedPostComment":
                case "UnloadedPostComment":
                case "OptimisticPostComment": {
                    const previousItem = index > 0 ? posts.getItem(index - 1) : null;
                    const nextItem =
                        index < posts.getItemCount() - 1 ? posts.getItem(index + 1) : null;

                    const previousComment =
                        previousItem?.type === "LoadedPostComment" ||
                        previousItem?.type === "OptimisticPostComment"
                            ? previousItem.postComment
                            : null;
                    const nextComment =
                        nextItem?.type === "LoadedPostComment" ||
                        nextItem?.type === "OptimisticPostComment"
                            ? nextItem.postComment
                            : null;

                    const isLastComment =
                        item.postCommentIndex ===
                        item.postComments.getMessageCountIncludingOptimisticMessages() - 1;

                    const renderItem = (disableExpensiveFeaturesDuringScroll: boolean) => {
                        const messageNode =
                            item.type === "LoadedPostComment" ||
                            item.type === "OptimisticPostComment" ? (
                                <PostCommentView
                                    item={item}
                                    previousComment={previousComment}
                                    nextComment={nextComment}
                                    fileAttachmentTarget={fileAttachmentTargetByPostId.get(
                                        item.post.id,
                                    )}
                                    isLastComment={isLastComment}
                                    messageEditing={messageEditing}
                                    jumpToMessageRangeState={jumpToMessageRangeState}
                                    onJumpToMessageRange={jumpToMessageRange}
                                    onJumpToPostRange={jumpToPostRange}
                                    onReplyToMessage={() => {
                                        if (item.postComment.isOptimistic) return;
                                        const postCommentIndex = item.postComment.index;

                                        setInputParentByPostId(inputParentByPostId => {
                                            const newInputParentByPostId = new Map(
                                                inputParentByPostId,
                                            );
                                            newInputParentByPostId.set(item.post.id, {
                                                type: "Message",
                                                index: postCommentIndex,
                                            });
                                            return newInputParentByPostId;
                                        });
                                    }}
                                    onDeleteMessage={async () => {
                                        const procedures = proceduresByPostIdRef.current.get(
                                            item.post.id,
                                        );
                                        if (!procedures)
                                            throw new InternalError(
                                                "Post comment input isn\u2019t mounted",
                                            );

                                        await procedures.deleteComment({
                                            commentIndex: item.postCommentIndex,
                                        });
                                    }}
                                    disableExpensiveFeaturesDuringScroll={
                                        disableExpensiveFeaturesDuringScroll
                                    }
                                    onSetMessageReaction={handleSetMessageReaction}
                                    onDeleteMessageReaction={handleDeleteMessageReaction}
                                    onUpdatePostCommentsOptimistically={
                                        onUpdatePostCommentsOptimistically
                                    }
                                    // You shouldn't be able to edit, delete, or reply to comments if you don't have
                                    // `Comment` access on the post.
                                    //
                                    // Use the `accessPolicy` from `header` if applicable. Because we update the
                                    // `channel` in `header` in realtime. Whereas the `channel` preview in the
                                    // `PostModel` might not update in realtime.
                                    hasCommentAccessLevel={hasCommentAccessLevelByChannel.getOrSetDefault(
                                        header?.type === "Channel" &&
                                            header.channel.id === item.post.channel.id
                                            ? header.channel
                                            : item.post.channel,
                                    )}
                                />
                            ) : (
                                <MessageListMessageShimmer
                                    randomSeed={item.post.id}
                                    index={item.postCommentIndex}
                                    previousMessage={previousComment}
                                    nextMessage={nextComment}
                                    messages={item.postComments}
                                />
                            );

                        return (
                            <div
                                className={sprinkles({
                                    display: "flex",
                                    justifyContent: "center",
                                })}
                            >
                                {sideBarLeftSpacer}
                                <div
                                    className={classNames(
                                        sprinkles({
                                            position: "relative",
                                            width: "full",
                                            minWidth: "flex-fit",
                                            maxWidth: contentStyles.contentMaxWidth,
                                        }),
                                        // Elevated since when comments are open they're rendered in a card design (card
                                        // background rendered by `CommentInput`).
                                        greyElevated1ClassName,
                                    )}
                                    style={{
                                        flex: postViewFlex,
                                    }}
                                >
                                    {item.postCommentIndex === 0 && (
                                        <Spacer space={postContentViewCommentMargin} />
                                    )}
                                    {messageNode}
                                    {isPostView &&
                                        // -2 instead of -1 since when `isPostView` is true we don't actually render the
                                        // final comment input item in `posts`.
                                        index === posts.getItemCount() - 2 && (
                                            <div style={{height: messagingViewMarginBottom}} />
                                        )}
                                </div>
                                {asideSpacer}
                                {sideBarRightSpacer}
                            </div>
                        );
                    };

                    return {
                        key:
                            item.type === "LoadedPostComment"
                                ? `PostComment:${item.post.id}:${item.postComment.index}`
                                : item.type === "OptimisticPostComment"
                                  ? `PostComment:${item.post.id}:${item.postCommentIndex}`
                                  : `UnloadedPostComment:${item.post.id}:${item.postCommentIndex}`,
                        minHeight: messageViewMinHeightPx[spacingScale],
                        zIndex:
                            messageEditing.state.isEditing &&
                            messageEditing.state.messageRoomKey === item.post.id &&
                            messageEditing.state.messageIndex === item.postCommentIndex
                                ? "30"
                                : "20",
                        renderAdditionalItemIndexes: !isPostView
                            ? [item.postCommentInputItemIndex]
                            : [],
                        withManualLayout: true,
                        render: renderVirtualizedScrollViewItemWithExpensiveFeaturesDisabledDuringScroll(
                            {
                                render: renderItem,
                            },
                        ),
                    };
                }

                case "PostCommentsTypingIndicator": {
                    return {
                        key: `PostCommentsTypingIndicator:${item.post.id}`,
                        minHeight: messagingTypingIndicatorsMinHeightPx[spacingScale],
                        zIndex: "20",
                        node: (
                            <div
                                className={sprinkles({
                                    display: "flex",
                                    justifyContent: "center",
                                })}
                            >
                                {sideBarLeftSpacer}
                                <div
                                    className={classNames(
                                        sprinkles({
                                            position: "relative",
                                            width: "full",
                                            maxWidth: contentStyles.contentMaxWidth,
                                        }),
                                        // Elevated since when comments are open they're rendered in a card design (card
                                        // background rendered by `CommentInput`).
                                        greyElevated1ClassName,
                                    )}
                                    style={{
                                        flex: postViewFlex,
                                    }}
                                >
                                    {item.postComments.getMessageCountIncludingOptimisticMessages() ===
                                        0 && <Spacer space={postContentViewCommentMargin} />}
                                    <MessagingTypingIndicators
                                        typingStateByConnectionId={item.typingStateByConnectionId}
                                        shouldAddMarginBottom={
                                            isPostView &&
                                            // -2 instead of -1 since when `isPostView` is true we don't actually render the
                                            // final comment input item in `posts`.
                                            index === posts.getItemCount() - 2
                                        }
                                    />
                                </div>
                                {asideSpacer}
                                {sideBarRightSpacer}
                            </div>
                        ),
                    };
                }

                // The post comment input item sticks to the bottom of the screen while a post is
                // visible. Whenever any item in the post is rendered we also additionally render
                // the post comment input (`renderAdditionalItemIndexes`) so that virtualization
                // doesn't remove it.
                //
                // We create a `<div>` that spans the bottom of the post content to the end of the
                // entire post. This is the range in which our post comment input will be sticky.
                // We create a second `<div>` of the same range but rendering the full post width
                // border. The post comment input is shaped so that when we reach the bottom of the
                // page the full width border will slide underneath it. Creating the effect of
                // while scrolling the comment input is a layer on top of the post and when at the
                // bottom of the post the comment input is inline.
                //
                // IMPORTANT: This code is very similar to how we render `<DocumentCommentInput>`
                // in `<DocumentCommentThreadListView>`! If you are updating this code you also
                // probably want to update `<DocumentCommentThreadListView>`. We don't know what a
                // good abstraction here is so following the advice "no abstraction is better than
                // the wrong abstraction".
                case "PostCommentInput": {
                    // On mobile, the comment button doesn't expand/collapse. Instead it opens the post
                    // in a new route. Supplemental sanity check to the assert at the beginning of this
                    // component.
                    assert(routeLayout !== "narrow");

                    const inputParent = inputParentByPostId.get(item.post.id) ?? null;

                    // This is defined out here so that it doesn't re-rerender every time the
                    // `render()` function is called since it's referentially stable.
                    const inputNode = (
                        <PostCommentInput
                            isStickyPositioned={true}
                            inputRef={inputRefByPostId.get(item.post.id)}
                            header={header}
                            post={item.post}
                            viewRef={viewRef}
                            proceduresRef={procedures => {
                                if (procedures) {
                                    proceduresByPostIdRef.current.set(item.post.id, procedures);
                                } else {
                                    proceduresByPostIdRef.current.delete(item.post.id);
                                }
                            }}
                            postComments={item.postComments}
                            fileAttachmentTarget={fileAttachmentTargetByPostId.get(item.post.id)}
                            onUpdatePostComments={update =>
                                onUpdatePostComments(item.post.id, update)
                            }
                            postCommentEditing={messageEditing}
                            parent={inputParent}
                            onParentClear={() => {
                                setInputParentByPostId(inputParentByPostId => {
                                    const newInputParentByPostId = new Map(inputParentByPostId);
                                    newInputParentByPostId.delete(item.post.id);
                                    return newInputParentByPostId;
                                });
                            }}
                            onJumpToPostCommentRange={jumpToMessageRange}
                            onJumpToPostRange={jumpToPostRange}
                            onDeletePostComment={async postCommentIndex => {
                                const procedures = proceduresByPostIdRef.current.get(item.post.id);
                                if (!procedures)
                                    throw new InternalError(
                                        "Post comment input isn\u2019t mounted",
                                    );

                                await procedures.deleteComment({
                                    commentIndex: postCommentIndex,
                                });
                            }}
                            shouldBeConnectedToChannelRealtime={shouldBeConnectedToChannelRealtime}
                            onPostRealtimeEvents={onPostRealtimeEvents}
                        />
                    );

                    return {
                        key: `PostCommentInput:${item.post.id}`,
                        minHeight: messageInputMinHeightPx[platform][spacingScale],
                        withManualLayout: true,
                        render: ({
                            ref,
                            offset,
                            height,
                            shouldRenderWithRelativePositioning,
                            getPositionByIndex,
                        }) => {
                            const isPreviousItemPostWithCardBackground = !isPostView
                                ? isPostListPreviousItemPostWithCardBackground(
                                      posts,
                                      item.postContentItemIndex,
                                      isShowingAllContentByPostId,
                                  )
                                : false;

                            const postContentPosition = getPositionByIndex(
                                item.postContentItemIndex,
                            );

                            const postContentPositionOffset =
                                postContentPosition.offset +
                                (isPreviousItemPostWithCardBackground
                                    ? convertRemLengthToPx(
                                          postListViewMarginAfterPostWithOpenComments,
                                          spacingScale,
                                      )
                                    : 0);

                            const postContentOffsetEnd =
                                postContentPosition.offset + postContentPosition.height;

                            return (
                                <>
                                    <div
                                        style={{
                                            pointerEvents: "none",
                                            display: "flex",
                                            justifyContent: "center",
                                            alignItems: "flex-end",
                                            zIndex: "30",
                                            ...(!shouldRenderWithRelativePositioning
                                                ? {
                                                      position: "absolute",
                                                      top: postContentOffsetEnd,
                                                      left: "0",
                                                      right: "0",
                                                      height:
                                                          offset - postContentOffsetEnd + height,
                                                  }
                                                : {
                                                      position: "relative",
                                                  }),
                                        }}
                                    >
                                        <div
                                            ref={ref}
                                            style={{
                                                ...(!shouldRenderWithRelativePositioning && {
                                                    position: "sticky",
                                                    bottom: 0,
                                                }),
                                            }}
                                            className={sprinkles({
                                                width: "full",
                                                display: "flex",
                                                justifyContent: "center",
                                                paddingBottom:
                                                    index === posts.getItemCount() - 1
                                                        ? "safe-area-inset"
                                                        : undefined,
                                            })}
                                        >
                                            {sideBarLeftSpacer}
                                            <div
                                                className={classNames(
                                                    sprinkles({
                                                        position: "relative",
                                                        zIndex: "0",
                                                        width: "full",
                                                        minWidth: "flex-fit",
                                                        maxWidth: contentStyles.contentMaxWidth,
                                                        pointerEvents: "auto",
                                                        backgroundColor: "grey-0",
                                                    }),
                                                    // Elevated since when comments are open they're rendered in a card design (card
                                                    // background rendered by `CommentInput`).
                                                    greyElevated1ClassName,
                                                )}
                                                style={{
                                                    flex: postViewFlex,
                                                }}
                                            >
                                                {inputNode}
                                            </div>
                                            {asideSpacer}
                                            {sideBarRightSpacer}
                                        </div>
                                    </div>
                                    {!shouldRenderWithRelativePositioning && !isPostView && (
                                        <div
                                            style={{
                                                pointerEvents: "none",
                                                position: "absolute",
                                                top: postContentPositionOffset,
                                                height: offset + height - postContentPositionOffset,
                                                left: 0,
                                                right: 0,
                                            }}
                                        >
                                            <div
                                                className={sprinkles({
                                                    display: "flex",
                                                    justifyContent: "center",
                                                    height: "full",
                                                })}
                                            >
                                                {sideBarLeftSpacer}
                                                <div
                                                    className={classNames(
                                                        sprinkles({
                                                            position: "relative",
                                                            width: "full",
                                                            height: "full",
                                                            maxWidth: contentStyles.contentMaxWidth,
                                                        }),
                                                        // Elevated since when comments are open they're rendered in a card design (card
                                                        // background rendered by `CommentInput`).
                                                        greyElevated1ClassName,
                                                    )}
                                                    style={{
                                                        flex: postViewFlex,
                                                    }}
                                                >
                                                    <div
                                                        className={
                                                            postListViewCardBackgroundClassName
                                                        }
                                                    />
                                                </div>
                                                {asideSpacer}
                                                {sideBarRightSpacer}
                                            </div>
                                        </div>
                                    )}
                                </>
                            );
                        },
                    };
                }

                // NOTE(calebmer, 2023-02-10): We render 3 shimmers before the spinner to create
                // some space to scroll and more directly imply to the user that there is more
                // content to be loaded. Sometimes we may only load 1 post and so the three
                // shimmers is a little false but this feels like an acceptable tradeoff.
                case "MoreUnloadedPosts": {
                    const isPreviousItemPostWithCardBackground =
                        !isPostView && routeLayout !== "narrow"
                            ? isPostListPreviousItemPostWithCardBackground(
                                  posts,
                                  index,
                                  isShowingAllContentByPostId,
                              )
                            : false;

                    return {
                        key: "MoreUnloadedPosts",
                        minHeight: platform !== "mobile" ? "36.125rem" : "26.25rem",
                        zIndex: "0",
                        node: (
                            <div
                                className={sprinkles({
                                    display: "flex",
                                    justifyContent: "center",
                                    paddingBottom: "safe-area-inset",
                                })}
                            >
                                {sideBarLeftSpacer}
                                <div
                                    className={sprinkles({
                                        width: "full",
                                        maxWidth: contentStyles.contentMaxWidth,
                                        paddingTop:
                                            withSafeAreaInsetTop && index === 0
                                                ? "safe-area-inset"
                                                : isPreviousItemPostWithCardBackground
                                                  ? postListViewMarginAfterPostWithOpenComments
                                                  : undefined,
                                    })}
                                    style={{
                                        flex: postViewFlex,
                                    }}
                                >
                                    <PostShimmer
                                        withoutTopBorder={isPreviousItemPostWithCardBackground}
                                    />
                                    <PostShimmer withBottomBorder={platform === "mobile"} />
                                    {platform !== "mobile" && (
                                        <PostShimmer withBottomBorder={true} />
                                    )}
                                    <div
                                        className={sprinkles({
                                            position: "relative",
                                            height: "24",
                                            display: "flex",
                                            justifyContent: "center",
                                            alignItems: "center",
                                            color: "grey-60",
                                        })}
                                    >
                                        <SpinnerGap
                                            className={spinAnimationClassName}
                                            size={spacing["6"]}
                                            weight="light"
                                        />
                                    </div>
                                </div>
                                {asideSpacer}
                                {sideBarRightSpacer}
                            </div>
                        ),
                    };
                }

                case "FeedEntry": {
                    const isPreviousItemPostWithCardBackground =
                        routeLayout !== "narrow"
                            ? isPostListPreviousItemPostWithCardBackground(
                                  posts,
                                  index,
                                  isShowingAllContentByPostId,
                              )
                            : false;

                    const content = (
                        <>
                            {topBorder}
                            <FeedEntryView entry={item.entry} />
                        </>
                    );

                    return {
                        key: `FeedEntry:${item.entry.getId()}`,
                        minHeight: feedEntryHeight,
                        node: (
                            <div
                                className={sprinkles({
                                    display: "flex",
                                    justifyContent: "center",
                                })}
                            >
                                {sideBarLeftSpacer}
                                <div
                                    data-testid="FeedEntryView"
                                    className={sprinkles({
                                        position: "relative",
                                        width: "full",
                                        minWidth: "flex-fit",
                                        maxWidth: contentStyles.contentMaxWidth,
                                        paddingTop:
                                            withSafeAreaInsetTop && index === 0
                                                ? "safe-area-inset"
                                                : isPreviousItemPostWithCardBackground
                                                  ? postListViewMarginAfterPostWithOpenComments
                                                  : undefined,
                                    })}
                                    style={{
                                        flex: postViewFlex,
                                    }}
                                >
                                    {content}
                                </div>
                                {asideSpacer}
                                {sideBarRightSpacer}
                            </div>
                        ),
                    };
                }

                case "Footer": {
                    // There's only one footer type right now. TypeScript will error here if another
                    // footer type is ever added.
                    cast<"MarginBottom">(item.footer.type);

                    const marginBottom: Spacing = "8";

                    const isPreviousItemPostWithCardBackground =
                        !isPostView && routeLayout !== "narrow"
                            ? isPostListPreviousItemPostWithCardBackground(
                                  posts,
                                  index,
                                  isShowingAllContentByPostId,
                              )
                            : false;

                    return {
                        key: "Footer",
                        minHeight: spacing[marginBottom],
                        zIndex: "0",
                        node: (
                            <div
                                className={sprinkles({
                                    display: "flex",
                                    justifyContent: "center",
                                    paddingTop:
                                        withSafeAreaInsetTop && index === 0
                                            ? "safe-area-inset"
                                            : isPreviousItemPostWithCardBackground
                                              ? postListViewMarginAfterPostWithOpenComments
                                              : undefined,
                                })}
                            >
                                {sideBarLeftSpacer}
                                <div
                                    className={sprinkles({
                                        position: "relative",
                                        width: "full",
                                        minWidth: "flex-fit",
                                        maxWidth: contentStyles.contentMaxWidth,
                                        height: marginBottom,
                                    })}
                                    style={{flex: postViewFlex}}
                                >
                                    {!isPreviousItemPostWithCardBackground && topBorder}
                                </div>
                                {asideSpacer}
                                {sideBarRightSpacer}
                            </div>
                        ),
                    };
                }

                default:
                    throw exhaustive(item);
            }
        },
        [
            posts,
            hasNavigationBar,
            routeLayout,
            sideBarLeftSpacer,
            asideSpacer,
            sideBarRightSpacer,
            isPostView,
            spacingScale,
            withSafeAreaInsetTop,
            hasHeader,
            topBorder,
            postEditing,
            shouldNotShowChannelId,
            initialScrollForFirstPost,
            jumpToPostRangeState,
            idBase,
            isShowingAllContentByPostId,
            onOptimisticPostRealtimeEvents,
            isPostArchived,
            onArchivePost,
            onUnarchivePost,
            onTogglePostComments,
            loadInitialPostComments,
            messageEditing,
            fileAttachmentTargetByPostId,
            jumpToMessageRangeState,
            jumpToMessageRange,
            jumpToPostRange,
            handleSetMessageReaction,
            handleDeleteMessageReaction,
            hasCommentAccessLevelByChannel,
            onUpdatePostCommentsOptimistically,
            header,
            inputParentByPostId,
            inputRefByPostId,
            shouldBeConnectedToChannelRealtime,
            onPostRealtimeEvents,
            platform,
            onUpdatePostComments,
            navigate,
        ],
    );

    const messagingPointerToolbar = (
        <MessagingViewPointerToolbar<PostId, PostCommentModel>
            viewRef={viewRef}
            messageNoun="comment"
            getMessagesByRoomKey={useCallback(
                (postId: string) => posts.getPostByIdIfExists(postId)?.postComments ?? null,
                [posts],
            )}
            getPostByRoomKey={useCallback(
                (postId: string) => posts.getPostByIdIfExists(postId)?.post ?? null,
                [posts],
            )}
            onReplyToMessagesRange={async (postId, parent) => {
                const postResult = posts.getPostByIdIfExists(postId);
                if (postResult === null) return;

                const {post, postCommentsState, postComments} = postResult;

                // NOTE(calebmer): This code is copied from the code to open comments in
                // `<PostContentView>`. Similarly we check if the initial comments are loaded and
                // if they're not we'll go load them then wait for a bit before opening comments.
                if (postCommentsState === "Closed") {
                    if (routeLayout === "narrow") {
                        // If we're replying via message pointer toolbar in a narrow route with closed
                        // comments then we're in a channel peek which only shows the post content. Never
                        // post comments. So we should only ever see `PostRange` here.
                        assert(parent.type === "PostRange");

                        await navigate(
                            `/s/${space.id}/posts/${postId}?parent=${parent.startPos}-${parent.endPos}@${parent.contentVersion}`,
                        );
                        return;
                    }

                    const initialLoadMessageCount = getInitialLoadMessageCount(getClientInfo());

                    let areAllInitialMessagesLoaded = true;
                    for (
                        let index = 0;
                        index <
                        Math.min(
                            postComments.getMessageCountExcludingOptimisticMessages(),
                            initialLoadMessageCount,
                        );
                        index++
                    ) {
                        if (postComments.getItem(index).type !== "Loaded") {
                            areAllInitialMessagesLoaded = false;
                            break;
                        }
                    }

                    // Open comments immediately if:
                    //
                    // 1. There are more comments then our initial load request would fetch; AND
                    // 2. All of those comments are loaded.
                    //
                    // We want to load comments again when we have less than the initial load count
                    // because maybe some users added comments while the comment section was closed?
                    const shouldOpenCommentsImmediately =
                        postComments.getMessageCountExcludingOptimisticMessages() >=
                            initialLoadMessageCount && areAllInitialMessagesLoaded;

                    if (!shouldOpenCommentsImmediately) {
                        const postCommentsPromise = loadInitialPostComments({post, postComments});

                        // Open post comments once we get our data back. But if the data is taking a long
                        // time to load, open post comments after a delay.
                        await Promise.race([
                            postCommentsPromise,
                            wait(delayLoadingIndicatorLimitMs),
                        ]);
                    }

                    onTogglePostComments(postId);
                }

                setInputParentByPostId(inputParentByPostId => {
                    const newInputParentByPostId = new Map(inputParentByPostId);
                    newInputParentByPostId.set(postId, parent);
                    return newInputParentByPostId;
                });
            }}
            onSetMessageReaction={handleSetMessageReaction}
            onDeleteMessageReaction={handleDeleteMessageReaction}
            onUpdateMessagesOptimistically={onUpdatePostCommentsOptimistically}
        />
    );

    return (
        <>
            {messageEditingModals}
            {postEditingModals}
            {platform === "mobile" && postEditing.state.isEditing && (
                <MobileFullScreenModal
                    onClose={() => postEditing.dispatch({type: "CancelEditing"})}
                >
                    {({onCloseWithAnimation}) => {
                        assert(postEditing.state.isEditing);

                        return (
                            <PostMobileEditor
                                post={
                                    posts.getPostByIdIfExists(postEditing.state.postId)?.post ??
                                    null
                                }
                                contentEditorState={postEditing.state.contentEditorState}
                                onContentEditorStateChange={(contentEditorState, transaction) =>
                                    postEditing.dispatch({
                                        type: "ContentEditorStateChange",
                                        contentEditorState,
                                        transaction,
                                    })
                                }
                                initialContent={postEditing.state.initialContent}
                                onCloseWithAnimation={onCloseWithAnimation}
                                onSave={async () => {
                                    const savePromiseResolver = createPromiseResolver();

                                    postEditing.dispatch({
                                        type: "SaveEditedContent",
                                        savePromiseResolver,
                                        // We want to cancel editing ourselves after the close animation completes from
                                        // calling `onCloseWithAnimation`.
                                        dontCancelEditing: true,
                                    });

                                    await savePromiseResolver.promise;

                                    onCloseWithAnimation();
                                }}
                            />
                        );
                    }}
                </MobileFullScreenModal>
            )}
            <div
                data-testid="PostListView"
                ref={viewContainerRef}
                className={sprinkles({
                    flexGrow: "1",
                    width: "full",
                    height: "full",
                    overflow: "hidden",
                    position: "relative",
                    zIndex: "0",
                    display: "flex",
                    flexDirection: "column",
                })}
            >
                {withSafeAreaInsetTop && !navigationBar?.navigationBar && (
                    // Only render a safe area cover if we don't have a navigation bar. Otherwise the
                    // navigation bar acts as our safe area cover.
                    <div
                        className={sprinkles({
                            position: "absolute",
                            top: "0",
                            left: "0",
                            right: "0",
                            zIndex: "10",
                            backgroundColor: "grey-0",
                        })}
                        style={{
                            // Subtract 1px from `safe-area-inset-top` to account for the thick (2px) top
                            // border on posts.
                            height: `calc(var(--safe-area-inset-top, 0px) - 1px)`,
                        }}
                    />
                )}
                <ContentBlockWidthContextProvider width={contentBlockAvailableWidth}>
                    <VirtualizedScrollView
                        ref={viewRef}
                        elementRef={navigationBar?.scrollViewRef}
                        data-testid="PostListScrollView"
                        scrollbarInsetTop={
                            navigationBar?.scrollbarInsetTop ??
                            (withSafeAreaInsetTop ? safeAreaOnlyScrollbarInsetTop : undefined)
                        }
                        bufferedItemHeight={postContentViewMinHeightPx[spacingScale]}
                        itemCount={itemCount}
                        renderItem={renderItem}
                        // Always render the post content if we're in a single post with pinned comment
                        // input layout.
                        alwaysRenderAdditionalItemIndexes={useMemo(
                            () => (isPostView ? [0] : []),
                            [isPostView],
                        )}
                        onRenderedRangeChange={tryLoadingMoreData}
                        onScroll={handleScroll}
                        // Make sure content height is an integer. This guarantees we properly position our
                        // aside given scroll offset is always an integer. We see some rendering bugs in
                        // Chrome if content height isn't rounded. For example:
                        //
                        // https://alpine.inc/s/c2pwxmpv3z7b3db19tsn6y1qfg/tasks/xdcahs0wp7zwv27gbj4tt11dq8
                        withRoundedContentHeight={true}
                        // If the aside is larger than our virtualized list's content then we need to make
                        // sure the `<VirtualizedScrollView>`s DOM includes the aside's height in some
                        // measurements. Otherwise the navigation bar among other things start to break
                        // down.
                        extraChildrenContentHeight={asideSize?.height ?? 0}
                        extraChildren={
                            <>
                                {navigationBar?.navigationBar}
                                {hasAside && (
                                    <>
                                        <div
                                            style={{
                                                height: scrollDirectionState.asideBufferedHeight,
                                            }}
                                        />
                                        <div
                                            className={sprinkles({
                                                width: "full",
                                                zIndex: "30",
                                                pointerEvents: "none",
                                                display: "flex",
                                                justifyContent: "center",
                                            })}
                                            style={{
                                                position: "sticky",
                                                ...(scrollDirectionState.scrollDirection === "Down"
                                                    ? {
                                                          top:
                                                              viewSize && asideSize
                                                                  ? viewSize.height -
                                                                    asideSize.height
                                                                  : 0,
                                                      }
                                                    : {
                                                          bottom:
                                                              viewSize && asideSize
                                                                  ? viewSize.height -
                                                                    asideSize.height
                                                                  : 0,
                                                      }),
                                                left: 0,
                                                right: 0,
                                            }}
                                        >
                                            <div
                                                className={sprinkles({
                                                    width: "full",
                                                    maxWidth: contentStyles.contentMaxWidth,
                                                    overflow: "hidden",
                                                })}
                                                style={{
                                                    flex: postViewFlex,
                                                }}
                                            />
                                            <div
                                                className={sprinkles({
                                                    width: "full",
                                                    maxWidth: postListViewAsideMaxWidth,
                                                })}
                                                style={{
                                                    flex: postListViewAsideFlex,
                                                }}
                                            >
                                                <aside
                                                    ref={asideRef}
                                                    className={sprinkles({
                                                        pointerEvents: "auto",
                                                        paddingTop: navigationBarHeight,
                                                    })}
                                                    style={{
                                                        minHeight: viewSize ? viewSize.height : 0,
                                                    }}
                                                >
                                                    {aside}
                                                </aside>
                                            </div>
                                        </div>
                                    </>
                                )}
                                {extraChildren}
                                {messagingPointerToolbar}
                            </>
                        }
                    />
                    {isPostView &&
                        (() => {
                            const lastPostContentItem = assertExists(
                                posts.getPostContentItemIfExists(header ? 1 : 0),
                            );

                            const inputParent =
                                inputParentByPostId.get(lastPostContentItem.post.id) ?? null;

                            return (
                                <PostCommentInput
                                    isStickyPositioned={false}
                                    inputRef={inputRefByPostId.get(lastPostContentItem.post.id)}
                                    header={header}
                                    post={lastPostContentItem.post}
                                    viewRef={viewRef}
                                    proceduresRef={procedures => {
                                        if (procedures) {
                                            proceduresByPostIdRef.current.set(
                                                lastPostContentItem.post.id,
                                                procedures,
                                            );
                                        } else {
                                            proceduresByPostIdRef.current.delete(
                                                lastPostContentItem.post.id,
                                            );
                                        }
                                    }}
                                    postCommentEditing={messageEditing}
                                    postComments={lastPostContentItem.postComments}
                                    fileAttachmentTarget={fileAttachmentTargetByPostId.get(
                                        lastPostContentItem.post.id,
                                    )}
                                    onUpdatePostComments={update =>
                                        onUpdatePostComments(lastPostContentItem.post.id, update)
                                    }
                                    parent={inputParent}
                                    onParentClear={() => {
                                        setInputParentByPostId(inputParentByPostId => {
                                            const newInputParentByPostId = new Map(
                                                inputParentByPostId,
                                            );
                                            newInputParentByPostId.delete(
                                                lastPostContentItem.post.id,
                                            );
                                            return newInputParentByPostId;
                                        });
                                    }}
                                    onJumpToPostCommentRange={jumpToMessageRange}
                                    onJumpToPostRange={jumpToPostRange}
                                    onDeletePostComment={async postCommentIndex => {
                                        const procedures = proceduresByPostIdRef.current.get(
                                            lastPostContentItem.post.id,
                                        );
                                        if (!procedures)
                                            throw new InternalError(
                                                "Post comment input isn\u2019t mounted",
                                            );

                                        await procedures.deleteComment({
                                            commentIndex: postCommentIndex,
                                        });
                                    }}
                                    shouldBeConnectedToChannelRealtime={
                                        shouldBeConnectedToChannelRealtime
                                    }
                                    onPostRealtimeEvents={onPostRealtimeEvents}
                                />
                            );
                        })()}
                </ContentBlockWidthContextProvider>
            </div>
        </>
    );
}

function isPostListPreviousItemPostWithCardBackground(
    posts: PostListInterface,
    index: number,
    isShowingAllContentByPostId: ReadonlyMap<PostId, true>,
): boolean {
    if (!(index > 0)) return false;

    const previousItem = posts.getItem(index - 1);

    switch (previousItem.type) {
        case "Header":
        case "Footer":
        case "MoreUnloadedPosts":
        case "FeedEntry": {
            return false;
        }
        case "PostContent": {
            return (
                previousItem.postCommentsState !== "Closed" ||
                isShowingAllContentByPostId.get(previousItem.post.id) === true
            );
        }
        case "LoadedPostComment":
        case "UnloadedPostComment":
        case "OptimisticPostComment":
        case "PostCommentsTypingIndicator":
        case "PostCommentInput": {
            return true;
        }
        default:
            throw exhaustive(previousItem);
    }
}
