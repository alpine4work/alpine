import classNames from "classnames";
import {SpinnerGap} from "phosphor-react";
import {
    Memo,
    MutableRefObject,
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
import {MessageInputRef} from "~/client/content/messaging/message_input_base.js";
import {useMessagingViewDropTarget} from "~/client/content/messaging/use_messaging_view_drop_target.js";
import {useAppContext} from "~/client/context/app_context.js";
import {MobileFullScreenModal} from "~/client/design/mobile_full_screen_modal.js";
import {
    flushNavigationBarScrollEventEmitter,
    navigationBarHeight,
} from "~/client/design/navigation_bar_helpers.js";
import {safeAreaOnlyScrollbarInsetTop} from "~/client/design/scrollbar.js";
import {Spacer} from "~/client/design/spacer.js";
import {useScrollToAvoidBottomBarsAndMobileKeyboard} from "~/client/design/use_scroll_to_avoid_bottom_bars_and_mobile_keyboard.js";
import {ChannelViewHeader} from "~/client/forum/internal/channel_view_header.js";
import {
    PostCommentInput,
    PostRealtimeProcedures,
} from "~/client/forum/internal/post_comment_input.js";
import {usePostEditing} from "~/client/forum/internal/post_editing.js";
import {PostMobileEditor} from "~/client/forum/internal/post_mobile_editor.js";
import {resolveFlexSizes} from "~/client/forum/internal/resolve_flex_sizes.js";
import {PostContentView, PostContentViewInitialScroll} from "~/client/forum/post_content_view.js";
import {
    PostListHeader,
    PostListInterface,
    PostListPostContentItem,
    PostListWithHeader,
} from "~/client/forum/post_list.js";
import {useConstant} from "~/client/helpers/lifecycle/use_constant.js";
import {useEvent} from "~/client/helpers/lifecycle/use_event.js";
import {useLayoutEffectWithoutServerSideWarning} from "~/client/helpers/lifecycle/use_layout_effect_without_server_side_warning.js";
import {useErrorState} from "~/client/helpers/use_error_state.js";
import {useResizeObserver} from "~/client/helpers/use_resize_observer.js";
import {getInitialLoadMessageCount} from "~/client/messaging/get_initial_load_message_count.js";
import {useMessageEditing} from "~/client/messaging/message_editing.js";
import {MessageList} from "~/client/messaging/message_list.js";
import {MessageListMessageShimmer} from "~/client/messaging/message_list_message_shimmer.js";
import {MessageView} from "~/client/messaging/message_view.js";
import {MessagingTypingIndicators} from "~/client/messaging/messaging_typing_indicators.js";
import {tryLoadingMessages} from "~/client/messaging/try_loading_messages.js";
import {NavigationBarResult} from "~/client/navigation/navigation_bar_types.js";
import {getClientInfo} from "~/client/remix/client_info_context.js";
import {usePlatform} from "~/client/remix/platform_context.js";
import {useRouteLayout} from "~/client/remix/route_layout_context.js";
import {
    getSpacingScaleWithoutListening,
    useSpacingScale,
} from "~/client/remix/spacing_scale_context.js";
import {PostShimmer} from "~/client/shimmer/post_shimmer.js";
import {
    postContentViewMinHeightPx,
    postListViewAsideFlex,
    postListViewAsideMaxWidth,
    postViewFlex,
    postViewMinHeightPx,
} from "~/client/styles/forum_shared_styles.js";
import {
    messageInputMinHeightPx,
    messageViewMinHeightPx,
    messagingTypingIndicatorsMinHeightPx,
    messagingViewMarginBottom,
} from "~/client/styles/messaging_shared_styles.js";
import {
    colorSchemeVars,
    contentStyles,
    forumStyles,
    spinAnimationClassName,
    sprinkles,
} from "~/client/styles/styles.js";
import {renderVirtualizedScrollViewItemWithExpensiveFeaturesDisabledDuringScroll} from "~/client/virtualized/helpers/render_virtualized_scroll_view_item_with_expensive_features_disabled_during_scroll.js";
import {
    VirtualizedScrollView,
    VirtualizedScrollViewRef,
    VirtualizedScrollViewRenderItem,
} from "~/client/virtualized/virtualized_scroll_view.js";
import {
    Spacing,
    convertRemLengthToPx,
    screenPaddingX,
    spacing,
} from "~/shared/design/core/spacing.js";
import {delayLoadingIndicatorLimitMs} from "~/shared/design/core/timing.js";
import {DynamoGeneralRealtimeEvent} from "~/shared/dynamo/dynamo_general_realtime_types.js";
import {InternalError, UnimplementedError} from "~/shared/error/error.js";
import {FileAttachmentTarget} from "~/shared/files/file_attachment_target.js";
import {PostContentWithReferences} from "~/shared/forum/post_content_schema.js";
import {PostCommentModel, PostModel} from "~/shared/forum/post_model.js";
import {wait} from "~/shared/helpers/async/wait.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.js";
import {LazyMap} from "~/shared/helpers/control/lazy_map.js";
import {areRangesOverlapping} from "~/shared/helpers/geometry/are_ranges_overlapping.js";
import {clamp} from "~/shared/helpers/number/clamp.js";
import {PostId} from "~/shared/id/types/id_types.js";
import {
    getPostCommentsFromEnd,
    getPostCommentsFromStart,
    updatePostContent,
} from "~/shared/rpc/forum_rpc_definitions.js";

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

const PostListViewForwardRef = forwardRef(PostListView);
export {PostListViewForwardRef as PostListView};

export type PostListViewRef = {
    /**
     * Jump to the provided post comment. If the post or post comment do
     * not exist an error will be thrown.
     */
    jumpToPostCommentIndex(postId: PostId, postCommentIndex: number): void;

    /**
     * Start editing the post with the provided `PostId`.
     */
    startEditingPost(postId: PostId, currentContent: PostContentWithReferences): void;
};

/**
 * Renders a virtualized list of posts which can expand their comments inline.
 *
 * This component handles all rendering for a post unit. Including rendering an
 * individual post on a post route. Since even when rendering an individual
 * post you still need to virtualize the list of comments. This means there is
 * some confusing overloading because features like `header` and `aside`
 * which are important in the context of a channel are not important in the
 * context of rendering a single post.
 */
function PostListView(
    {
        header,
        posts: postsWithoutHeader,
        onTogglePostComments,
        onUpdatePostComments,
        onLoadMorePosts,
        shouldBeConnectedToChannelRealtime,
        onPostRealtimeEventTransaction,
        availableWidth,
        aside,
        sideBarLeftSize,
        sideBarRightSize,
        extraChildren,
        navigationBar,
        withSafeAreaInsetTop = false,
        initialScrollForFirstPost,
    }: {
        /**
         * If this post list is rendering a channel, you may provide this prop and we
         * will render an area at the top of the list describing the channel.
         */
        header?: Memo<PostListHeader>;

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
         * we'll connect to realtime for that post. As realtime updates come in, we'll
         * call this function with any updates to the post's comments.
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
         * If the post list has more posts then this function should load those posts.
         * This function is required if you initialize the component with many posts
         * and set `hasMorePosts` to true. Not providing it will throw an error when
         * the user reaches the end of the list.
         */
        onLoadMorePosts?: (options: {
            limit: number;
            afterCursor?: {createdTime: Date; postId: PostId};
        }) => Promise<void>;

        /**
         * If true, our parent component is telling us it has connected to
         * `ChannelRealtimeService` and will be updating `posts` when realtime events
         * come in. It means we don't need to handle realtime events for posts in
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
         * - To update our post data with events we've received from
         *   `PostRealtimeService` (which we connect to in `<PostCommentInput>`) when
         *   `shouldBeConnectedToChannelRealtime` is false. If
         *   `shouldBeConnectedToChannelRealtime` is true then we should be getting
         *   realtime updates from `ChannelRealtimeService`.
         */
        onPostRealtimeEventTransaction: Memo<
            (event: {
                readTime: Date;
                eventTransaction: ReadonlyArray<DynamoGeneralRealtimeEvent<PostModel>>;
            }) => void
        >;

        /**
         * The width available to our `<PostListView>` component. If set then we'll
         * pass `availableWidth` props down to our child components like
         * `<PostContentView>` and `<MessageView>`. If undefined then we don't pass
         * down the prop.
         *
         * Knowing the available width is important when rendering some content nodes.
         * Particularly tables, files, and file entities. Since their layout adjusts
         * based on the available space. By default these components use
         * `clientInfo.screenWidth` as the available width.
         *
         * Pass in the width available to `<PostListView>`. We'll subtract width used
         * by any sidebars defined by `sideBarLeftSize` and `sideBarRightSize` when
         * figuring out the available width for any child components.
         */
        availableWidth?: number;

        /**
         * An element we render to the side of the post list but still within the
         * scroll view. The aside is sticky so it will always be visible as you
         * scroll.
         *
         * If the aside's height is larger than the window then we you scroll down the
         * aside will scroll down. Once you reach the bottom of the aside it will stop
         * scrolling and stick to the bottom. Then when you scroll back up the aside
         * will scroll up until you reach the aside's top, then it will stick again.
         *
         * This deep integration with the positioning of posts and the scroll view is
         * why it needs to be a prop on this element.
         *
         * On mobile the aside will not be rendered.
         */
        // TODO(calebmer): Could we get rid of the `aside` prop and use
        // `sideBarRightSize` instead? I think if we add scroll event functions then
        // it's doable.
        aside?: ReactNode;

        /**
         * Space allocated for a sidebar rendered to the left of the post list. Doesn't
         * actually render a sidebar, you have to render the sidebar yourself. Probably
         * using the `extraChildren` prop.
         */
        sideBarLeftSize?: Memo<{maxWidth: Spacing; flex: number}>;

        /**
         * Space allocated for a sidebar rendered to the right of the post list. Doesn't
         * actually render a sidebar, you have to render the sidebar yourself. Probably
         * using the `extraChildren` prop.
         */
        sideBarRightSize?: Memo<{maxWidth: Spacing; flex: number}>;

        /**
         * Extra children to be rendered in our post list's `<VirtualizedScrollView>`.
         * Passed into the `<VirtualizedScrollView>`'s `extraChildren` prop.
         */
        extraChildren?: ReactNode;

        /**
         * If you want to include a navigation bar in this list view you may pass in
         * the result of `useNavigationBar()` here and the virtualized scroll view will
         * be properly configured.
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
    },
    ref: Ref<PostListViewRef>,
) {
    const context = useAppContext();
    const platform = usePlatform();
    const spacingScale = useSpacingScale();
    const routeLayout = useRouteLayout();

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

    const posts = useMemo(
        () => (header ? new PostListWithHeader(header, postsWithoutHeader) : postsWithoutHeader),
        [header, postsWithoutHeader],
    );

    const hasAside = routeLayout !== "narrow" && !!aside;
    const hasNavigationBar = !!navigationBar?.navigationBar;
    const hasHeader = !!header;

    const shouldNotShowChannelId = header
        ? header.type === "NavigationBar"
            ? header.shouldNotShowChannelId ?? null
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

    // On mobile, the comment button doesn't expand/collapse. Instead it opens the
    // post in a new route. Because:
    //
    // - It's a challenging UI problem to have a sticky comment input while also
    //   avoiding the keyboard and tab bar.
    // - Because there's less space on mobile, it may be harder to mentally stay
    //   aware of the fact that you're looking at a comment section in the middle
    //   of a feed of posts. Opening in a new route with a post-specific header
    //   lets the user stay focused.
    if (platform === "mobile" && !isPostView) {
        assert(!posts.hasOpenPostComments(), "Posts can't have open comments on mobile");
    }

    const availablePostWidth = useMemo(() => {
        if (availableWidth === undefined) return undefined;

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

        const resolvedSizes = resolveFlexSizes(availableWidth, sizes);

        return assertExists(sideBarLeftSize ? resolvedSizes[1] : resolvedSizes[0]);
    }, [availableWidth, hasAside, sideBarLeftSize, sideBarRightSize, spacingScale]);

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

                    // We are rendering the post but we are not rendering any of the posts
                    // comments. Don't load anything new.
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
                            const {commentCount, comments, otherReferencedComments} =
                                await getPostCommentsFromStart(context, {
                                    postId: item.post.id,
                                    afterCommentIndex: afterMessageIndex,
                                    beforeCommentIndex: beforeMessageIndex,
                                    limit,
                                });
                            return {
                                messageCount: commentCount,
                                messages: comments,
                                otherReferencedMessages: otherReferencedComments,
                            };
                        },
                        loadFromEnd: async ({afterMessageIndex, beforeMessageIndex, limit}) => {
                            const {commentCount, comments, otherReferencedComments} =
                                await getPostCommentsFromEnd(context, {
                                    postId: item.post.id,
                                    afterCommentIndex: afterMessageIndex,
                                    beforeCommentIndex: beforeMessageIndex,
                                    limit,
                                });
                            return {
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
                                    postComments.loadMessages(result),
                                );
                            }),
                        };
                    }
                }

                // If we are not loading any comments and the unloaded posts item is rendered,
                // try loading that...
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

                            // The limit of items we will load is two views worth of posts. This gives
                            // the user some space to scroll and read before we need to load more posts.
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

    // Whenever our list data changes, try loading more comments. In case our
    // rendered range stayed the same but we see some some unloaded comments.
    //
    // This effect should also fire when `tryLoadingMorePostComments()` completes
    // in case it didn't fully load the list.
    useEffect(() => {
        // eslint-disable-next-line @typescript-eslint/no-unused-expressions
        posts;

        const view = assertExists(viewRef.current);
        tryLoadingMoreData(view.getRenderedRange());
    }, [posts, tryLoadingMoreData]);

    const loadInitialPostComments = useEvent(
        async (item: PostListPostContentItem): Promise<void> => {
            // If we're already loading, don't try to load more comments.
            if (isLoadingRef.current) return;
            isLoadingRef.current = true;

            try {
                const limit = getInitialLoadMessageCount(getClientInfo());

                // If we already have some loaded messages then we are trying to finish the
                // initial loaded message list by starting at our last loaded message.
                const lastLoadedMessage =
                    item.postComments.getLastLoadedMessageBeforeIfExists(limit);

                if (lastLoadedMessage === null || lastLoadedMessage.index < limit - 1) {
                    const {commentCount, comments, otherReferencedComments} =
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
                        postComments.loadMessages({
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
    // `<PostCommentInput>` component is always mounted when the post's comments
    // are open. Since we need realtime actions in every part of the post we have
    // `<PostCommentInput>` stash the method to send them in this ref so they can
    // be called elsewhere.
    const proceduresByPostIdRef = useRef(new Map<PostId, PostRealtimeProcedures>());

    // Manages the current post being edited.
    //
    // At the post list level for the same reasons message editing is at the post
    // list level.
    const {postEditing, modals: postEditingModals} = usePostEditing({
        onUpdatePostContent: async ({postId, content}) => {
            const event = await updatePostContent(context, {
                postId,
                content,
            });

            onPostRealtimeEventTransaction(event);
        },
    });

    // Manages the editable message.
    //
    // This is at the post list level because:
    //
    // 1. If a message is scrolled out of the virtualization window we still want
    //    it to be editable so it shouldn't lose state.
    //
    // 2. We want only one message to be editable at a time.
    const {messageEditing, modals: messageEditingModals} = useMessageEditing<PostId>({
        messageNoun: "comment",
        onUpdateMessageContent: async ({roomKey, messageIndex, content}) => {
            const procedures = proceduresByPostIdRef.current.get(roomKey);
            if (!procedures) throw new InternalError("Post comment input isn't mounted");

            await procedures.updateCommentContent({
                commentIndex: messageIndex,
                content,
            });
        },
        onDeleteMessage: async ({roomKey, messageIndex}) => {
            const procedures = proceduresByPostIdRef.current.get(roomKey);
            if (!procedures) throw new InternalError("Post comment input isn't mounted");

            await procedures.deleteComment({
                commentIndex: messageIndex,
            });
        },
    });

    // Manages which comment `<PostCommentInput>` is currently replying to.
    const [replyingToPostCommentIndexByPostId, setReplyingToPostCommentIndexByPostId] = useState<
        ReadonlyMap<PostId, number>
    >(new Map());

    // A comment to highlight for the user. We currently highlight comments with a
    // little wiggle animation (see `wiggle_animation.css.ts` for more information).
    // We highlight comments when initially loading a page with a comment index in
    // the URL and when the user clicks on a reply preview to jump to it.
    const [highlightPostComment, setHighlightPostComment] = useState<{
        postId: PostId;
        postCommentIndex: number;
        shouldHighlightRef: MutableRefObject<boolean>;
    } | null>(null);

    const isJumpingToPostCommentRef = useRef(false);

    // Jumping to a post comment entails:
    //
    // 1. We scroll to the comment
    // 2. We highlight the comment to the user
    const jumpToPostCommentIndex = useEvent((postId: PostId, postCommentIndex: number) => {
        // If we are in the process of jumping, don't start another jump
        if (isJumpingToPostCommentRef.current) return;

        const view = assertExists(viewRef.current);

        const scrollToIndex = assertExists(posts.getPostByIdIfExists(postId)).getPostCommentIndex(
            postCommentIndex,
        );

        const peekRenderedRange = view.peekRenderedRangeAfterScrollToIndex(scrollToIndex);
        const result = tryLoadingMoreData(peekRenderedRange);

        if (!result.isLoading) {
            view.scrollToIndex(scrollToIndex, {withAnchor: true});

            setHighlightPostComment({
                postId,
                postCommentIndex,
                shouldHighlightRef: {current: true},
            });
        } else {
            isJumpingToPostCommentRef.current = true;

            void Promise.race([result.promise, wait(delayLoadingIndicatorLimitMs)]).finally(() => {
                isJumpingToPostCommentRef.current = false;

                view.scrollToIndex(scrollToIndex, {withAnchor: true});

                setHighlightPostComment({
                    postId,
                    postCommentIndex,
                    shouldHighlightRef: {current: true},
                });
            });
        }
    });

    const handleJumpToPostComment = useCallback(
        (postComment: PostCommentModel) => {
            jumpToPostCommentIndex(postComment.postId, postComment.index);
        },
        [jumpToPostCommentIndex],
    );

    const postEditingDispatch = postEditing.dispatch;

    useImperativeHandle(
        ref,
        () => ({
            jumpToPostCommentIndex,
            startEditingPost: (postId, currentContent) => {
                postEditingDispatch({
                    type: "StartEditing",
                    postId,
                    currentContent,
                    platform,
                });
            },
        }),
        [jumpToPostCommentIndex, platform, postEditingDispatch],
    );

    // Make sure the bottom of the scroll view stays visible when the keyboard
    // opens and closes.
    //
    // Unless we are replying to a message or editing a message. Then we should
    // anchor to the message in question. Similar code also exists in
    // `post_list_view.tsx` and `document_comment_thread_list_view.tsx`. If we
    // update the code here we also probably need to update there.
    useScrollToAvoidBottomBarsAndMobileKeyboard(viewRef, {
        isPinned: true,
        getAnchorPosition: useEvent(oldVisibleRect => {
            // NOTE(calebmer, 2024-07-16): We used to anchor chat view scroll to the
            // message the user was replying to or editing. However, in practice this felt
            // janky to me. Scrolling wasn't predictable when swiping to reply to a
            // message! I think consistency is likely the better user experience here.
            //
            // To look at the old message anchoring code, git blame this comment to see the
            // commit where I remove it.

            return {top: oldVisibleRect.bottom, height: 0};
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
    // `navigation_bar.tsx` does. We use a similar `position: sticky` pattern
    // that flips depending on the scroll direction. So if the scroll direction is
    // changing synchronously it's good to know so we can handle that.
    useEffect(() => {
        return flushNavigationBarScrollEventEmitter.subscribe(element => {
            const view = assertExists(viewRef.current);
            if (element !== view.getElement()) return;
            handleScroll(view.getScrollOffset());
        });
    }, [handleScroll]);

    // NOTE(calebmer): This is a bit of a paranoid protection. Whenever the number
    // of items in our view changes (especially when the number of items decreases)
    // make sure `asideBufferedHeight` is clamped to the correct range. We've
    // observed a bug where when collapsing the last post in a post list view, the
    // post list view is still scrollable and that's because the aside buffered
    // height has not been reset! This fixes that bug and makes sense in theory.
    //
    // It's a little hacky doing this in an effect that listens to `itemCount`
    // changes. It would be a little cleaner if we had a resize callback for
    // content height or height changes.
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
                    } satisfies FileAttachmentTarget as Memo<FileAttachmentTarget>),
            ),
        [],
    );

    const inputRefByPostId = useConstant(
        () =>
            new LazyMap<PostId, RefObject<MessageInputRef>>(() => ({
                current: null,
            })),
    );

    const {dragOverlay, dropTargetProps} = useMessagingViewDropTarget({
        isDisabled:
            postEditing.state.isEditing ||
            messageEditing.state.isEditing ||
            // Comments aren't expandable on mobile (unless we're in a post view) so don't
            // allow file dropping.
            (platform === "mobile" && !isPostView),
        onDrop: event => {
            const view = assertExists(viewRef.current);
            const renderedRange = view.getRenderedRange();
            if (!renderedRange) return null;

            const offset =
                event.clientY -
                view.getElement().getBoundingClientRect().top +
                view.getScrollOffset();

            // Find the item that contains `offset`. Written so that if `offset` is above
            // the virtualized scroll view we'll return the first index and if it's below
            // the virtualized scroll view we'll return the last index.
            let aboveIndex: number | null = null;
            for (let index = renderedRange.startIndex; index <= renderedRange.endIndex; index++) {
                const position = view.getPositionByIndex(index);
                aboveIndex = index;
                if (offset < position.offset + position.height) break;
            }

            if (aboveIndex === null) return null;

            let item = posts.getItem(aboveIndex);

            while (
                item.type === "Header" ||
                item.type === "MoreUnloadedPosts" ||
                item.type === "FeedEntry"
            ) {
                aboveIndex++;
                if (aboveIndex < posts.getItemCount()) {
                    item = posts.getItem(aboveIndex);
                    continue;
                }
                return null;
            }

            const postId = item.post.id;

            // Allow the input ref for this `postId` to be null. Which will happen if the
            // post's comments are closed.
            //
            // TODO(calebmer): Admittedly it's not great UI design that we show the
            // fullscreen drop indicator when the user drags an image into a channel we
            // show the "upload" drop target then do nothing if the post they're dropping
            // on is closed. We should figure out a better UI design here. We can either
            // open the post's comments on drop or create a new post with the file on drop.
            // We should also consider just showing a drop overlay on top of the post
            // instead of the fullscreen which might confuse the user.
            const input = inputRefByPostId.get(postId).current;
            if (!input) return null;

            return input.drop(event.dataTransfer);
        },
    });

    const idBase = useId();

    const sideBarLeftSpacer = useMemo(() => {
        if (!sideBarLeftSize) return null;

        return (
            <div
                className={sprinkles({
                    width: "full",
                    maxWidth: sideBarLeftSize.maxWidth,
                })}
                style={{flex: sideBarLeftSize.flex}}
            />
        );
    }, [sideBarLeftSize]);

    const sideBarRightSpacer = useMemo(() => {
        if (!sideBarRightSize) return null;

        return (
            <div
                className={sprinkles({
                    width: "full",
                    maxWidth: sideBarRightSize.maxWidth,
                })}
                style={{flex: sideBarRightSize.flex}}
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

    const renderItem: VirtualizedScrollViewRenderItem = useCallback(
        index => {
            const item = posts.getItem(index);

            switch (item.type) {
                case "Header": {
                    return {
                        key: "Header",
                        minHeight: hasNavigationBar ? spacing[navigationBarHeight] : "0rem",
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
                                    ) : null}
                                </div>
                                {asideSpacer}
                                {sideBarRightSpacer}
                            </div>
                        ),
                    };
                }
                case "PostContent": {
                    return {
                        key: `PostContent:${item.post.id}`,
                        minHeight: isPostView
                            ? postViewMinHeightPx[spacingScale]
                            : postContentViewMinHeightPx[spacingScale],
                        node: (
                            <div
                                className={sprinkles({
                                    display: "flex",
                                    justifyContent: "center",
                                    paddingTop:
                                        withSafeAreaInsetTop && index === 0
                                            ? "safe-area-inset"
                                            : undefined,
                                    paddingBottom:
                                        index === posts.getItemCount() - (isPostView ? 2 : 1)
                                            ? "safe-area-inset"
                                            : undefined,
                                })}
                            >
                                {sideBarLeftSpacer}
                                <div
                                    className={sprinkles({
                                        position: "relative",
                                        width: "full",
                                        maxWidth: contentStyles.contentMaxWidth,
                                    })}
                                    style={{
                                        flex: postViewFlex,
                                        // Don't allow item to grow beyond flexbox bounds. By default flexbox items
                                        // have `min-width: auto` which extends with content.
                                        // https://stackoverflow.com/a/66689926/1568890
                                        minWidth: 0,
                                    }}
                                >
                                    {hasHeader && index === 1 && (
                                        // This is the first post in a `<PostListView>` with a `header` so we
                                        // need to draw a border between the first `<PostListView>` and the
                                        // `header`.
                                        <div
                                            className={sprinkles({
                                                position: "absolute",
                                                left: "0",
                                                right: "0",
                                                top: "0",
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
                                    <div
                                        className={sprinkles({
                                            position: "absolute",
                                            left: "0",
                                            right: "0",
                                            bottom: "0",
                                            height: "border",
                                            paddingX: screenPaddingX,
                                        })}
                                    >
                                        <div
                                            className={classNames(
                                                sprinkles({
                                                    height: "full",
                                                    width: "full",
                                                    backgroundColor: "grey-5",
                                                }),
                                                item.postCommentsState !== "Closed" &&
                                                    !isPostView &&
                                                    forumStyles.dashedBorderClassName,
                                            )}
                                        />
                                    </div>
                                    <PostContentView
                                        post={item.post}
                                        postComments={item.postComments}
                                        postCommentsState={item.postCommentsState}
                                        postEditing={postEditing}
                                        // If we are rendering in the context of a channel, don't render the channel
                                        // in posts.
                                        shouldShowChannel={
                                            shouldNotShowChannelId !== item.post.channel.id
                                        }
                                        isPostView={isPostView}
                                        availableWidth={availablePostWidth}
                                        initialScroll={
                                            index === 0 || (hasHeader && index === 1)
                                                ? initialScrollForFirstPost ?? null
                                                : null
                                        }
                                        idBase={idBase}
                                        onTogglePostComments={() =>
                                            onTogglePostComments(item.post.id)
                                        }
                                        onLoadInitialPostComments={() =>
                                            loadInitialPostComments(item)
                                        }
                                        onScrollToIfNotVisible={() => {
                                            assertExists(viewRef.current).scrollToKeyIfExists(
                                                `PostContent:${item.post.id}`,
                                                {withAnchor: true},
                                            );
                                        }}
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
                                ? "10"
                                : "0",
                        renderAdditionalItemIndexes: !isPostView
                            ? [item.postCommentInputItemIndex]
                            : [],
                        withManualLayout: true,
                        render: renderVirtualizedScrollViewItemWithExpensiveFeaturesDisabledDuringScroll(
                            disableExpensiveFeaturesDuringScroll => {
                                const messageNode =
                                    item.type === "LoadedPostComment" ||
                                    item.type === "OptimisticPostComment" ? (
                                        <MessageView
                                            messageNoun="comment"
                                            message={item.postComment}
                                            fileAttachmentTarget={fileAttachmentTargetByPostId.get(
                                                item.post.id,
                                            )}
                                            isFirstMessage={item.postCommentIndex === 0}
                                            isLastMessage={isLastComment}
                                            previousMessage={previousComment}
                                            nextMessage={nextComment}
                                            messages={item.postComments}
                                            messageEditing={messageEditing}
                                            shouldHighlightRef={
                                                highlightPostComment?.postId === item.post.id &&
                                                highlightPostComment.postCommentIndex ===
                                                    item.postCommentIndex
                                                    ? highlightPostComment.shouldHighlightRef
                                                    : null
                                            }
                                            onJumpToMessage={handleJumpToPostComment}
                                            onReplyToMessage={() => {
                                                if (item.postComment.isOptimistic) return;
                                                const postCommentIndex = item.postComment.index;

                                                setReplyingToPostCommentIndexByPostId(
                                                    replyingToPostCommentIndexByPostId => {
                                                        const newReplyingToPostCommentIndexByPostId =
                                                            new Map(
                                                                replyingToPostCommentIndexByPostId,
                                                            );
                                                        newReplyingToPostCommentIndexByPostId.set(
                                                            item.post.id,
                                                            postCommentIndex,
                                                        );
                                                        return newReplyingToPostCommentIndexByPostId;
                                                    },
                                                );
                                            }}
                                            onDeleteMessage={async () => {
                                                const procedures =
                                                    proceduresByPostIdRef.current.get(item.post.id);
                                                if (!procedures)
                                                    throw new InternalError(
                                                        "Post comment input isn't mounted",
                                                    );

                                                await procedures.deleteComment({
                                                    commentIndex: item.postCommentIndex,
                                                });
                                            }}
                                            disableExpensiveFeaturesDuringScroll={
                                                disableExpensiveFeaturesDuringScroll
                                            }
                                            getMessageUrl={messageIndex => {
                                                return new URL(
                                                    `/s/${item.post.spaceId}/posts/${item.post.id}?comment=${messageIndex}`,
                                                    window.location.href,
                                                );
                                            }}
                                            roomDisplayedCreatedTime={item.post.createdTime}
                                            availableWidth={availablePostWidth}
                                            // You shouldn't be able to edit, delete, or reply to comments if you don't
                                            // have `Comment` access on the post.
                                            //
                                            // Use the `accessPolicy` from `header` if applicable. Because we update
                                            // the `channel` in `header` in realtime. Whereas the `channel` preview
                                            // in the `PostModel` might not update in realtime.
                                            readOnlyIfAccessPolicyDoesNotHaveCommentAccessLevel={
                                                header?.type === "Channel" &&
                                                header.channel.id === item.post.channel.id
                                                    ? header.channel.accessPolicy
                                                    : item.post.channel.accessPolicy
                                            }
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
                                            className={sprinkles({
                                                position: "relative",
                                                zIndex: "0",
                                                width: "full",
                                                maxWidth: contentStyles.contentMaxWidth,
                                            })}
                                            style={{
                                                flex: postViewFlex,
                                            }}
                                        >
                                            {item.postCommentIndex === 0 && <Spacer space="6" />}
                                            {messageNode}
                                            {isPostView &&
                                                // -2 instead of -1 since when `isPostView` is true we don't
                                                // actually render the final comment input item in `posts`.
                                                index === posts.getItemCount() - 2 && (
                                                    <div
                                                        style={{height: messagingViewMarginBottom}}
                                                    />
                                                )}
                                        </div>
                                        {asideSpacer}
                                        {sideBarRightSpacer}
                                    </div>
                                );
                            },
                        ),
                    };
                }

                case "PostCommentsTypingIndicator": {
                    return {
                        key: `PostCommentsTypingIndicator:${item.post.id}`,
                        minHeight: messagingTypingIndicatorsMinHeightPx[spacingScale],
                        node: (
                            <div
                                className={sprinkles({
                                    display: "flex",
                                    justifyContent: "center",
                                    overflow: "hidden",
                                })}
                            >
                                {sideBarLeftSpacer}
                                <div
                                    className={sprinkles({
                                        position: "relative",
                                        zIndex: "0",
                                        width: "full",
                                        maxWidth: contentStyles.contentMaxWidth,
                                        overflow: "hidden",
                                    })}
                                    style={{
                                        flex: postViewFlex,
                                    }}
                                >
                                    {item.postComments.getMessageCountIncludingOptimisticMessages() ===
                                        0 && <Spacer space="6" />}
                                    <MessagingTypingIndicators
                                        typingStateByConnectionId={item.typingStateByConnectionId}
                                        shouldAddMarginBottom={
                                            isPostView &&
                                            // -2 instead of -1 since when `isPostView` is true we don't
                                            // actually render the final comment input item in `posts`.
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

                // The post comment input item sticks to the bottom of the screen while a post
                // is visible. Whenever any item in the post is rendered we also additionally
                // render the post comment input (`renderAdditionalItemIndexes`) so that
                // virtualization doesn't remove it.
                //
                // We create a `<div>` that spans the bottom of the post content to the end of
                // the entire post. This is the range in which our post comment input will be
                // sticky. We create a second `<div>` of the same range but rendering the full
                // post width border. The post comment input is shaped so that when we reach the
                // bottom of the page the full width border will slide underneath it. Creating
                // the effect of while scrolling the comment input is a layer on top of the post
                // and when at the bottom of the post the comment input is inline.
                //
                // IMPORTANT: This code is very similar to how we render `<DocumentCommentInput>`
                // in `<DocumentCommentThreadListView>`! If you are updating this code you also
                // probably want to update `<DocumentCommentThreadListView>`. We don't know what
                // a good abstraction here is so following the advice "no abstraction is better
                // than the wrong abstraction".
                case "PostCommentInput": {
                    // On mobile, the comment button doesn't expand/collapse. Instead it opens the
                    // post in a new route. Supplemental sanity check to the assert at the beginning
                    // of this component.
                    assert(platform !== "mobile");

                    const replyingToPostCommentIndex = replyingToPostCommentIndexByPostId.get(
                        item.post.id,
                    );
                    const replyingToPostComment =
                        replyingToPostCommentIndex !== undefined
                            ? item.postComments.getLoadedMessageIfExists(replyingToPostCommentIndex)
                            : null;

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
                            replyingToPostComment={replyingToPostComment}
                            onClearReplyingToPostComment={() => {
                                setReplyingToPostCommentIndexByPostId(
                                    replyingToPostCommentIndexByPostId => {
                                        const newReplyingToPostCommentIndexByPostId = new Map(
                                            replyingToPostCommentIndexByPostId,
                                        );
                                        newReplyingToPostCommentIndexByPostId.delete(item.post.id);
                                        return newReplyingToPostCommentIndexByPostId;
                                    },
                                );
                            }}
                            onJumpToPostComment={handleJumpToPostComment}
                            onDeletePostComment={async postCommentIndex => {
                                const procedures = proceduresByPostIdRef.current.get(item.post.id);
                                if (!procedures)
                                    throw new InternalError("Post comment input isn't mounted");

                                await procedures.deleteComment({
                                    commentIndex: postCommentIndex,
                                });
                            }}
                            shouldBeConnectedToChannelRealtime={shouldBeConnectedToChannelRealtime}
                            onPostRealtimeEventTransaction={onPostRealtimeEventTransaction}
                        />
                    );

                    return {
                        key: `PostCommentInput:${item.post.id}`,
                        minHeight: messageInputMinHeightPx[platform][spacingScale],
                        withManualLayout: true,
                        stayCompletelyVisibleAfterResize: true,
                        render: ({
                            ref,
                            offset,
                            height,
                            shouldRenderWithRelativePositioning,
                            getPositionByIndex,
                        }) => {
                            const postContentPosition = getPositionByIndex(
                                item.postContentItemIndex,
                            );

                            const postContentOffsetEnd =
                                postContentPosition.offset + postContentPosition.height;

                            return (
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
                                                  height: offset - postContentOffsetEnd + height,
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
                                            className={sprinkles({
                                                position: "relative",
                                                zIndex: "0",
                                                width: "full",
                                                maxWidth: contentStyles.contentMaxWidth,
                                                pointerEvents: "auto",
                                                backgroundColor: "grey-0",
                                            })}
                                            style={{
                                                flex: postViewFlex,
                                                // Don't allow item to grow beyond flexbox bounds. By default flexbox items
                                                // have `min-width: auto` which extends with content.
                                                // https://stackoverflow.com/a/66689926/1568890
                                                minWidth: 0,
                                            }}
                                        >
                                            {inputNode}
                                            <div
                                                className={sprinkles({
                                                    position: "absolute",
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
                                                    })}
                                                    style={{
                                                        // Draw border with `box-shadow` so it doesn't contribute to layout.
                                                        //
                                                        // `box-shadow` is drawn 1px below the comment input since:
                                                        //
                                                        // 1. The border shouldn't be visible while the comment input is
                                                        //    sticky.
                                                        // 2. The space between the comment input and bottom border is
                                                        //    small enough that 1px difference is noticeable to the
                                                        //    trained eye.
                                                        boxShadow: `0 1px 0 0 ${colorSchemeVars["grey-5"]}`,
                                                    }}
                                                />
                                            </div>
                                        </div>
                                        {asideSpacer}
                                        {sideBarRightSpacer}
                                    </div>
                                </div>
                            );
                        },
                    };
                }

                // NOTE(calebmer, 2023-02-10): We render 3 shimmers before the spinner to
                // create some space to scroll and more directly imply to the user that there
                // is more content to be loaded. Sometimes we may only load 1 post and so the
                // three shimmers is a little false but this feels like an acceptable tradeoff.
                case "MoreUnloadedPosts": {
                    return {
                        key: "MoreUnloadedPosts",
                        minHeight: platform !== "mobile" ? "36.125rem" : "26.25rem",
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
                                        overflow: "hidden",
                                    })}
                                    style={{
                                        flex: postViewFlex,
                                    }}
                                >
                                    <PostShimmer />
                                    <PostShimmer />
                                    {platform !== "mobile" && <PostShimmer />}
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
                    throw new UnimplementedError(
                        "TODO(calebmer): Will be implemented later in the stack",
                    );
                }

                default:
                    throw exhaustive(item);
            }
        },
        [
            posts,
            hasNavigationBar,
            sideBarLeftSpacer,
            asideSpacer,
            sideBarRightSpacer,
            isPostView,
            spacingScale,
            withSafeAreaInsetTop,
            hasHeader,
            postEditing,
            shouldNotShowChannelId,
            availablePostWidth,
            initialScrollForFirstPost,
            idBase,
            onTogglePostComments,
            loadInitialPostComments,
            messageEditing,
            fileAttachmentTargetByPostId,
            highlightPostComment,
            handleJumpToPostComment,
            header,
            platform,
            replyingToPostCommentIndexByPostId,
            inputRefByPostId,
            shouldBeConnectedToChannelRealtime,
            onPostRealtimeEventTransaction,
            onUpdatePostComments,
        ],
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
                                onContentEditorStateChange={contentEditorState =>
                                    postEditing.dispatch({
                                        type: "ContentEditorStateChange",
                                        contentEditorState,
                                    })
                                }
                                initialContent={postEditing.state.initialContent}
                                onCloseWithAnimation={onCloseWithAnimation}
                                onPostRealtimeEventTransaction={onPostRealtimeEventTransaction}
                            />
                        );
                    }}
                </MobileFullScreenModal>
            )}
            <div
                {...dropTargetProps}
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
                {dragOverlay}
                {withSafeAreaInsetTop && !navigationBar?.navigationBar && (
                    // Only render a safe area cover if we don't have a navigation bar. Otherwise
                    // the navigation bar acts as our safe area cover.
                    <div
                        className={sprinkles({
                            position: "absolute",
                            top: "0",
                            left: "0",
                            right: "0",
                            zIndex: "10",
                            height: "safe-area-inset-top",
                            backgroundColor: "grey-0",
                        })}
                    />
                )}
                <VirtualizedScrollView
                    ref={viewRef}
                    elementRef={navigationBar?.scrollViewRef}
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
                    // Make sure content height is an integer. This guarantees we properly position
                    // our aside given scroll offset is always an integer. We see some rendering
                    // bugs in Chrome if content height isn't rounded. For example:
                    //
                    // https://alpine.inc/s/c2pwxmpv3z7b3db19tsn6y1qfg/tasks/xdcahs0wp7zwv27gbj4tt11dq8
                    withRoundedContentHeight={true}
                    // If the aside is larger than our virtualized list's content then we need to
                    // make sure the `<VirtualizedScrollView>`s DOM includes the aside's height in
                    // some measurements. Otherwise the navigation bar among other things start to
                    // break down.
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
                                                              ? viewSize.height - asideSize.height
                                                              : 0,
                                                  }
                                                : {
                                                      bottom:
                                                          viewSize && asideSize
                                                              ? viewSize.height - asideSize.height
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
                        </>
                    }
                    extraChildrenOutsideContentElement={({contentHeight}) => (
                        // Our items all have a bottom border. This is good when there's less content
                        // than room to scroll since it creates a clear shape for the last item in the
                        // list.
                        //
                        // However, if there are enough items to scroll then when the user has fully
                        // scrolled we want the last item to *not* have a border bottom since the
                        // bottom of the screen creates that boundary. We don't need to render an extra
                        // line in the margins.
                        //
                        // This div covers the bottom border of the last item but only when there's
                        // enough content to scroll. Otherwise the bottom border needs to be visible to
                        // visually contain the last item. To debug this it's helpful to switch the
                        // `backgroundColor` to `red-30` or something similar.
                        <div
                            className={sprinkles({
                                position: "absolute",
                                left: "0",
                                right: "0",
                                top: "0",
                            })}
                            style={{height: `max(100%, ${contentHeight}px)`}}
                        >
                            <div
                                className={sprinkles({
                                    position: "absolute",
                                    left: "0",
                                    right: "0",
                                    bottom: "0",
                                    height: "1",
                                    backgroundColor: "grey-0",
                                })}
                            />
                        </div>
                    )}
                />
                {isPostView &&
                    (() => {
                        const lastPostContentItem = assertExists(
                            posts.getPostContentItemIfExists(header ? 1 : 0),
                        );

                        const replyingToPostCommentIndex = replyingToPostCommentIndexByPostId.get(
                            lastPostContentItem.post.id,
                        );
                        const replyingToPostComment =
                            replyingToPostCommentIndex !== undefined
                                ? lastPostContentItem.postComments.getLoadedMessageIfExists(
                                      replyingToPostCommentIndex,
                                  )
                                : null;

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
                                replyingToPostComment={replyingToPostComment}
                                onClearReplyingToPostComment={() => {
                                    setReplyingToPostCommentIndexByPostId(
                                        replyingToPostCommentIndexByPostId => {
                                            const newReplyingToPostCommentIndexByPostId = new Map(
                                                replyingToPostCommentIndexByPostId,
                                            );
                                            newReplyingToPostCommentIndexByPostId.delete(
                                                lastPostContentItem.post.id,
                                            );
                                            return newReplyingToPostCommentIndexByPostId;
                                        },
                                    );
                                }}
                                onJumpToPostComment={handleJumpToPostComment}
                                onDeletePostComment={async postCommentIndex => {
                                    const procedures = proceduresByPostIdRef.current.get(
                                        lastPostContentItem.post.id,
                                    );
                                    if (!procedures)
                                        throw new InternalError("Post comment input isn't mounted");

                                    await procedures.deleteComment({
                                        commentIndex: postCommentIndex,
                                    });
                                }}
                                shouldBeConnectedToChannelRealtime={
                                    shouldBeConnectedToChannelRealtime
                                }
                                onPostRealtimeEventTransaction={onPostRealtimeEventTransaction}
                            />
                        );
                    })()}
            </div>
        </>
    );
}
