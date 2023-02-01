import {useCallback, useEffect, useRef, useState} from "react";
import {useAppContext} from "~/client/context/app_context";
import {Box} from "~/client/design/box";
import {Spacer} from "~/client/design/spacer";
import {useEvent} from "~/client/helpers/lifecycle/use_event";
import {MessageShimmer} from "~/client/messaging/message_shimmer";
import {MessageView, messageViewMinHeight} from "~/client/messaging/message_view";
import {getInitialLoadMessageCount} from "~/client/messaging/messaging_view";
import {PaginatedMessageList} from "~/client/messaging/paginated_message_list";
import {tryLoadingMessages} from "~/client/messaging/try_loading_messages";
import {
    PaginatedPostList,
    PaginatedPostListPostContentItem,
} from "~/client/posts/paginated_post_list";
import {PostCommentInput} from "~/client/posts/post_comment_input";
import {PostContentView, postContentViewMinHeight} from "~/client/posts/post_content_view";
import {useClientInfo} from "~/client/remix/client_info_context";
import {
    VirtualizedScrollView,
    VirtualizedScrollViewRef,
    VirtualizedScrollViewRenderItem,
} from "~/client/virtualized/virtualized_scroll_view";
import {RemLength, Spacing, addRemLengths, spacing} from "~/shared/design/spacing";
import {assertExists} from "~/shared/helpers/control/assert_exists";
import {exhaustive} from "~/shared/helpers/control/exhaustive";
import {areRangesOverlapping} from "~/shared/helpers/geometry/are_ranges_overlapping";
import {OrderKey} from "~/shared/helpers/sort/order_key";
import {PostId} from "~/shared/id/types/id_types";
import {PostCommentModel} from "~/shared/models/post_model";
import {getPostCommentsFromEnd, getPostCommentsFromStart} from "~/shared/rpc/posts_rpc_definitions";
import {sprinkles} from "~/shared/styles/styles";

const padding: Spacing = "4";

/**
 * The buffered height of an item in the post view virtualized list is the minimum
 * height of a single post.
 */
const bufferedPostViewHeight = addRemLengths(postContentViewMinHeight, spacing[padding]);

export function PostsView({
    list,
    onTogglePostComments: _onTogglePostComments,
    onUpdatePostComments: _onUpdatePostComments,
}: {
    list: PaginatedPostList;
    onTogglePostComments: (index: number) => void;
    onUpdatePostComments: (
        postOrderKey: OrderKey,
        update: (
            postComments: PaginatedMessageList<PostCommentModel>,
        ) => PaginatedMessageList<PostCommentModel>,
    ) => void;
}) {
    const context = useAppContext();
    const clientInfo = useClientInfo();
    const viewRef = useRef<VirtualizedScrollViewRef>(null);

    const onTogglePostComments = useEvent(_onTogglePostComments);
    const onUpdatePostComments = useEvent(_onUpdatePostComments);

    const [postCommentsLoadingState, setPostCommentsLoadingState] = useState<{
        isLoading: boolean;
        errorState: {hasError: false} | {hasError: true; error: unknown};
    }>({isLoading: false, errorState: {hasError: false}});

    if (postCommentsLoadingState.errorState.hasError)
        throw postCommentsLoadingState.errorState.error;

    const tryLoadingMorePostComments = useEvent(() => {
        // If we're already loading, don't try to load more comments.
        if (postCommentsLoadingState.isLoading) return;

        const view = assertExists(viewRef.current);
        const renderedRange = view.getRenderedRange();
        if (!renderedRange) return;

        let nextIndex = renderedRange.startIndex;
        while (nextIndex <= renderedRange.startIndex) {
            const item = list.getPostContentItem(nextIndex);
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
                onLoadFromStart: async ({afterMessageId, beforeMessageId, limit}) => {
                    const {hasMoreCommentsAfter, comments} = await getPostCommentsFromStart(
                        context,
                        {
                            postId: item.post.id,
                            afterCommentId: afterMessageId,
                            beforeCommentId: beforeMessageId,
                            limit,
                        },
                    );
                    return {
                        hasMoreMessagesAfter: hasMoreCommentsAfter,
                        messages: comments,
                    };
                },
                onLoadFromEnd: async ({afterMessageId, beforeMessageId, limit}) => {
                    const {hasMoreCommentsBefore, comments} = await getPostCommentsFromEnd(
                        context,
                        {
                            postId: item.post.id,
                            afterCommentId: afterMessageId,
                            beforeCommentId: beforeMessageId,
                            limit,
                        },
                    );
                    return {
                        hasMoreMessagesBefore: hasMoreCommentsBefore,
                        messages: comments,
                    };
                },
                onFinishLoadingMessages: result => {
                    if (result.ok) {
                        setPostCommentsLoadingState(state => ({
                            ...state,
                            isLoading: false,
                        }));
                        onUpdatePostComments(item.postOrderKey, result.value.updateMessages);
                    } else {
                        setPostCommentsLoadingState(state => ({
                            ...state,
                            isLoading: false,
                            errorState: {hasError: true, error: result.error},
                        }));
                    }
                },
            });

            if (result.isLoading) {
                setPostCommentsLoadingState(state => ({
                    ...state,
                    isLoading: true,
                }));
                // If we started loading some comments, don't try to load comments from any
                // other posts. We only want to send one load request at a time.
                break;
            }
        }
    });

    // Whenever we stop loading, try loading more comments. Maybe while we were
    // loading the user scrolled and so there are new unloaded comments in view.
    useEffect(() => {
        if (!postCommentsLoadingState.isLoading) {
            tryLoadingMorePostComments();
        }
    }, [postCommentsLoadingState.isLoading, tryLoadingMorePostComments]);

    const loadInitialPostComments = useEvent(
        // eslint-disable-next-line @typescript-eslint/no-misused-promises
        async (item: PaginatedPostListPostContentItem): Promise<void> => {
            // If we're already loading, don't try to load more comments.
            if (postCommentsLoadingState.isLoading) return;

            setPostCommentsLoadingState(state => ({
                ...state,
                isLoading: true,
            }));

            try {
                const limit = getInitialLoadMessageCount(clientInfo);

                const {hasMoreCommentsAfter, comments} = await getPostCommentsFromStart(context, {
                    postId: item.post.id,
                    afterCommentId: null,
                    beforeCommentId: null,
                    limit,
                });

                onUpdatePostComments(item.postOrderKey, postComments =>
                    postComments.loadMessagesFromStart({
                        afterMessageId: null,
                        beforeMessageId: null,
                        limit,
                        hasMoreMessagesAfter: hasMoreCommentsAfter,
                        messages: comments,
                    }),
                );

                setPostCommentsLoadingState(state => ({
                    ...state,
                    isLoading: false,
                }));
            } catch (error) {
                setPostCommentsLoadingState(state => ({
                    ...state,
                    isLoading: false,
                    errorState: {hasError: true, error},
                }));
            }
        },
    );

    const [focusedPostCommentInputPostId, setFocusedPostCommentInputPostId] =
        useState<PostId | null>(null);

    const onPostCommentInputFocusChange = useEvent((postId: PostId, focused: boolean) => {
        setFocusedPostCommentInputPostId(focusedPostCommentInputPostId => {
            if (focused) return postId;
            if (!focused && focusedPostCommentInputPostId === postId) return null;
            return focusedPostCommentInputPostId;
        });
    });

    // Handle case where component unmounts without firing `blur` event. Whenever
    // we see a blur event on the document that should clear our focus state.
    useEffect(() => {
        const handleBlur = () => setFocusedPostCommentInputPostId(null);
        document.addEventListener("blur", handleBlur);
        return () => {
            document.removeEventListener("blur", handleBlur);
        };
    }, []);

    const renderItem: VirtualizedScrollViewRenderItem = useCallback(
        index => {
            const item = list.getItem(index);
            switch (item.type) {
                case "PostContent": {
                    let minHeight: RemLength = postContentViewMinHeight;

                    if (index === 0) {
                        minHeight = addRemLengths(minHeight, spacing[padding]);
                    }

                    if (!item.arePostCommentsOpen) {
                        minHeight = addRemLengths(minHeight, spacing[padding]);
                    }

                    return {
                        key: `PostContent:${item.post.id}`,
                        minHeight,
                        node: (
                            <>
                                {index === 0 && <Spacer space={padding} />}
                                <Box paddingX={padding}>
                                    <Box
                                        marginX="auto"
                                        maxWidth="160"
                                        backgroundColor="grey-0"
                                        borderTopRadius="md"
                                        borderBottomRadius={
                                            !item.arePostCommentsOpen ? "md" : undefined
                                        }
                                        boxShadow="elevation-5"
                                    >
                                        <PostContentView
                                            post={item.post}
                                            postComments={item.postComments}
                                            arePostCommentsOpen={item.arePostCommentsOpen}
                                            onTogglePostComments={() => onTogglePostComments(index)}
                                            onLoadInitialPostComments={() =>
                                                loadInitialPostComments(item)
                                            }
                                        />
                                    </Box>
                                </Box>
                                {!item.arePostCommentsOpen && <Spacer space={padding} />}
                            </>
                        ),
                        renderAdditionalItemIndexes:
                            item.postCommentInputItemIndex !== null
                                ? [item.postCommentInputItemIndex]
                                : undefined,
                    };
                }

                case "LoadedPostComment":
                case "UnloadedPostComment": {
                    const previousItem = index > 0 ? list.getItem(index - 1) : null;
                    const nextItem =
                        index < list.getItemCount() - 1 ? list.getItem(index + 1) : null;

                    const previousComment =
                        previousItem?.type === "LoadedPostComment"
                            ? previousItem.postComment
                            : null;
                    const nextComment =
                        nextItem?.type === "LoadedPostComment" ? nextItem.postComment : null;

                    const node =
                        item.type === "LoadedPostComment" ? (
                            <MessageView
                                message={item.postComment}
                                previousMessage={previousComment}
                                nextMessage={nextComment}
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

                    return {
                        key:
                            item.type === "LoadedPostComment"
                                ? `LoadedPostComment:${item.post.id}:${item.postComment.id}`
                                : `UnloadedPostComment:${item.post.id}:${item.postCommentIndex}`,
                        minHeight: messageViewMinHeight,
                        node: (
                            <Box paddingX={padding}>
                                <Box
                                    marginX="auto"
                                    maxWidth="160"
                                    backgroundColor="grey-0"
                                    boxShadow="elevation-5"
                                    paddingX="2"
                                >
                                    {item.postCommentIndex === 0 ? (
                                        <>
                                            <Spacer space="3" />
                                            {node}
                                        </>
                                    ) : (
                                        node
                                    )}
                                </Box>
                            </Box>
                        ),
                        renderAdditionalItemIndexes: [item.postCommentInputItemIndex],
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
                            onFocus={() => onPostCommentInputFocusChange(item.post.id, true)}
                            onBlur={() => onPostCommentInputFocusChange(item.post.id, false)}
                        />
                    );

                    return {
                        key: `PostCommentInput:${item.post.id}`,
                        minHeight: addRemLengths(spacing["16"], spacing[padding]),
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
                                    <div
                                        style={
                                            shouldRenderWithRelativePositioning
                                                ? {position: "relative"}
                                                : {
                                                      position: "absolute",
                                                      top: offset,
                                                      left: 0,
                                                      right: 0,
                                                  }
                                        }
                                    >
                                        <Box
                                            ref={
                                                shouldRenderWithRelativePositioning
                                                    ? ref
                                                    : undefined
                                            }
                                            paddingX={padding}
                                            paddingBottom={padding}
                                            style={{height}}
                                        >
                                            <Box
                                                marginX="auto"
                                                maxWidth="160"
                                                height="full"
                                                backgroundColor="grey-0"
                                                borderBottomRadius="md"
                                                boxShadow="elevation-5"
                                                paddingX="5"
                                            >
                                                {shouldRenderWithRelativePositioning && (
                                                    <Box
                                                        borderTop="grey-5"
                                                        style={{
                                                            // Remove one pixel from top padding for border.
                                                            paddingTop: `calc(${spacing["3"]} - 1px)`,
                                                            paddingBottom: spacing["3"],
                                                        }}
                                                    >
                                                        {inputNode}
                                                    </Box>
                                                )}
                                            </Box>
                                        </Box>
                                    </div>
                                    {!shouldRenderWithRelativePositioning && (
                                        <>
                                            <div
                                                style={{
                                                    position: "absolute",
                                                    top: postContentOffsetEnd,
                                                    left: spacing[padding],
                                                    right: spacing[padding],
                                                    height: offset - postContentOffsetEnd + height,
                                                    pointerEvents: "none",
                                                    display: "flex",
                                                    justifyContent: "center",
                                                    alignItems: "flex-end",
                                                }}
                                            >
                                                <div
                                                    ref={ref}
                                                    style={{
                                                        position: "sticky",
                                                        bottom: `-${spacing[padding]}`,
                                                    }}
                                                    className={sprinkles({
                                                        zIndex: "20",
                                                        width: "full",
                                                        maxWidth: "160",
                                                        overflowX: "hidden",
                                                        marginX: "auto",
                                                        pointerEvents: "auto",
                                                        display: "flex",
                                                        paddingBottom: padding,
                                                    })}
                                                >
                                                    <Box
                                                        flexShrink="0"
                                                        alignSelf="stretch"
                                                        width="5"
                                                        style={{
                                                            // Allow full-width top border to be visible until it slides under.
                                                            paddingTop: 1,
                                                        }}
                                                    >
                                                        <Box
                                                            width="full"
                                                            height="full"
                                                            backgroundColor="grey-0"
                                                            borderBottomLeftRadius="md"
                                                        />
                                                    </Box>
                                                    <Box
                                                        flexGrow="1"
                                                        overflowX="hidden"
                                                        borderTop="grey-5"
                                                        backgroundColor="grey-0"
                                                        style={{
                                                            // Remove one pixel from top padding for border.
                                                            paddingTop: `calc(${spacing["3"]} - 1px)`,
                                                            paddingBottom: spacing["3"],
                                                        }}
                                                    >
                                                        {inputNode}
                                                    </Box>
                                                    <Box
                                                        flexShrink="0"
                                                        alignSelf="stretch"
                                                        width="5"
                                                        style={{
                                                            // Allow full-width top border to be visible until it slides under.
                                                            paddingTop: 1,
                                                        }}
                                                    >
                                                        <Box
                                                            width="full"
                                                            height="full"
                                                            backgroundColor="grey-0"
                                                            borderBottomRightRadius="md"
                                                        />
                                                    </Box>
                                                </div>
                                                <Box
                                                    // Render a white backdrop below the entire post so that when the user is jump
                                                    // scrolling we don't have the pinned comment input and the wash
                                                    // background color.
                                                    position="absolute"
                                                    width="full"
                                                    maxWidth="160"
                                                    marginX="auto"
                                                    backgroundColor="grey-0"
                                                    zIndex="-10"
                                                    borderTopRadius="md"
                                                    style={{
                                                        top:
                                                            item.postContentItemIndex === 0
                                                                ? `calc(-${postContentPosition.height}px + ${spacing[padding]} + 1px)`
                                                                : -postContentPosition.height,
                                                        bottom: height,
                                                    }}
                                                />
                                            </div>
                                            <div
                                                style={{
                                                    position: "absolute",
                                                    top: postContentOffsetEnd,
                                                    left: spacing[padding],
                                                    right: spacing[padding],
                                                    height:
                                                        offset - postContentOffsetEnd + height + 1,
                                                    pointerEvents: "none",
                                                    display: "flex",
                                                    alignItems: "flex-end",
                                                }}
                                            >
                                                <div
                                                    style={{
                                                        position: "sticky",
                                                        bottom: `-${spacing[padding]}`,
                                                        height,
                                                    }}
                                                    className={sprinkles({
                                                        zIndex: "10",
                                                        width: "full",
                                                        maxWidth: "160",
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
                default:
                    throw exhaustive(item);
            }
        },
        [onPostCommentInputFocusChange, list, loadInitialPostComments, onTogglePostComments],
    );

    return (
        <VirtualizedScrollView
            ref={viewRef}
            bufferedItemHeight={bufferedPostViewHeight}
            itemCount={list.getItemCount()}
            renderItem={renderItem}
            onRenderedRangeChange={tryLoadingMorePostComments}
            // Pin to bottom when a comment element is focused because the user's attention
            // is at the bottom of the scroll view where they are typing.
            //
            // As the comment input grows it should push the content the user is looking
            // at up.
            pinTo={focusedPostCommentInputPostId === null ? "top" : "bottom"}
            disablePinHeuristics={focusedPostCommentInputPostId !== null}
        />
    );
}
