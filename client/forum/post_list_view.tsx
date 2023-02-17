import {SpinnerGap} from "phosphor-react";
import {
    Memo,
    MutableRefObject,
    ReactElement,
    ReactNode,
    useCallback,
    useEffect,
    useRef,
    useState,
} from "react";
import {useAppContext} from "~/client/context/app_context";
import {getRemPxWithoutListening} from "~/client/design/helpers/use_rem_px";
import {Spacer} from "~/client/design/spacer";
import {delayLoadingIndicatorLimitMs} from "~/client/design/timing_constants";
import {ChannelViewHeader, channelViewHeaderMinHeight} from "~/client/forum/channel_view_header";
import {PostCommentInput} from "~/client/forum/post_comment_input";
import {PostContentView, postContentViewMinHeight} from "~/client/forum/post_content_view";
import {PostEditorModal} from "~/client/forum/post_editor_modal";
import {PostList, PostListChannelHeader, PostListPostContentItem} from "~/client/forum/post_list";
import {PostShimmer} from "~/client/forum/post_shimmer";
import {PostRealtimeActions} from "~/client/forum/use_post_realtime";
import {useEvent} from "~/client/helpers/lifecycle/use_event";
import {useIsMobile} from "~/client/helpers/use_is_mobile";
import {useResizeObserver} from "~/client/helpers/use_resize_observer";
import {useMessageEditing} from "~/client/messaging/message_editing";
import {MessageShimmer} from "~/client/messaging/message_shimmer";
import {MessageView, messageViewMinHeight} from "~/client/messaging/message_view";
import {getInitialLoadMessageCount} from "~/client/messaging/messaging_view";
import {tryLoadingMessages} from "~/client/messaging/try_loading_messages";
import {getClientInfoWithoutListening} from "~/client/remix/client_info_context";
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
    parseRemLengthNumber,
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

export const postListViewMargin: Spacing = "3";

const halfPostListViewMarginRem: RemLength = `${
    parseRemLengthNumber(spacing[postListViewMargin]) / 2
}rem`;

export const postViewMaxWidth: Spacing = "160";

const postViewMaxWidthWithMarginsRem = addRemLengths(
    spacing[postListViewMargin],
    spacing[postViewMaxWidth],
    spacing[postListViewMargin],
);

export const postListViewAsideMaxWidth: Spacing = "64";

const postListViewAsideMaxWidthWithMarginsRem = addRemLengths(
    spacing[postListViewAsideMaxWidth],
    spacing[postListViewMargin],
);

const postViewFlex = 7;
const postListViewAsideFlex = 3;

/**
 * The buffered height of an item in the post view virtualized list is the minimum
 * height of a single post.
 */
const bufferedPostViewHeight = addRemLengths(postContentViewMinHeight, spacing[postListViewMargin]);

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

export function PostListView({
    channelHeader,
    initialPostsResult,
    onLoadMorePosts,
    aside,
}: {
    channelHeader?: Memo<PostListChannelHeader>;
    initialPostsResult:
        | {
              type: "Many";
              hasMorePosts: boolean;
              posts: ReadonlyArray<PostModel>;
          }
        | {
              type: "One";
              post: PostModel;
              arePostCommentsOpen?: boolean;
              initialLoadPostComments?: {
                  comments: ReadonlyArray<PostCommentModel>;
                  otherReferencedComments: ReadonlyArray<PostCommentModel>;
              };
          };
    onLoadMorePosts?: (options: {
        limit: number;
        afterCursor?: {createdTime: Date; postId: PostId};
    }) => Promise<{
        hasMorePosts: boolean;
        posts: ReadonlyArray<PostModel>;
    }>;
    aside?: ReactNode;
}) {
    const isMobile = useIsMobile();
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
                while (nextIndex <= renderedRange.startIndex) {
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

                    setPosts(posts =>
                        posts.updatePostComments(item.post.id, postComments =>
                            postComments.loadMessages({
                                messageCount: commentCount,
                                messages: comments,
                                otherReferencedMessages: otherReferencedComments,
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
                commentIndex: messageIndex,
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

        const scrollToIndex = posts.getItemCountBeforePostId(postId) + 1 + postCommentIndex;

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

    const renderItem: VirtualizedScrollViewRenderItem = useCallback(
        index => {
            const item = posts.getItem(index);
            switch (item.type) {
                case "ChannelHeader": {
                    return {
                        key: "ChannelHeader",
                        minHeight: addRemLengths(
                            spacing[postListViewMargin],
                            channelViewHeaderMinHeight,
                            halfPostListViewMarginRem,
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
                                        paddingX: postListViewMargin,
                                        overflowX: "hidden",
                                    })}
                                    style={{
                                        maxWidth: postViewMaxWidthWithMarginsRem,
                                        flex: postViewFlex,
                                        paddingTop: spacing[postListViewMargin],
                                        paddingBottom: halfPostListViewMarginRem,
                                    }}
                                >
                                    <ChannelViewHeader
                                        channelHeader={item.channelHeader}
                                        onCreatePost={post =>
                                            setPosts(posts => posts.insertPostAtStart(post))
                                        }
                                    />
                                </div>
                                {hasAside && (
                                    <div
                                        style={{
                                            width: "100%",
                                            maxWidth: postListViewAsideMaxWidthWithMarginsRem,
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

                    if (index === 0) {
                        minHeight = addRemLengths(minHeight, spacing[postListViewMargin]);
                    }

                    if (!item.arePostCommentsOpen) {
                        minHeight = addRemLengths(minHeight, spacing[postListViewMargin]);
                    }

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
                                        paddingX: postListViewMargin,
                                        overflowX: "hidden",
                                    })}
                                    style={{
                                        maxWidth: postViewMaxWidthWithMarginsRem,
                                        flex: postViewFlex,
                                        paddingTop:
                                            index === 0
                                                ? spacing[postListViewMargin]
                                                : halfPostListViewMarginRem,
                                        paddingBottom: !item.arePostCommentsOpen
                                            ? index === posts.getItemCount() - 1
                                                ? spacing[postListViewMargin]
                                                : halfPostListViewMarginRem
                                            : undefined,
                                    }}
                                >
                                    <div
                                        className={sprinkles({
                                            width: "full",
                                            backgroundColor: "grey-0",
                                            borderTopRadius: "md",
                                            borderBottomRadius: !item.arePostCommentsOpen
                                                ? "md"
                                                : undefined,
                                            boxShadow: "elevation-5",
                                        })}
                                    >
                                        <PostContentView
                                            post={item.post}
                                            postComments={item.postComments}
                                            arePostCommentsOpen={item.arePostCommentsOpen}
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
                                            maxWidth: postListViewAsideMaxWidthWithMarginsRem,
                                            flex: postListViewAsideFlex,
                                        }}
                                    />
                                )}
                            </div>
                        ),
                        renderAdditionalItemIndexes:
                            item.postCommentInputItemIndex !== null
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
                                    onJumpToMessage={index =>
                                        handleJumpToPostComment(item.post.id, index)
                                    }
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
                                            commentIndex: item.postCommentIndex,
                                        });
                                    }}
                                    disableExpensiveFeaturesDuringScroll={
                                        disableExpensiveFeaturesDuringScroll
                                    }
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
                                        paddingX: postListViewMargin,
                                        overflow: "hidden",
                                    })}
                                    style={{
                                        maxWidth: postViewMaxWidthWithMarginsRem,
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
                                            maxWidth: postListViewAsideMaxWidthWithMarginsRem,
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
                                ? `LoadedPostComment:${item.post.id}:${item.postComment.index}`
                                : item.type === "OptimisticPostComment"
                                ? `OptimisticPostComment:${item.post.id}:${item.optimisticPostCommentIndex}`
                                : `UnloadedPostComment:${item.post.id}:${item.postCommentIndex}`,
                        minHeight: messageViewMinHeight,
                        renderAdditionalItemIndexes: [item.postCommentInputItemIndex],
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

                    return {
                        key: `PostCommentInput:${item.post.id}`,
                        minHeight: addRemLengths("3.5rem", halfPostListViewMarginRem),
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

                            const paddingBottom =
                                index === posts.getItemCount() - 1
                                    ? spacing[postListViewMargin]
                                    : halfPostListViewMarginRem;

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
                                                        paddingX: postListViewMargin,
                                                        overflowX: "hidden",
                                                    })}
                                                    style={{
                                                        maxWidth: postViewMaxWidthWithMarginsRem,
                                                        flex: postViewFlex,
                                                        paddingBottom,
                                                    }}
                                                >
                                                    <div
                                                        className={sprinkles({
                                                            width: "full",
                                                            height: "full",
                                                            paddingX: "5",
                                                            backgroundColor: "grey-0",
                                                            borderBottomRadius: "md",
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
                                                                postListViewAsideMaxWidthWithMarginsRem,
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
                                                    bottom: `-${paddingBottom}`,
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
                                                    paddingX: postListViewMargin,
                                                    overflowX: "hidden",
                                                })}
                                                style={{
                                                    paddingBottom,
                                                    maxWidth: postViewMaxWidthWithMarginsRem,
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
                                                            borderBottomRadius: "md",
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
                                                            borderBottomRadius: "md",
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
                                                            postListViewAsideMaxWidthWithMarginsRem,
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
                                                            ? spacing[postListViewMargin]
                                                            : halfPostListViewMarginRem
                                                    })`,
                                                    height:
                                                        offset -
                                                        postContentOffsetEnd +
                                                        postContentPosition.height,
                                                }}
                                            >
                                                <div
                                                    className={sprinkles({
                                                        width: "full",
                                                        paddingX: postListViewMargin,
                                                        overflowX: "hidden",
                                                    })}
                                                    style={{
                                                        maxWidth: postViewMaxWidthWithMarginsRem,
                                                        flex: postViewFlex,
                                                    }}
                                                >
                                                    <div
                                                        className={sprinkles({
                                                            width: "full",
                                                            height: "full",
                                                            backgroundColor: "grey-0",
                                                            borderTopRadius: "md",
                                                        })}
                                                    />
                                                </div>
                                                {hasAside && (
                                                    <div
                                                        style={{
                                                            width: "100%",
                                                            maxWidth:
                                                                postListViewAsideMaxWidthWithMarginsRem,
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
                                                        paddingBottom,
                                                        bottom: `-${paddingBottom}`,
                                                        height,
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
                                                            paddingX: postListViewMargin,
                                                            overflowX: "hidden",
                                                        })}
                                                        style={{
                                                            maxWidth:
                                                                postViewMaxWidthWithMarginsRem,
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
                                                                    postListViewAsideMaxWidthWithMarginsRem,
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
                                        paddingX: postListViewMargin,
                                        overflowX: "hidden",
                                    })}
                                    style={{
                                        maxWidth: postViewMaxWidthWithMarginsRem,
                                        flex: postViewFlex,
                                        paddingTop: halfPostListViewMarginRem,
                                    }}
                                >
                                    <PostShimmer />
                                    <Spacer space={postListViewMargin} />
                                    <PostShimmer />
                                    <Spacer space={postListViewMargin} />
                                    <PostShimmer />
                                    <div
                                        className={sprinkles({
                                            display: "flex",
                                            justifyContent: "center",
                                            color: "grey-60",
                                            paddingY: postListViewMargin,
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
                                            maxWidth: postListViewAsideMaxWidthWithMarginsRem,
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
            hasAside,
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
                })}
            >
                <VirtualizedScrollView
                    ref={viewRef}
                    bufferedItemHeight={bufferedPostViewHeight}
                    itemCount={posts.getItemCount()}
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
                                            paddingX: postListViewMargin,
                                            overflowX: "hidden",
                                        })}
                                        style={{
                                            maxWidth: postViewMaxWidthWithMarginsRem,
                                            flex: postViewFlex,
                                        }}
                                    />
                                    <div
                                        style={{
                                            width: "100%",
                                            maxWidth: postListViewAsideMaxWidthWithMarginsRem,
                                            flex: postListViewAsideFlex,
                                        }}
                                    >
                                        <aside
                                            ref={asideRef}
                                            className={sprinkles({
                                                pointerEvents: "auto",
                                                paddingRight: postListViewMargin,
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
