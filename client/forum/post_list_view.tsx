import {SpinnerGap} from "phosphor-react";
import {ReactElement, useCallback, useEffect, useRef, useState} from "react";
import {useAppContext} from "~/client/context/app_context";
import {getRemPxWithoutListening} from "~/client/design/helpers/use_rem_px";
import {Spacer} from "~/client/design/spacer";
import {ChannelHeaderView, getChannelHeaderViewMinHeight} from "~/client/forum/channel_header_view";
import {PostCommentInput} from "~/client/forum/post_comment_input";
import {PostContentView, postContentViewMinHeight} from "~/client/forum/post_content_view";
import {PostEditorModal} from "~/client/forum/post_editor_modal";
import {PostList, PostListPostContentItem} from "~/client/forum/post_list";
import {PostShimmer} from "~/client/forum/post_shimmer";
import {PostRealtimeActions} from "~/client/forum/use_post_realtime";
import {useEvent} from "~/client/helpers/lifecycle/use_event";
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
    spacing,
} from "~/shared/design/spacing";
import {InternalError} from "~/shared/error/error";
import {runPromiseWithoutAwaiting} from "~/shared/helpers/async/run_promise_without_awaiting";
import {assert} from "~/shared/helpers/control/assert";
import {assertExists} from "~/shared/helpers/control/assert_exists";
import {exhaustive} from "~/shared/helpers/control/exhaustive";
import {areRangesOverlapping} from "~/shared/helpers/geometry/are_ranges_overlapping";
import {PostId} from "~/shared/id/types/id_types";
import {PostModel} from "~/shared/models/post_model";
import {getPostCommentsFromEnd, getPostCommentsFromStart} from "~/shared/rpc/forum_rpc_definitions";
import {spinAnimationClassName, sprinkles} from "~/shared/styles/styles";

export const postListViewMargin: Spacing = "3";

export const postMaxWidth: Spacing = "160";

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
    initialPosts,
    onLoadMorePosts,
}: {
    initialPosts: PostList | (() => PostList);
    onLoadMorePosts?: (options: {
        limit: number;
        afterCursor?: {createdTime: Date; postId: PostId};
    }) => Promise<{
        hasMorePosts: boolean;
        posts: ReadonlyArray<PostModel>;
    }>;
}) {
    const context = useAppContext();
    const viewRef = useRef<VirtualizedScrollViewRef>(null);

    const [posts, setPosts] = useState(initialPosts);

    const isLoadingRef = useRef(false);
    const [errorState, setErrorState] = useState<
        {hasError: false} | {hasError: true; error: unknown}
    >({hasError: false});

    if (errorState.hasError) throw errorState.error;

    const tryLoadingMorePostComments = useEvent(() => {
        // If we're already loading, don't try to load more comments.
        if (isLoadingRef.current) return;

        const view = assertExists(viewRef.current);
        const renderedRange = view.getRenderedRange();
        if (!renderedRange) return;

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
                onLoadFromStart: async ({afterMessageIndex, beforeMessageIndex, limit}) => {
                    const {commentCount, comments} = await getPostCommentsFromStart(context, {
                        postId: item.post.id,
                        afterCommentIndex: afterMessageIndex,
                        beforeCommentIndex: beforeMessageIndex,
                        limit,
                    });
                    return {
                        messageCount: commentCount,
                        messages: comments,
                    };
                },
                onLoadFromEnd: async ({afterMessageIndex, beforeMessageIndex, limit}) => {
                    const {commentCount, comments} = await getPostCommentsFromEnd(context, {
                        postId: item.post.id,
                        afterCommentIndex: afterMessageIndex,
                        beforeCommentIndex: beforeMessageIndex,
                        limit,
                    });
                    return {
                        messageCount: commentCount,
                        messages: comments,
                    };
                },
                onFinishLoadingMessages: result => {
                    isLoadingRef.current = false;
                    if (result.ok) {
                        setPosts(posts =>
                            posts.updatePostComments(item.post.id, postComments =>
                                postComments
                                    .setMessageCount(result.value.messageCount)
                                    .setMessages(result.value.messages),
                            ),
                        );
                    } else {
                        setErrorState({hasError: true, error: result.error});
                    }
                },
            });

            if (result.isLoading) {
                isLoadingRef.current = true;
                // If we started loading some comments, don't try to load anything else.
                // We only want to send one load request at a time.
                return;
            }
        }

        // If we are not loading any comments and the unloaded posts item is rendered,
        // try loading that...
        const renderedRangeEndItem = posts.getItem(renderedRange.endIndex);
        if (renderedRangeEndItem.type === "MoreUnloadedPosts") {
            isLoadingRef.current = true;
            runPromiseWithoutAwaiting(async () => {
                try {
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
                            ? {createdTime: lastPost.post.createdTime, postId: lastPost.post.id}
                            : undefined,
                    });

                    setPosts(posts =>
                        posts.insertManyPostsAtEnd(newPosts).setHasMorePosts(hasMorePosts),
                    );
                } catch (error) {
                    setErrorState({hasError: true, error});
                } finally {
                    isLoadingRef.current = false;
                }
            });
        }
    });

    // Whenever our list data changes, try loading more comments. In case our
    // rendered range stayed the same but we see some some unloaded comments.
    //
    // This effect should also fire when `tryLoadingMorePostComments()` completes
    // in case it didn't fully load the list.
    useEffect(() => {
        // eslint-disable-next-line @typescript-eslint/no-unused-expressions
        posts;

        tryLoadingMorePostComments();
    }, [posts, tryLoadingMorePostComments]);

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
                    const {commentCount, comments} = await getPostCommentsFromStart(context, {
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
                            postComments.setMessageCount(commentCount).setMessages(comments),
                        ),
                    );
                }

                isLoadingRef.current = false;
            } catch (error) {
                setErrorState({hasError: true, error});
            }
        },
    );

    const actionsByPostIdRef = useRef(new Map<PostId, PostRealtimeActions>());

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

    const [editingPost, setEditingPost] = useState<PostModel | null>(null);

    const renderItem: VirtualizedScrollViewRenderItem = useCallback(
        index => {
            const item = posts.getItem(index);
            switch (item.type) {
                case "ChannelHeader": {
                    return {
                        key: "ChannelHeader",
                        minHeight: getChannelHeaderViewMinHeight(),
                        node: (
                            <ChannelHeaderView
                                channelHeader={item.channelHeader}
                                onCreatePost={post =>
                                    setPosts(posts => posts.insertPostAtStart(post))
                                }
                            />
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
                            <>
                                {index === 0 && <Spacer space={postListViewMargin} />}
                                <div className={sprinkles({paddingX: postListViewMargin})}>
                                    <div
                                        className={sprinkles({
                                            marginX: "auto",
                                            maxWidth: postMaxWidth,
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
                                {!item.arePostCommentsOpen && <Spacer space={postListViewMargin} />}
                            </>
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
                                    messageEditing={messageEditing}
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
                                    paddingX: postListViewMargin,
                                    overflowY: "hidden",
                                })}
                            >
                                <div
                                    className={sprinkles({
                                        marginX: "auto",
                                        maxWidth: postMaxWidth,
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
                        />
                    );

                    return {
                        key: `PostCommentInput:${item.post.id}`,
                        minHeight: addRemLengths("3.5rem", spacing[postListViewMargin]),
                        withManualLayout: true,
                        stayCompletelyVisibleAfterResize: true,
                        render: ({
                            ref,
                            offset,
                            height,
                            shouldRenderWithRelativePositioning,
                            getIndexPosition,
                        }) => {
                            const postContentPosition = getIndexPosition(item.postContentItemIndex);

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
                                                    paddingX: postListViewMargin,
                                                    paddingBottom: postListViewMargin,
                                                    overflowY: "hidden",
                                                })}
                                                style={{height}}
                                            >
                                                <div
                                                    className={sprinkles({
                                                        marginX: "auto",
                                                        maxWidth: postMaxWidth,
                                                        height: "full",
                                                        backgroundColor: "grey-0",
                                                        borderBottomRadius: "md",
                                                        boxShadow: "elevation-5",
                                                    })}
                                                />
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
                                                      left: spacing[postListViewMargin],
                                                      right: spacing[postListViewMargin],
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
                                                    bottom: `-${spacing[postListViewMargin]}`,
                                                }),
                                            }}
                                            className={sprinkles({
                                                width: "full",
                                                overflowX: "hidden",
                                                paddingBottom: postListViewMargin,
                                            })}
                                        >
                                            <div
                                                className={sprinkles({
                                                    display: "flex",
                                                    width: "full",
                                                    maxWidth: postMaxWidth,
                                                    marginX: "auto",
                                                    overflowX: "hidden",
                                                    pointerEvents: "auto",
                                                    ...(shouldRenderWithRelativePositioning && {
                                                        // When absolutely positioned we render an element underneath this one at the
                                                        // end of the post so that while sticky scrolling we don't have double shadows.
                                                        backgroundColor: "grey-0",
                                                        borderBottomRadius: "md",
                                                        boxShadow: "elevation-5",
                                                    }),
                                                })}
                                            >
                                                <div
                                                    className={sprinkles({
                                                        flexShrink: "0",
                                                        alignSelf: "stretch",
                                                        width: "5",
                                                    })}
                                                    style={{
                                                        // Allow full-width top border to be visible until it slides under.
                                                        paddingTop: 1,
                                                    }}
                                                >
                                                    <div
                                                        className={sprinkles({
                                                            width: "full",
                                                            height: "full",
                                                            backgroundColor: "grey-0",
                                                            borderBottomLeftRadius: "md",
                                                        })}
                                                    />
                                                </div>
                                                <div
                                                    className={sprinkles({
                                                        flexGrow: "1",
                                                        overflowX: "hidden",
                                                        borderTop: "grey-5",
                                                        backgroundColor: "grey-0",
                                                    })}
                                                    style={{
                                                        // Remove one pixel from top padding for border.
                                                        paddingTop: `calc(${spacing["3"]} - 1px)`,
                                                        paddingBottom: spacing["3"],
                                                    }}
                                                >
                                                    {inputNode}
                                                </div>
                                                <div
                                                    className={sprinkles({
                                                        flexShrink: "0",
                                                        alignSelf: "stretch",
                                                        width: "5",
                                                    })}
                                                    style={{
                                                        // Allow full-width top border to be visible until it slides under.
                                                        paddingTop: 1,
                                                    }}
                                                >
                                                    <div
                                                        className={sprinkles({
                                                            width: "full",
                                                            height: "full",
                                                            backgroundColor: "grey-0",
                                                            borderBottomRightRadius: "md",
                                                        })}
                                                    />
                                                </div>
                                            </div>
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
                                                    left: postListViewMargin,
                                                    right: postListViewMargin,
                                                    maxWidth: postMaxWidth,
                                                    marginX: "auto",
                                                    backgroundColor: "grey-0",
                                                    zIndex: "-10",
                                                    borderTopRadius: "md",
                                                })}
                                                style={{
                                                    width: `calc(100% - ${spacing[postListViewMargin]} * 2)`,
                                                    top:
                                                        item.postContentItemIndex === 0
                                                            ? `calc(${
                                                                  postContentOffsetEnd -
                                                                  postContentPosition.height +
                                                                  1
                                                              }px + ${spacing[postListViewMargin]})`
                                                            : postContentOffsetEnd -
                                                              postContentPosition.height +
                                                              1,
                                                    height:
                                                        offset -
                                                        postContentOffsetEnd +
                                                        postContentPosition.height,
                                                }}
                                            />
                                            <div
                                                style={{
                                                    position: "absolute",
                                                    top: postContentOffsetEnd,
                                                    left: spacing[postListViewMargin],
                                                    right: spacing[postListViewMargin],
                                                    height:
                                                        offset - postContentOffsetEnd + height + 1,
                                                    pointerEvents: "none",
                                                    display: "flex",
                                                    alignItems: "flex-end",
                                                    zIndex: "10",
                                                }}
                                            >
                                                <div
                                                    style={{
                                                        position: "sticky",
                                                        bottom: `-${spacing[postListViewMargin]}`,
                                                        height,
                                                    }}
                                                    className={sprinkles({
                                                        width: "full",
                                                        maxWidth: postMaxWidth,
                                                        marginX: "auto",
                                                        borderTop: "grey-5",
                                                    })}
                                                />
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
                        minHeight: "36.875rem",
                        node: (
                            <div className={sprinkles({paddingX: postListViewMargin})}>
                                <div
                                    className={sprinkles({
                                        width: "full",
                                        maxWidth: postMaxWidth,
                                        marginX: "auto",
                                    })}
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
                            </div>
                        ),
                    };
                }
                default:
                    throw exhaustive(item);
            }
        },
        [posts, loadInitialPostComments, messageEditing],
    );

    return (
        <>
            <VirtualizedScrollView
                ref={viewRef}
                bufferedItemHeight={bufferedPostViewHeight}
                itemCount={posts.getItemCount()}
                renderItem={renderItem}
                onRenderedRangeChange={tryLoadingMorePostComments}
            />
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
