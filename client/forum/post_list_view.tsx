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
    useImperativeHandle,
    useMemo,
    useRef,
    useState,
} from "react";
import {useAppContext} from "~/client/context/app_context.js";
import {getRemPxWithoutListening, useRemPx} from "~/client/design/helpers/use_rem_px.js";
import {
    NavigationBarRef,
    NavigationBarResult,
    desktopNavigationBarHeightRem,
    mobileNavigationBarHeightRem,
    navigationBarHeight,
} from "~/client/design/navigation_bar.js";
import {Spacer} from "~/client/design/spacer.js";
import {delayLoadingIndicatorLimitMs} from "~/client/design/timing_constants.js";
import {ChannelViewHeader, channelViewHeaderMinHeight} from "~/client/forum/channel_view_header.js";
import {
    PostCommentInput,
    PostRealtimeProcedures,
    postCommentInputMinHeight,
} from "~/client/forum/post_comment_input.js";
import {
    PostContentView,
    postCommentSectionGuidelineOffset,
    postContentViewMinHeight,
    postContentViewPaddingX,
} from "~/client/forum/post_content_view.js";
import {usePostEditing} from "~/client/forum/post_editing.js";
import {
    PostListBase,
    PostListChannelHeader,
    PostListPostContentItem,
    PostListWithChannelHeader,
} from "~/client/forum/post_list.js";
import {PostShimmer} from "~/client/forum/post_shimmer.js";
import {useEvent} from "~/client/helpers/lifecycle/use_event.js";
import {useResizeObserver} from "~/client/helpers/use_resize_observer.js";
import {useMessageEditing} from "~/client/messaging/message_editing.js";
import {MessageList} from "~/client/messaging/message_list.js";
import {MessageShimmer} from "~/client/messaging/message_shimmer.js";
import {MessageView} from "~/client/messaging/message_view.js";
import {
    MessagingTypingIndicators,
    messagingTypingIndicatorsMinHeight,
} from "~/client/messaging/messaging_typing_indicators.js";
import {getInitialLoadMessageCount} from "~/client/messaging/messaging_view.js";
import {tryLoadingMessages} from "~/client/messaging/try_loading_messages.js";
import {getClientInfoWithoutListening} from "~/client/remix/client_info_context.js";
import {useIsMobile} from "~/client/remix/use_is_mobile.js";
import {renderVirtualizedScrollViewItemWithExpensiveFeaturesDisabledDuringScroll} from "~/client/virtualized/helpers/render_virtualized_scroll_view_item_with_expensive_features_disabled_during_scroll.js";
import {
    VirtualizedScrollView,
    VirtualizedScrollViewRef,
    VirtualizedScrollViewRenderItem,
} from "~/client/virtualized/virtualized_scroll_view.js";
import {Spacing, addRemLengths, convertRemLengthToPx, spacing} from "~/shared/design/spacing.js";
import {DynamoGeneralRealtimeEvent} from "~/shared/dynamo/dynamo_general_realtime_types.js";
import {InternalError} from "~/shared/error/error.js";
import {PostCommentModel, PostModel} from "~/shared/forum/post_model.js";
import {wait} from "~/shared/helpers/async/wait.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.js";
import {areRangesOverlapping} from "~/shared/helpers/geometry/are_ranges_overlapping.js";
import {clamp} from "~/shared/helpers/number/clamp.js";
import {PostId} from "~/shared/id/types/id_types.js";
import {messageViewMinHeight} from "~/shared/messaging/messaging_shared_styles.js";
import {
    getPostCommentsFromEnd,
    getPostCommentsFromStart,
    updatePostContent,
} from "~/shared/rpc/forum_rpc_definitions.js";
import {spinAnimationClassName, sprinkles} from "~/shared/styles/styles.js";

// NOCOMMIT: There are some bugs send reply comments

// NOCOMMIT: Remove this?
export const postListViewMarginX: Spacing = "4";
export const postListViewMarginY: Spacing = "4";

export const postViewMaxWidth: Spacing = "160";

export const postListViewAsideMaxWidth: Spacing = "96";

const postViewFlex = 6;
const postListViewAsideFlex = 4;

const postCommentSectionGuidelineSpace = "6";

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
};

/**
 * Renders a virtualized list of posts which can expand their comments inline.
 *
 * This component handles all rendering for a post unit. Including rendering an
 * individual post on a post route. Since even when rendering an individual
 * post you still need to virtualize the list of comments. This means there is
 * some confusing overloading because features like `channelHeader` and `aside`
 * which are important in the context of a channel are not important in the
 * context of rendering a single post.
 */
function PostListView(
    {
        channelHeader,
        posts: postsWithoutChannelHeader,
        onTogglePostComments,
        onUpdatePostComments,
        onLoadMorePosts,
        onPostRealtimeEventTransaction,
        aside,
        withMobileLayout: withMobileLayoutProp = false,
        navigationBar,
    }: {
        /**
         * If this post list is rendering a channel, you may provide this prop and we
         * will render an area at the top of the list describing the channel.
         */
        channelHeader?: Memo<PostListChannelHeader>;

        /**
         * The post content to be rendered in this post list view.
         */
        posts: PostListBase;

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
         * Apply a realtime event transaction for posts before we get an event from our
         * realtime WebSocket connection. For instance after a post is updated we want
         * to update the post's state in case our realtime WebSocket connection is
         * slow.
         */
        onPostRealtimeEventTransaction: (event: {
            readTime: Date;
            eventTransaction: ReadonlyArray<DynamoGeneralRealtimeEvent<PostModel>>;
        }) => void;

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
        aside?: ReactNode;

        /**
         * Use the mobile layout for a post list view even on desktop.
         *
         * The mobile layout doesn't have margins and will pin the comment input for
         * single posts to the bottom of the screen.
         *
         * If you set this to true you may not pass in `aside` since `aside` can
         * not render on mobile.
         */
        withMobileLayout?: boolean;

        /**
         * If you want to include a navigation bar in this list view you may pass in
         * the result of `useNavigationBar()` here and the virtualized scroll view will
         * be properly configured.
         */
        navigationBar?: NavigationBarResult & {navigationBarRef: RefObject<NavigationBarRef>};
    },
    ref: Ref<PostListViewRef>,
) {
    const context = useAppContext();
    const isMobile = useIsMobile();
    const remPx = useRemPx();

    const withMobileLayout = isMobile || withMobileLayoutProp;

    const viewRef = useRef<VirtualizedScrollViewRef>(null);
    const [viewContainerRef, viewSize] = useResizeObserver();
    const [asideRef, asideSize] = useResizeObserver();

    const navigationBarHeightPx =
        (isMobile ? mobileNavigationBarHeightRem : desktopNavigationBarHeightRem) * remPx;

    const lastScrollOffsetRef = useRef(0);
    const [scrollDirectionState, setScrollDirectionState] = useState<{
        scrollDirection: "Up" | "Down";
        asideBufferedHeight: number;
    }>({
        scrollDirection: "Down",
        asideBufferedHeight: navigationBarHeightPx,
    });

    const hasAside = !withMobileLayout && !!aside;
    const hasNavigationBar = !!navigationBar;

    const posts = useMemo(
        () =>
            channelHeader
                ? new PostListWithChannelHeader(channelHeader, postsWithoutChannelHeader)
                : postsWithoutChannelHeader,
        [channelHeader, postsWithoutChannelHeader],
    );

    // Always pin the post comment input to the bottom of the list view on mobile
    // layout of a single post. We use a heuristic of one post with always open
    // comments to determine if we're in a single post context.
    const isSingleMobileLayoutPostWithPinnedCommentInput =
        posts.getPostCount() === 1 &&
        posts.getPostContentItemIfExists(channelHeader ? 1 : 0)?.postCommentsState === "AlwaysOpen";

    const isLoadingRef = useRef(false);
    const [errorState, setErrorState] = useState<
        {hasError: false} | {hasError: true; error: unknown}
    >({hasError: false});

    if (errorState.hasError) throw errorState.error;

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
                    setErrorState({hasError: true, error});
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

                            // The limit of items we will load is two views worth of posts. This gives
                            // the user some space to scroll and read before we need to load more posts.
                            const limit = Math.max(
                                20,
                                Math.ceil(
                                    (view.getHeight() * 2) /
                                        convertRemLengthToPx(
                                            postContentViewMinHeight,
                                            getRemPxWithoutListening(),
                                        ),
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
        // eslint-disable-next-line @typescript-eslint/no-misused-promises
        async (item: PostListPostContentItem): Promise<void> => {
            // If we're already loading, don't try to load more comments.
            if (isLoadingRef.current) return;
            isLoadingRef.current = true;

            try {
                const limit = getInitialLoadMessageCount(getClientInfoWithoutListening());

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
                setErrorState({hasError: true, error});
            }
        },
    );

    // Post realtime is managed by the `<PostCommentInput>` component since the
    // `<PostCommentInput>` component is always mounted when the post's comments
    // are open. Since we need realtime actions in every part of the post we have
    // `<PostCommentInput>` stash the method to send them in this ref so they can
    // be called elsewhere.
    const proceduresByPostIdRef = useRef(new Map<PostId, PostRealtimeProcedures>());

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

    const {postEditing, modals: postEditingModals} = usePostEditing({
        onUpdatePostContent: async ({postId, content}) => {
            const event = await updatePostContent(context, {
                postId,
                content,
            });

            onPostRealtimeEventTransaction(event);
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

        const scrollToIndex = posts.getPostById(postId).getPostCommentIndex(postCommentIndex);

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

            Promise.race([result.promise, wait(delayLoadingIndicatorLimitMs)]).finally(() => {
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

    useImperativeHandle(
        ref,
        () => ({
            jumpToPostCommentIndex,
        }),
        [jumpToPostCommentIndex],
    );

    const renderItem: VirtualizedScrollViewRenderItem = useCallback(
        index => {
            const item = posts.getItem(index);
            switch (item.type) {
                case "ChannelHeader": {
                    return {
                        key: "ChannelHeader",
                        minHeight: addRemLengths(
                            hasNavigationBar
                                ? spacing[navigationBarHeight[isMobile ? "mobile" : "desktop"]]
                                : "0rem",
                            channelViewHeaderMinHeight,
                        ),
                        node: (
                            <div
                                className={sprinkles({
                                    display: "flex",
                                    justifyContent: "center",
                                })}
                            >
                                <div
                                    className={sprinkles({
                                        width: "full",
                                        overflow: "hidden",
                                        maxWidth: postViewMaxWidth,
                                    })}
                                    style={{
                                        flex: postViewFlex,
                                    }}
                                >
                                    {hasNavigationBar && <Spacer space={navigationBarHeight} />}
                                    <ChannelViewHeader
                                        channelHeader={item.channelHeader}
                                        withMobileLayout={withMobileLayout}
                                    />
                                </div>
                                {hasAside && (
                                    <div
                                        className={sprinkles({
                                            width: "full",
                                            maxWidth: postListViewAsideMaxWidth,
                                        })}
                                        style={{
                                            flex: postListViewAsideFlex,
                                        }}
                                    />
                                )}
                            </div>
                        ),
                    };
                }
                case "PostContent": {
                    return {
                        key: `PostContent:${item.post.id}`,
                        minHeight: postContentViewMinHeight,
                        node: (
                            <div
                                className={sprinkles({
                                    display: "flex",
                                    justifyContent: "center",
                                })}
                            >
                                <div
                                    className={sprinkles({
                                        position: "relative",
                                        width: "full",
                                        maxWidth: postViewMaxWidth,
                                        overflow: "hidden",
                                    })}
                                    style={{
                                        flex: postViewFlex,
                                    }}
                                >
                                    {index !== 0 && (
                                        <div
                                            className={sprinkles({
                                                position: "absolute",
                                                width: "full",
                                                paddingX: postContentViewPaddingX,
                                            })}
                                            style={{
                                                top: 0,
                                            }}
                                        >
                                            <div
                                                className={sprinkles({
                                                    width: "full",
                                                    borderTop: "grey-5",
                                                })}
                                            />
                                        </div>
                                    )}
                                    <PostContentView
                                        post={item.post}
                                        postComments={item.postComments}
                                        postCommentsState={item.postCommentsState}
                                        postEditing={postEditing}
                                        // If we are rendering in the context of a channel, don't render the channel
                                        // in posts.
                                        shouldShowChannel={
                                            channelHeader?.channel.id !== item.post.channel.id
                                        }
                                        onTogglePostComments={() =>
                                            onTogglePostComments(item.post.id)
                                        }
                                        onLoadInitialPostComments={() =>
                                            loadInitialPostComments(item)
                                        }
                                    />
                                </div>
                                {hasAside && (
                                    <div
                                        className={sprinkles({
                                            width: "full",
                                            maxWidth: postListViewAsideMaxWidth,
                                        })}
                                        style={{
                                            flex: postListViewAsideFlex,
                                        }}
                                    />
                                )}
                            </div>
                        ),
                        renderAdditionalItemIndexes:
                            item.postCommentInputItemIndex !== null &&
                            !isSingleMobileLayoutPostWithPinnedCommentInput
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

                    return {
                        key:
                            item.type === "LoadedPostComment"
                                ? `PostComment:${item.post.id}:${item.postComment.index}`
                                : item.type === "OptimisticPostComment"
                                ? `PostComment:${item.post.id}:${item.postCommentIndex}`
                                : `UnloadedPostComment:${item.post.id}:${item.postCommentIndex}`,
                        minHeight: messageViewMinHeight,
                        renderAdditionalItemIndexes: !isSingleMobileLayoutPostWithPinnedCommentInput
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
                                            previousMessage={previousComment}
                                            isFirstMessage={item.postCommentIndex === 0}
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
                                            marginX={
                                                postContentViewPaddingX[
                                                    isMobile ? "mobile" : "desktop"
                                                ]
                                            }
                                            centeringMarginRight={postCommentSectionGuidelineSpace}
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
                                        />
                                    ) : (
                                        <MessageShimmer
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
                                            overflow: "hidden",
                                        })}
                                    >
                                        <div
                                            className={sprinkles({
                                                position: "relative",
                                                zIndex: "0",
                                                width: "full",
                                                maxWidth: postViewMaxWidth,
                                                overflow: "hidden",
                                                paddingLeft: postCommentSectionGuidelineSpace,
                                            })}
                                            style={{
                                                flex: postViewFlex,
                                            }}
                                        >
                                            <div
                                                className={sprinkles({
                                                    position: "absolute",
                                                    top: "0",
                                                    bottom: "0",
                                                    borderLeft: "grey-5",
                                                    borderLeftWidth: "thick",
                                                })}
                                                style={{
                                                    left: `calc(${
                                                        postCommentSectionGuidelineOffset[
                                                            isMobile ? "mobile" : "desktop"
                                                        ]
                                                    } - 1px)`,
                                                }}
                                            />
                                            {item.postCommentIndex === 0 && <Spacer space="4" />}
                                            {messageNode}
                                        </div>
                                        {hasAside && (
                                            <div
                                                className={sprinkles({
                                                    width: "full",
                                                    maxWidth: postListViewAsideMaxWidth,
                                                    overflow: "hidden",
                                                })}
                                                style={{
                                                    flex: postListViewAsideFlex,
                                                }}
                                            />
                                        )}
                                    </div>
                                );
                            },
                        ),
                    };
                }

                case "PostCommentsTypingIndicator": {
                    return {
                        key: `PostCommentsTypingIndicator:${item.post.id}`,
                        minHeight: messagingTypingIndicatorsMinHeight,
                        node: (
                            <div
                                className={sprinkles({
                                    display: "flex",
                                    justifyContent: "center",
                                    overflow: "hidden",
                                })}
                            >
                                <div
                                    className={sprinkles({
                                        position: "relative",
                                        zIndex: "0",
                                        width: "full",
                                        maxWidth: postViewMaxWidth,
                                        overflow: "hidden",
                                        paddingLeft: postCommentSectionGuidelineSpace,
                                    })}
                                    style={{
                                        flex: postViewFlex,
                                    }}
                                >
                                    <div
                                        className={sprinkles({
                                            position: "absolute",
                                            top: "0",
                                            bottom: "0",
                                            borderLeft: "grey-5",
                                            borderLeftWidth: "thick",
                                        })}
                                        style={{
                                            left: `calc(${
                                                postCommentSectionGuidelineOffset[
                                                    isMobile ? "mobile" : "desktop"
                                                ]
                                            } - 1px)`,
                                        }}
                                    />
                                    <MessagingTypingIndicators
                                        typingStateByConnectionId={item.typingStateByConnectionId}
                                    />
                                </div>
                                {hasAside && (
                                    <div
                                        className={sprinkles({
                                            width: "full",
                                            maxWidth: postListViewAsideMaxWidth,
                                            overflow: "hidden",
                                        })}
                                        style={{
                                            flex: postListViewAsideFlex,
                                        }}
                                    />
                                )}
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
                            paddingX={postContentViewPaddingX[isMobile ? "mobile" : "desktop"]}
                        />
                    );

                    const marginY = spacing["2"];

                    return {
                        key: `PostCommentInput:${item.post.id}`,
                        minHeight: addRemLengths(postCommentInputMinHeight, marginY),
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
                                postContentPosition.offset + postContentPosition.height - 1;

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
                                                bottom: `-${marginY}`,
                                            }),
                                            paddingBottom: marginY,
                                        }}
                                        className={sprinkles({
                                            width: "full",
                                            display: "flex",
                                            justifyContent: "center",
                                            overflow: "hidden",
                                        })}
                                    >
                                        <div
                                            className={sprinkles({
                                                position: "relative",
                                                zIndex: "0",
                                                width: "full",
                                                maxWidth: postViewMaxWidth,
                                                pointerEvents: "auto",
                                                paddingLeft: postCommentSectionGuidelineSpace,
                                                backgroundColor: "grey-0",
                                            })}
                                            style={{
                                                flex: postViewFlex,
                                            }}
                                        >
                                            <div
                                                className={sprinkles({
                                                    position: "absolute",
                                                    top: "0",
                                                    bottom: "7",
                                                    width: "2.5",
                                                    borderLeft: "grey-5",
                                                    borderLeftWidth: "thick",
                                                    borderBottom: "grey-5",
                                                    borderBottomWidth: "thick",
                                                    borderBottomLeftRadius: "lg",
                                                })}
                                                style={{
                                                    left: `calc(${
                                                        postCommentSectionGuidelineOffset[
                                                            isMobile ? "mobile" : "desktop"
                                                        ]
                                                    } - 1px)`,
                                                }}
                                            />
                                            {inputNode}
                                        </div>
                                        {hasAside && (
                                            <div
                                                className={sprinkles({
                                                    width: "full",
                                                    maxWidth: postListViewAsideMaxWidth,
                                                    overflow: "hidden",
                                                })}
                                                style={{
                                                    flex: postListViewAsideFlex,
                                                }}
                                            />
                                        )}
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
                        // NOCOMMIT: min height fix?
                        minHeight: "34.875rem",
                        node: (
                            <div
                                className={sprinkles({
                                    display: "flex",
                                    justifyContent: "center",
                                })}
                            >
                                <div
                                    className={sprinkles({
                                        width: "full",
                                        maxWidth: postViewMaxWidth,
                                        overflow: "hidden",
                                    })}
                                    style={{
                                        flex: postViewFlex,
                                    }}
                                >
                                    <PostShimmer />
                                    <Spacer space={postListViewMarginY} />
                                    <PostShimmer />
                                    <Spacer space={postListViewMarginY} />
                                    <PostShimmer />
                                    <div
                                        className={sprinkles({
                                            display: "flex",
                                            justifyContent: "center",
                                            color: "grey-60",
                                            paddingY: postListViewMarginY,
                                        })}
                                    >
                                        <SpinnerGap
                                            className={spinAnimationClassName}
                                            size={spacing["6"]}
                                            weight="light"
                                        />
                                    </div>
                                </div>
                                {hasAside && (
                                    <div
                                        className={sprinkles({
                                            width: "full",
                                            maxWidth: postListViewAsideMaxWidth,
                                            overflow: "hidden",
                                        })}
                                        style={{
                                            flex: postListViewAsideFlex,
                                        }}
                                    />
                                )}
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
            isMobile,
            withMobileLayout,
            hasAside,
            channelHeader?.channel.id,
            postEditing,
            isSingleMobileLayoutPostWithPinnedCommentInput,
            onTogglePostComments,
            loadInitialPostComments,
            messageEditing,
            highlightPostComment,
            handleJumpToPostComment,
            replyingToPostCommentIndexByPostId,
            onUpdatePostComments,
        ],
    );

    return (
        <>
            {messageEditingModals}
            {postEditingModals}
            <div
                ref={viewContainerRef}
                className={sprinkles({
                    flexGrow: "1",
                    width: "full",
                    height: "full",
                    overflow: "hidden",
                    position: "relative",
                    display: "flex",
                    flexDirection: "column",
                })}
            >
                <VirtualizedScrollView
                    ref={viewRef}
                    elementRef={navigationBar?.scrollViewRef}
                    scrollbarInsetTop={navigationBar?.scrollbarInsetTop}
                    bufferedItemHeight={postContentViewMinHeight}
                    itemCount={
                        // Don't render the post comment input (which should be the last item) if we are
                        // pinning the comment input to the bottom of the view.
                        posts.getItemCount() -
                        (isSingleMobileLayoutPostWithPinnedCommentInput ? 1 : 0)
                    }
                    renderItem={renderItem}
                    onRenderedRangeChange={tryLoadingMoreData}
                    onScroll={scrollOffset => {
                        const view = assertExists(viewRef.current);

                        scrollOffset = clamp(
                            0,
                            scrollOffset,
                            view.getContentHeight() - view.getHeight(),
                        );

                        const viewHeight = viewSize?.height ?? 0;
                        const asideHeight = Math.max(viewHeight, asideSize?.height ?? 0);

                        const lastScrollOffset = lastScrollOffsetRef.current;
                        lastScrollOffsetRef.current = scrollOffset;

                        const navigationBarVisibleHeight = navigationBar
                            ? assertExists(
                                  navigationBar.navigationBarRef.current,
                              ).getVisibleHeight()
                            : 0;

                        setScrollDirectionState(scrollDirectionState => {
                            const newScrollDirection =
                                scrollOffset > lastScrollOffset ? "Down" : "Up";

                            if (scrollDirectionState.scrollDirection === newScrollDirection)
                                return scrollDirectionState;

                            const asideScrollOffset = clamp(
                                0 - navigationBarVisibleHeight,
                                scrollOffset - scrollDirectionState.asideBufferedHeight,
                                asideHeight - viewHeight,
                            );

                            const asideBufferedHeight = scrollOffset - asideScrollOffset;

                            return {
                                scrollDirection: newScrollDirection,
                                asideBufferedHeight,
                            };
                        });
                    }}
                    extraChildren={
                        <>
                            {navigationBar?.navigationBar}
                            {hasAside && (
                                <>
                                    <div
                                        style={{height: scrollDirectionState.asideBufferedHeight}}
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
                                                              ? viewSize.height -
                                                                asideSize.height -
                                                                navigationBarHeightPx
                                                              : 0,
                                                  }),
                                            left: 0,
                                            right: 0,
                                        }}
                                    >
                                        <div
                                            className={sprinkles({
                                                width: "full",
                                                maxWidth: postViewMaxWidth,
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
                                                    paddingX: "5",
                                                })}
                                                style={{minHeight: viewSize?.height}}
                                            >
                                                {aside}
                                            </aside>
                                        </div>
                                    </div>
                                </>
                            )}
                        </>
                    }
                />
                {isSingleMobileLayoutPostWithPinnedCommentInput &&
                    (() => {
                        const lastPostContentItem = assertExists(
                            posts.getPostContentItemIfExists(channelHeader ? 1 : 0),
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
                                paddingX={postContentViewPaddingX[isMobile ? "mobile" : "desktop"]}
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
                            />
                        );
                    })()}
            </div>
        </>
    );
}
