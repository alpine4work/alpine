import {SpinnerGap} from "phosphor-react";
import {
    Memo,
    MutableRefObject,
    ReactElement,
    ReactNode,
    Ref,
    forwardRef,
    useCallback,
    useEffect,
    useImperativeHandle,
    useRef,
    useState,
} from "react";
import {useAppContext} from "~/client/context/app_context";
import {getRemPxWithoutListening} from "~/client/design/helpers/use_rem_px";
import {Spacer} from "~/client/design/spacer";
import {delayLoadingIndicatorLimitMs} from "~/client/design/timing_constants";
import {ChannelViewHeader, channelViewHeaderMinHeight} from "~/client/forum/channel_view_header";
import {PostCommentInput, postCommentInputMinHeight} from "~/client/forum/post_comment_input";
import {PostContentView, postContentViewMinHeight} from "~/client/forum/post_content_view";
import {PostEditorModal} from "~/client/forum/post_editor_modal";
import {
    PostCommentsState,
    PostList,
    PostListChannelHeader,
    PostListPostContentItem,
} from "~/client/forum/post_list";
import {PostShimmer} from "~/client/forum/post_shimmer";
import {PostRealtimeActions} from "~/client/forum/use_post_realtime";
import {useEvent} from "~/client/helpers/lifecycle/use_event";
import {useResizeObserver} from "~/client/helpers/use_resize_observer";
import {useMessageEditing} from "~/client/messaging/message_editing";
import {MessageShimmer} from "~/client/messaging/message_shimmer";
import {MessageView, messageViewMinHeight} from "~/client/messaging/message_view";
import {getInitialLoadMessageCount} from "~/client/messaging/messaging_view";
import {tryLoadingMessages} from "~/client/messaging/try_loading_messages";
import {getClientInfoWithoutListening} from "~/client/remix/client_info_context";
import {useIsMobile} from "~/client/remix/use_is_mobile";
import {
    VirtualizedScrollView,
    VirtualizedScrollViewRef,
    VirtualizedScrollViewRenderItem,
} from "~/client/virtualized/virtualized_scroll_view";
import {
    RemLength,
    Spacing,
    addRemLengths,
    convertRemLengthToPx,
    spacing,
} from "~/shared/design/spacing";
import {InternalError} from "~/shared/error/error";
import {wait} from "~/shared/helpers/async/wait";
import {assert} from "~/shared/helpers/control/assert";
import {assertExists} from "~/shared/helpers/control/assert_exists";
import {exhaustive} from "~/shared/helpers/control/exhaustive";
import {areRangesOverlapping} from "~/shared/helpers/geometry/are_ranges_overlapping";
import {clamp} from "~/shared/helpers/number/clamp";
import {PostId} from "~/shared/id/types/id_types";
import {PostCommentModel, PostModel} from "~/shared/models/post_model";
import {getPostCommentsFromEnd, getPostCommentsFromStart} from "~/shared/rpc/forum_rpc_definitions";
import {spinAnimationClassName, sprinkles} from "~/shared/styles/styles";

export const postListViewMarginX: Spacing = "4";

// We want our Y margin to be the same as our X margin. We want to give items
// some margin top and some margin bottom so that the shadows don't overflow.
const postListViewMarginTop: Spacing = "2";
const postListViewMarginBottom: Spacing = "2";
export const postListViewMarginY: Spacing = "4";

export const postViewMaxWidth: Spacing = "160";

const postViewMaxWidthWithMarginXRem = addRemLengths(
    spacing[postListViewMarginX],
    spacing[postViewMaxWidth],
    spacing[postListViewMarginX],
);

export const postListViewAsideMaxWidth: Spacing = "64";

const postListViewAsideMaxWidthWithMarginXRem = addRemLengths(
    spacing[postListViewAsideMaxWidth],
    spacing[postListViewMarginX],
);

const postViewFlex = 7;
const postListViewAsideFlex = 3;

/**
 * The buffered height of an item in the post view virtualized list is the minimum
 * height of a single post.
 */
const bufferedPostViewHeight = addRemLengths(
    postContentViewMinHeight,
    spacing[postListViewMarginY],
);

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
    jumpToPostComment(postId: PostId, postCommentIndex: number): void;
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
        initialPostsResult,
        onLoadMorePosts,
        aside,
        withMobileLayout = false,
    }: {
        /**
         * If this post list is rendering a channel, you may provide this prop and we
         * will render an area at the top of the list describing the channel.
         */
        channelHeader?: Memo<PostListChannelHeader>;

        /**
         * The initial posts loaded to populate this post list view. We will use this
         * to construct a `PostList` class.
         */
        initialPostsResult:
            | {
                  type: "Many";
                  hasMorePosts: boolean;
                  posts: ReadonlyArray<PostModel>;
              }
            | {
                  type: "One";
                  post: PostModel;
                  postCommentsState?: PostCommentsState;
                  initialLoadPostComments?: {
                      comments: ReadonlyArray<PostCommentModel>;
                      otherReferencedComments: ReadonlyArray<PostCommentModel>;
                  };
              };

        /**
         * If the post list has more posts then this function should load those posts.
         * This function is required if you initialize the component with many posts
         * and set `hasMorePosts` to true. Not providing it will throw an error when
         * the user reaches the end of the list.
         */
        onLoadMorePosts?: (options: {
            limit: number;
            afterCursor?: {createdTime: Date; postId: PostId};
        }) => Promise<{
            hasMorePosts: boolean;
            posts: ReadonlyArray<PostModel>;
        }>;

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
    },
    ref: Ref<PostListViewRef>,
) {
    if (withMobileLayout) {
        assert(
            !aside,
            "Can't set both `withMobileLayout` and `aside` props since `aside` can't be rendered in a mobile layout",
        );
    }

    const isActuallyMobile = useIsMobile();
    const isMobile = isActuallyMobile || withMobileLayout;

    const context = useAppContext();
    const viewRef = useRef<VirtualizedScrollViewRef>(null);
    const [viewContainerRef, viewSize] = useResizeObserver();
    const [asideRef, asideSize] = useResizeObserver();

    const lastScrollOffsetRef = useRef(0);
    const [scrollDirectionState, setScrollDirectionState] = useState<{
        scrollDirection: "Up" | "Down";
        asideBufferedHeight: number;
    }>({
        scrollDirection: "Down",
        asideBufferedHeight: 0,
    });

    const hasAside = !isMobile && !!aside;
    const hasMargin = !isMobile || hasAside;

    const [postsWithoutChannelHeader, setPosts] = useState(() => {
        let posts: PostList;
        switch (initialPostsResult.type) {
            case "Many": {
                posts = PostList.empty
                    .insertManyPostsAtEnd(initialPostsResult.posts)
                    .setHasMorePosts(initialPostsResult.hasMorePosts);
                break;
            }
            case "One": {
                posts = PostList.empty.insertPostAtEnd(initialPostsResult.post, initialPostsResult);
                break;
            }
            default:
                throw exhaustive(initialPostsResult);
        }
        return posts.setChannelHeader(channelHeader ?? null);
    });

    const posts = postsWithoutChannelHeader.setChannelHeader(channelHeader ?? null);
    useEffect(() => {
        setPosts(posts);
    }, [posts]);

    // Always pin the post comment input to the bottom of the list view on mobile
    // layout of a single post. We use a heuristic of one post with always open
    // comments to determine if we're in a single post context.
    const isSingleMobilePostWithPinnedCommentInput =
        isMobile &&
        posts.getPostCount() === 1 &&
        posts.getLastPostContentItem()?.postCommentsState === "AlwaysOpen";

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
                    const item = posts.getPostContentItem(nextIndex);

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
                            const {postCommentCount, postComments, otherReferencedPostComments} =
                                await getPostCommentsFromStart(context, {
                                    postId: item.post.id,
                                    afterPostCommentIndex: afterMessageIndex,
                                    beforePostCommentIndex: beforeMessageIndex,
                                    limit,
                                });
                            return {
                                messageCount: postCommentCount,
                                messages: postComments,
                                otherReferencedMessages: otherReferencedPostComments,
                            };
                        },
                        loadFromEnd: async ({afterMessageIndex, beforeMessageIndex, limit}) => {
                            const {postCommentCount, postComments, otherReferencedPostComments} =
                                await getPostCommentsFromEnd(context, {
                                    postId: item.post.id,
                                    afterPostCommentIndex: afterMessageIndex,
                                    beforePostCommentIndex: beforeMessageIndex,
                                    limit,
                                });
                            return {
                                messageCount: postCommentCount,
                                messages: postComments,
                                otherReferencedMessages: otherReferencedPostComments,
                            };
                        },
                    });

                    if (result.isLoading) {
                        return {
                            isLoading: true,
                            promise: result.promise.then(result => {
                                setPosts(posts =>
                                    posts.updatePostComments(item.post.id, postComments =>
                                        postComments.loadMessages(result),
                                    ),
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

                            const lastPost = posts.getLastPostContentItem();

                            const {hasMorePosts, posts: newPosts} = await onLoadMorePosts({
                                limit,
                                afterCursor: lastPost
                                    ? {
                                          createdTime: lastPost.post.createdTime,
                                          postId: lastPost.post.id,
                                      }
                                    : undefined,
                            });

                            setPosts(posts =>
                                posts.insertManyPostsAtEnd(newPosts).setHasMorePosts(hasMorePosts),
                            );
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
                const lastLoadedMessage = item.postComments.getLastLoadedMessageBefore(limit);

                if (lastLoadedMessage === null || lastLoadedMessage.index < limit - 1) {
                    const {postCommentCount, postComments, otherReferencedPostComments} =
                        await getPostCommentsFromStart(context, {
                            postId: item.post.id,
                            afterPostCommentIndex: lastLoadedMessage?.index ?? null,
                            beforePostCommentIndex: null,
                            limit:
                                lastLoadedMessage !== null
                                    ? limit - (lastLoadedMessage.index + 1)
                                    : limit,
                        });

                    setPosts(posts =>
                        posts.updatePostComments(item.post.id, list =>
                            list.loadMessages({
                                messageCount: postCommentCount,
                                messages: postComments,
                                otherReferencedMessages: otherReferencedPostComments,
                            }),
                        ),
                    );
                }

                isLoadingRef.current = false;
            } catch (error) {
                setErrorState({hasError: true, error});
            }
        },
    );

    // Post realtime is managed by the `usePostRealtime()` hook in the
    // `<PostCommentInput>` component since the `<PostCommentInput>` component is
    // always mounted when the post's comments are open. Since we need realtime
    // actions in every part of the post we have `usePostRealtime()` stash actions
    // in this ref so they can be called elsewhere.
    const actionsByPostIdRef = useRef(new Map<PostId, PostRealtimeActions>());

    // Manages the editable message.
    //
    // This is at the post list level because:
    //
    // 1. If a message is scrolled out of the virtualization window we still want
    //    it to be editable so it shouldn't lose state.
    //
    // 2. We want only one message to be editable at a time.
    const messageEditing = useMessageEditing<PostId>({
        onUpdateMessageContent: async ({roomKey, messageIndex, content}) => {
            const actions = actionsByPostIdRef.current.get(roomKey);
            if (!actions) throw new InternalError("Post realtime hook isn't mounted");

            await actions.updatePostCommentContent({
                postCommentIndex: messageIndex,
                content,
            });
        },
    });

    // Manages the post which is currently being editing in `<PostEditorModal>`.
    const [editingPost, setEditingPost] = useState<PostModel | null>(null);

    // Manages which comment `<PostCommentInput>` is currently replying to.
    const [replyingToPostCommentIndexByPostId, setReplyingToPostCommentIndexByPostId] = useState<
        ReadonlyMap<PostId, number>
    >(new Map());

    // A comment to highlight for the user. We currently highlight comments with a
    // little wiggle animation (see `message_view.css.ts` for more information). We
    // highlight comments when initially loading a page with a comment index in the
    // URL and when the user clicks on a reply preview to jump to it.
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
    const handleJumpToPostComment = useEvent((postId: PostId, postCommentIndex: number) => {
        // If we are in the process of jumping, don't start another jump
        if (isJumpingToPostCommentRef.current) return;

        const view = assertExists(viewRef.current);

        const scrollToIndex = posts.getPostById(postId).getPostCommentIndex(postCommentIndex);

        const peekRenderedRange = view.peekRenderedRangeAfterScrollToIndex(scrollToIndex);
        const result = tryLoadingMoreData(peekRenderedRange);

        if (!result.isLoading) {
            view.scrollToIndex(scrollToIndex);

            setHighlightPostComment({
                postId,
                postCommentIndex,
                shouldHighlightRef: {current: true},
            });
        } else {
            isJumpingToPostCommentRef.current = true;

            Promise.race([result.promise, wait(delayLoadingIndicatorLimitMs)]).finally(() => {
                isJumpingToPostCommentRef.current = false;

                view.scrollToIndex(scrollToIndex);

                setHighlightPostComment({
                    postId,
                    postCommentIndex,
                    shouldHighlightRef: {current: true},
                });
            });
        }
    });

    useImperativeHandle(
        ref,
        () => ({
            jumpToPostComment: handleJumpToPostComment,
        }),
        [handleJumpToPostComment],
    );

    const renderItem: VirtualizedScrollViewRenderItem = useCallback(
        index => {
            const item = posts.getItem(index);
            switch (item.type) {
                case "ChannelHeader": {
                    return {
                        key: "ChannelHeader",
                        minHeight: addRemLengths(
                            spacing[postListViewMarginY],
                            channelViewHeaderMinHeight,
                            spacing[postListViewMarginBottom],
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
                                        overflowX: "hidden",
                                        paddingX: hasMargin ? postListViewMarginX : undefined,
                                        paddingTop: postListViewMarginY,
                                        paddingBottom:
                                            index + 1 < posts.getItemCount()
                                                ? postListViewMarginBottom
                                                : postListViewMarginY,
                                    })}
                                    style={{
                                        maxWidth: postViewMaxWidthWithMarginXRem,
                                        flex: postViewFlex,
                                    }}
                                >
                                    <ChannelViewHeader
                                        channelHeader={item.channelHeader}
                                        onCreatePost={post =>
                                            setPosts(posts => posts.insertPostAtStart(post))
                                        }
                                        parentHasMargin={hasMargin}
                                    />
                                </div>
                                {hasAside && (
                                    <div
                                        style={{
                                            width: "100%",
                                            maxWidth: postListViewAsideMaxWidthWithMarginXRem,
                                            flex: postListViewAsideFlex,
                                        }}
                                    />
                                )}
                            </div>
                        ),
                    };
                }
                case "PostContent": {
                    let minHeight: RemLength = postContentViewMinHeight;

                    const marginTop =
                        index === 0
                            ? hasMargin
                                ? postListViewMarginY
                                : undefined
                            : postListViewMarginTop;

                    const marginBottom =
                        item.postCommentsState === "Closed"
                            ? index === posts.getItemCount() - 1
                                ? hasMargin
                                    ? postListViewMarginY
                                    : undefined
                                : postListViewMarginBottom
                            : undefined;

                    if (marginTop) minHeight = addRemLengths(minHeight, spacing[marginTop]);
                    if (marginBottom) minHeight = addRemLengths(minHeight, spacing[marginBottom]);

                    return {
                        key: `PostContent:${item.post.id}`,
                        minHeight,
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
                                        overflowX: "hidden",
                                        paddingX: hasMargin ? postListViewMarginX : undefined,
                                        paddingTop: marginTop,
                                        paddingBottom: marginBottom,
                                    })}
                                    style={{
                                        maxWidth: postViewMaxWidthWithMarginXRem,
                                        flex: postViewFlex,
                                    }}
                                >
                                    <div
                                        className={sprinkles({
                                            width: "full",
                                            backgroundColor: "grey-0",
                                            borderTopRadius: hasMargin ? "md" : undefined,
                                            borderBottomRadius:
                                                hasMargin && item.postCommentsState === "Closed"
                                                    ? "md"
                                                    : undefined,
                                            boxShadow: "elevation-5",
                                        })}
                                    >
                                        <PostContentView
                                            post={item.post}
                                            postComments={item.postComments}
                                            postCommentsState={item.postCommentsState}
                                            onEditPost={() => setEditingPost(item.post)}
                                            onTogglePostComments={() =>
                                                setPosts(posts => posts.togglePostComments(index))
                                            }
                                            onLoadInitialPostComments={() =>
                                                loadInitialPostComments(item)
                                            }
                                        />
                                    </div>
                                </div>
                                {hasAside && (
                                    <div
                                        style={{
                                            width: "100%",
                                            maxWidth: postListViewAsideMaxWidthWithMarginXRem,
                                            flex: postListViewAsideFlex,
                                        }}
                                    />
                                )}
                            </div>
                        ),
                        renderAdditionalItemIndexes:
                            item.postCommentInputItemIndex !== null &&
                            !isSingleMobilePostWithPinnedCommentInput
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

                    const actuallyRender = (
                        disableExpensiveFeaturesDuringScroll: boolean,
                    ): ReactElement => {
                        const messageNode =
                            item.type === "LoadedPostComment" ||
                            item.type === "OptimisticPostComment" ? (
                                <MessageView
                                    messageNoun="comment"
                                    message={item.postComment}
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
                                                    new Map(replyingToPostCommentIndexByPostId);
                                                newReplyingToPostCommentIndexByPostId.set(
                                                    item.post.id,
                                                    postCommentIndex,
                                                );
                                                return newReplyingToPostCommentIndexByPostId;
                                            },
                                        );
                                    }}
                                    onDeleteMessage={async () => {
                                        const actions = actionsByPostIdRef.current.get(
                                            item.post.id,
                                        );
                                        if (!actions)
                                            throw new InternalError(
                                                "Post realtime hook isn't mounted",
                                            );

                                        await actions.deletePostComment({
                                            postCommentIndex: item.postCommentIndex,
                                        });
                                    }}
                                    disableExpensiveFeaturesDuringScroll={
                                        disableExpensiveFeaturesDuringScroll
                                    }
                                    getCopyLinkUrl={messageIndex => {
                                        return new URL(
                                            `/s/${item.post.spaceId}/posts/${item.post.id}?comment=${messageIndex}`,
                                            window.location.href,
                                        );
                                    }}
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
                                        width: "full",
                                        paddingX: hasMargin ? postListViewMarginX : undefined,
                                        overflow: "hidden",
                                    })}
                                    style={{
                                        maxWidth: postViewMaxWidthWithMarginXRem,
                                        flex: postViewFlex,
                                    }}
                                >
                                    <div
                                        className={sprinkles({
                                            width: "full",
                                            backgroundColor: "grey-0",
                                            boxShadow: "elevation-5",
                                            paddingX: "2",
                                        })}
                                    >
                                        {item.postCommentIndex === 0 ? (
                                            <>
                                                <Spacer space="3" />
                                                {messageNode}
                                            </>
                                        ) : (
                                            messageNode
                                        )}
                                    </div>
                                </div>
                                {hasAside && (
                                    <div
                                        style={{
                                            width: "100%",
                                            maxWidth: postListViewAsideMaxWidthWithMarginXRem,
                                            flex: postListViewAsideFlex,
                                        }}
                                    />
                                )}
                            </div>
                        );
                    };

                    // It's important to reuse nodes across renders because then React won't try to
                    // re-render the component.
                    let nodeWithExpensiveFeaturesDisabled: ReactElement | null = null;
                    let nodeWithoutExpensiveFeaturesDisabled: ReactElement | null = null;

                    const render = (isScrolling: boolean) => {
                        // If we already rendered the node without expensive features disabled, don't
                        // render a new version since that will cause a frame drop right at the start
                        // of the scroll as React re-renders every message.
                        if (nodeWithoutExpensiveFeaturesDisabled !== null)
                            return nodeWithoutExpensiveFeaturesDisabled;

                        if (isScrolling) {
                            nodeWithExpensiveFeaturesDisabled ??= actuallyRender(true);
                            return nodeWithExpensiveFeaturesDisabled;
                        } else {
                            nodeWithoutExpensiveFeaturesDisabled ??= actuallyRender(false);
                            return nodeWithoutExpensiveFeaturesDisabled;
                        }
                    };

                    return {
                        key:
                            item.type === "LoadedPostComment"
                                ? `PostComment:${item.post.id}:${item.postComment.index}`
                                : item.type === "OptimisticPostComment"
                                ? `PostComment:${item.post.id}:${item.postCommentIndex}`
                                : `UnloadedPostComment:${item.post.id}:${item.postCommentIndex}`,
                        minHeight: messageViewMinHeight,
                        renderAdditionalItemIndexes: !isSingleMobilePostWithPinnedCommentInput
                            ? [item.postCommentInputItemIndex]
                            : [],
                        withManualLayout: true,
                        render: ({
                            ref,
                            shouldRenderWithRelativePositioning,
                            offset,
                            isScrolling,
                        }) => (
                            <div
                                ref={ref}
                                style={{
                                    minHeight: messageViewMinHeight,
                                    ...(shouldRenderWithRelativePositioning
                                        ? {position: "relative"}
                                        : {
                                              position: "absolute",
                                              top: offset,
                                              left: 0,
                                              right: 0,
                                          }),
                                }}
                            >
                                {render(isScrolling)}
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
                // the effect if while scrolling the comment input is a layer on top of the post
                // and when at the bottom of the post the comment input is inline.
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
                            actionsRef={actions => {
                                if (actions) {
                                    actionsByPostIdRef.current.set(item.post.id, actions);
                                } else {
                                    actionsByPostIdRef.current.delete(item.post.id);
                                }
                            }}
                            postComments={item.postComments}
                            onUpdatePostComments={update =>
                                setPosts(posts => posts.updatePostComments(item.post.id, update))
                            }
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
                            onJumpToPostComment={index =>
                                handleJumpToPostComment(item.post.id, index)
                            }
                        />
                    );

                    const marginBottom =
                        index === posts.getItemCount() - 1
                            ? hasMargin
                                ? postListViewMarginY
                                : "0"
                            : postListViewMarginBottom;

                    return {
                        key: `PostCommentInput:${item.post.id}`,
                        minHeight: addRemLengths(postCommentInputMinHeight, spacing[marginBottom]),
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
                                <>
                                    {!shouldRenderWithRelativePositioning && (
                                        <div
                                            style={{
                                                position: "absolute",
                                                top: offset,
                                                left: 0,
                                                right: 0,
                                            }}
                                        >
                                            <div
                                                className={sprinkles({
                                                    display: "flex",
                                                    justifyContent: "center",
                                                    overflow: "hidden",
                                                })}
                                                style={{height, flex: postViewFlex}}
                                            >
                                                <div
                                                    className={sprinkles({
                                                        width: "full",
                                                        overflowX: "hidden",
                                                        paddingX: hasMargin
                                                            ? postListViewMarginX
                                                            : undefined,
                                                        paddingBottom: marginBottom,
                                                    })}
                                                    style={{
                                                        maxWidth: postViewMaxWidthWithMarginXRem,
                                                        flex: postViewFlex,
                                                    }}
                                                >
                                                    <div
                                                        className={sprinkles({
                                                            width: "full",
                                                            height: "full",
                                                            paddingX: "5",
                                                            backgroundColor: "grey-0",
                                                            borderBottomRadius: hasMargin
                                                                ? "md"
                                                                : undefined,
                                                            boxShadow: "elevation-5",
                                                        })}
                                                    >
                                                        <div
                                                            className={sprinkles({
                                                                width: "full",
                                                                borderTop: "grey-5",
                                                            })}
                                                        />
                                                    </div>
                                                </div>
                                                {hasAside && (
                                                    <div
                                                        style={{
                                                            width: "100%",
                                                            maxWidth:
                                                                postListViewAsideMaxWidthWithMarginXRem,
                                                            flex: postListViewAsideFlex,
                                                        }}
                                                    />
                                                )}
                                            </div>
                                        </div>
                                    )}
                                    <div
                                        style={{
                                            pointerEvents: "none",
                                            display: "flex",
                                            justifyContent: "center",
                                            alignItems: "flex-end",
                                            zIndex: "20",
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
                                                    bottom: `-${spacing[marginBottom]}`,
                                                }),
                                            }}
                                            className={sprinkles({
                                                width: "full",
                                                overflowX: "hidden",
                                                display: "flex",
                                                justifyContent: "center",
                                            })}
                                        >
                                            <div
                                                className={sprinkles({
                                                    width: "full",
                                                    overflowX: "hidden",
                                                    paddingX: hasMargin
                                                        ? postListViewMarginX
                                                        : undefined,
                                                    paddingBottom: marginBottom,
                                                })}
                                                style={{
                                                    maxWidth: postViewMaxWidthWithMarginXRem,
                                                    flex: postViewFlex,
                                                }}
                                            >
                                                <div
                                                    className={sprinkles({
                                                        display: "flex",
                                                        pointerEvents: "auto",
                                                        ...(shouldRenderWithRelativePositioning && {
                                                            // When absolutely positioned we render an element underneath this one at the
                                                            // end of the post so that while sticky scrolling we don't have double shadows.
                                                            backgroundColor: "grey-0",
                                                            borderBottomRadius: hasMargin
                                                                ? "md"
                                                                : undefined,
                                                            boxShadow: "elevation-5",
                                                        }),
                                                    })}
                                                    style={{
                                                        // Allow full-width top border to be visible until it slides under.
                                                        paddingTop:
                                                            !shouldRenderWithRelativePositioning
                                                                ? 1
                                                                : 0,
                                                    }}
                                                >
                                                    <div
                                                        className={sprinkles({
                                                            position: "relative",
                                                            flexGrow: "1",
                                                            overflowX: "hidden",
                                                            backgroundColor: "grey-0",
                                                            borderBottomRadius: hasMargin
                                                                ? "md"
                                                                : undefined,
                                                        })}
                                                        style={{
                                                            // Remove one pixel from top to make space for for border.
                                                            paddingTop:
                                                                !shouldRenderWithRelativePositioning
                                                                    ? `calc(${spacing["3"]} - 1px)`
                                                                    : spacing["3"],
                                                            paddingBottom: spacing["3"],
                                                        }}
                                                    >
                                                        {shouldRenderWithRelativePositioning && (
                                                            <div
                                                                className={sprinkles({
                                                                    position: "absolute",
                                                                    top: "0",
                                                                    left: "5",
                                                                    right: "5",
                                                                    borderTop: "grey-5",
                                                                })}
                                                            />
                                                        )}
                                                        {inputNode}
                                                    </div>
                                                </div>
                                            </div>
                                            {hasAside && (
                                                <div
                                                    style={{
                                                        width: "100%",
                                                        maxWidth:
                                                            postListViewAsideMaxWidthWithMarginXRem,
                                                        flex: postListViewAsideFlex,
                                                    }}
                                                />
                                            )}
                                        </div>
                                    </div>
                                    {!shouldRenderWithRelativePositioning && (
                                        <>
                                            <div
                                                // Render a white backdrop below the entire post so that when the user is jump
                                                // scrolling we don't have the pinned comment input and the wash
                                                // background color.
                                                className={sprinkles({
                                                    position: "absolute",
                                                    left: "0",
                                                    right: "0",
                                                    display: "flex",
                                                    justifyContent: "center",
                                                    zIndex: "-10",
                                                })}
                                                style={{
                                                    top: `calc(${
                                                        postContentOffsetEnd -
                                                        postContentPosition.height +
                                                        1
                                                    }px + ${
                                                        item.postContentItemIndex === 0
                                                            ? spacing[postListViewMarginY]
                                                            : spacing[postListViewMarginTop]
                                                    })`,
                                                    height: `calc(${
                                                        offset -
                                                        postContentOffsetEnd +
                                                        postContentPosition.height
                                                    }px - ${
                                                        item.postContentItemIndex === 0
                                                            ? spacing[postListViewMarginY]
                                                            : spacing[postListViewMarginTop]
                                                    })`,
                                                }}
                                            >
                                                <div
                                                    className={sprinkles({
                                                        width: "full",
                                                        paddingX: hasMargin
                                                            ? postListViewMarginX
                                                            : undefined,
                                                        overflowX: "hidden",
                                                    })}
                                                    style={{
                                                        maxWidth: postViewMaxWidthWithMarginXRem,
                                                        flex: postViewFlex,
                                                    }}
                                                >
                                                    <div
                                                        className={sprinkles({
                                                            width: "full",
                                                            height: "full",
                                                            backgroundColor: "grey-0",
                                                            borderTopRadius: hasMargin
                                                                ? "md"
                                                                : undefined,
                                                        })}
                                                    />
                                                </div>
                                                {hasAside && (
                                                    <div
                                                        style={{
                                                            width: "100%",
                                                            maxWidth:
                                                                postListViewAsideMaxWidthWithMarginXRem,
                                                            flex: postListViewAsideFlex,
                                                        }}
                                                    />
                                                )}
                                            </div>
                                            <div
                                                style={{
                                                    position: "absolute",
                                                    top: postContentOffsetEnd,
                                                    left: "0",
                                                    right: "0",
                                                    height:
                                                        offset - postContentOffsetEnd + height + 1,
                                                    pointerEvents: "none",
                                                    display: "flex",
                                                    justifyContent: "center",
                                                    alignItems: "flex-end",
                                                    zIndex: "10",
                                                }}
                                            >
                                                <div
                                                    style={{
                                                        position: "sticky",
                                                        bottom: `-${spacing[marginBottom]}`,
                                                        height,
                                                    }}
                                                    className={sprinkles({
                                                        width: "full",
                                                        overflowX: "hidden",
                                                        display: "flex",
                                                        justifyContent: "center",
                                                        paddingBottom: marginBottom,
                                                    })}
                                                >
                                                    <div
                                                        className={sprinkles({
                                                            width: "full",
                                                            paddingX: hasMargin
                                                                ? postListViewMarginX
                                                                : undefined,
                                                            overflowX: "hidden",
                                                        })}
                                                        style={{
                                                            maxWidth:
                                                                postViewMaxWidthWithMarginXRem,
                                                            flex: postViewFlex,
                                                        }}
                                                    >
                                                        <div
                                                            className={sprinkles({
                                                                width: "full",
                                                                borderTop: "grey-10",
                                                            })}
                                                            style={{flex: postViewFlex}}
                                                        />
                                                    </div>
                                                    {hasAside && (
                                                        <div
                                                            style={{
                                                                width: "100%",
                                                                maxWidth:
                                                                    postListViewAsideMaxWidthWithMarginXRem,
                                                                flex: postListViewAsideFlex,
                                                            }}
                                                        />
                                                    )}
                                                </div>
                                            </div>
                                        </>
                                    )}
                                </>
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
                                        overflowX: "hidden",
                                        paddingX: hasMargin ? postListViewMarginX : undefined,
                                        paddingTop: postListViewMarginTop,
                                    })}
                                    style={{
                                        maxWidth: postViewMaxWidthWithMarginXRem,
                                        flex: postViewFlex,
                                    }}
                                >
                                    <PostShimmer parentHasMargin={hasMargin} />
                                    <Spacer space={postListViewMarginY} />
                                    <PostShimmer parentHasMargin={hasMargin} />
                                    <Spacer space={postListViewMarginY} />
                                    <PostShimmer parentHasMargin={hasMargin} />
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
                                        style={{
                                            width: "100%",
                                            maxWidth: postListViewAsideMaxWidthWithMarginXRem,
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
            hasMargin,
            hasAside,
            isSingleMobilePostWithPinnedCommentInput,
            loadInitialPostComments,
            messageEditing,
            highlightPostComment,
            handleJumpToPostComment,
            replyingToPostCommentIndexByPostId,
        ],
    );

    return (
        <>
            <div
                ref={viewContainerRef}
                className={sprinkles({
                    width: "full",
                    height: "full",
                    overflow: "hidden",
                    position: "relative",
                    display: "flex",
                    flexDirection: "column",
                    backgroundColor: isSingleMobilePostWithPinnedCommentInput
                        ? "grey-0"
                        : undefined,
                })}
            >
                <VirtualizedScrollView
                    ref={viewRef}
                    bufferedItemHeight={bufferedPostViewHeight}
                    itemCount={
                        // Don't render the post comment input (which should be the last item) if we are
                        // pinning the comment input to the bottom of the view.
                        posts.getItemCount() - (isSingleMobilePostWithPinnedCommentInput ? 1 : 0)
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

                        setScrollDirectionState(scrollDirectionState => {
                            const newScrollDirection =
                                scrollOffset > lastScrollOffset ? "Down" : "Up";

                            if (scrollDirectionState.scrollDirection === newScrollDirection)
                                return scrollDirectionState;

                            if (newScrollDirection === "Down") {
                                const asideScrollOffset = clamp(
                                    0,
                                    scrollOffset - scrollDirectionState.asideBufferedHeight,
                                    asideHeight - viewHeight,
                                );

                                const asideBufferedHeight = scrollOffset - asideScrollOffset;

                                return {
                                    scrollDirection: "Down",
                                    asideBufferedHeight,
                                };
                            } else {
                                const asideScrollOffset =
                                    clamp(
                                        scrollDirectionState.asideBufferedHeight -
                                            (asideHeight - viewHeight),
                                        scrollOffset,
                                        scrollDirectionState.asideBufferedHeight +
                                            (asideHeight - viewHeight),
                                    ) - scrollDirectionState.asideBufferedHeight;

                                const asideBufferedHeight = scrollOffset - asideScrollOffset;

                                return {
                                    scrollDirection: "Up",
                                    asideBufferedHeight,
                                };
                            }
                        });
                    }}
                    extraChildren={
                        hasAside && (
                            <>
                                <div style={{height: scrollDirectionState.asideBufferedHeight}} />
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
                                                          ? -(asideSize.height - viewSize.height)
                                                          : 0,
                                              }
                                            : {
                                                  bottom:
                                                      viewSize && asideSize
                                                          ? -(asideSize.height - viewSize.height)
                                                          : 0,
                                              }),
                                        left: 0,
                                        right: 0,
                                    }}
                                >
                                    <div
                                        className={sprinkles({
                                            width: "full",
                                            paddingX: postListViewMarginX,
                                            overflowX: "hidden",
                                        })}
                                        style={{
                                            maxWidth: postViewMaxWidthWithMarginXRem,
                                            flex: postViewFlex,
                                        }}
                                    />
                                    <div
                                        style={{
                                            width: "100%",
                                            maxWidth: postListViewAsideMaxWidthWithMarginXRem,
                                            flex: postListViewAsideFlex,
                                        }}
                                    >
                                        <aside
                                            ref={asideRef}
                                            className={sprinkles({
                                                pointerEvents: "auto",
                                                paddingRight: postListViewMarginX,
                                            })}
                                            style={{minHeight: viewSize?.height}}
                                        >
                                            {aside}
                                        </aside>
                                    </div>
                                </div>
                            </>
                        )
                    }
                />
                {isSingleMobilePostWithPinnedCommentInput &&
                    (() => {
                        const lastPostContentItem = assertExists(posts.getLastPostContentItem());

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
                            <div
                                className={sprinkles({
                                    flexShrink: "0",
                                    borderTop: "grey-10",
                                })}
                                style={{
                                    // Remove one pixel from top to make space for for border.
                                    paddingTop: `calc(${spacing["3"]} - 1px)`,
                                    paddingBottom: spacing["3"],
                                }}
                            >
                                <PostCommentInput
                                    post={lastPostContentItem.post}
                                    viewRef={viewRef}
                                    actionsRef={actions => {
                                        if (actions) {
                                            actionsByPostIdRef.current.set(
                                                lastPostContentItem.post.id,
                                                actions,
                                            );
                                        } else {
                                            actionsByPostIdRef.current.delete(
                                                lastPostContentItem.post.id,
                                            );
                                        }
                                    }}
                                    postComments={lastPostContentItem.postComments}
                                    onUpdatePostComments={update =>
                                        setPosts(posts =>
                                            posts.updatePostComments(
                                                lastPostContentItem.post.id,
                                                update,
                                            ),
                                        )
                                    }
                                    replyingToPostComment={replyingToPostComment}
                                    onClearReplyingToPostComment={() => {
                                        setReplyingToPostCommentIndexByPostId(
                                            replyingToPostCommentIndexByPostId => {
                                                const newReplyingToPostCommentIndexByPostId =
                                                    new Map(replyingToPostCommentIndexByPostId);
                                                newReplyingToPostCommentIndexByPostId.delete(
                                                    lastPostContentItem.post.id,
                                                );
                                                return newReplyingToPostCommentIndexByPostId;
                                            },
                                        );
                                    }}
                                    onJumpToPostComment={index =>
                                        handleJumpToPostComment(lastPostContentItem.post.id, index)
                                    }
                                />
                            </div>
                        );
                    })()}
            </div>
            {editingPost && (
                <PostEditorModal
                    post={editingPost}
                    onUpdatePost={update =>
                        setPosts(posts => posts.updatePost(editingPost.id, update))
                    }
                    onClose={() => setEditingPost(null)}
                />
            )}
        </>
    );
}
