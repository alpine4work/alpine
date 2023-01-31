import {useCallback} from "react";
import {Box} from "~/client/design/box";
import {useRemPx} from "~/client/design/helpers/use_rem_px";
import {Spacer} from "~/client/design/spacer";
import {useEvent} from "~/client/helpers/lifecycle/use_event";
import {MessageShimmer} from "~/client/messaging/message_shimmer";
import {
    MessageView,
    bufferedMessageViewHeight,
    messageViewMinHeight,
} from "~/client/messaging/message_view";
import {PaginatedPostList} from "~/client/posts/paginated_post_list";
import {PostCommentInput} from "~/client/posts/post_comment_input";
import {PostContentView, postContentViewMinHeight} from "~/client/posts/post_content_view";
import {
    VirtualizedScrollView,
    VirtualizedScrollViewRenderItem,
} from "~/client/virtualized/virtualized_scroll_view";
import {
    RemLength,
    Spacing,
    addRemLengths,
    convertRemLengthToPx,
    spacing,
} from "~/shared/design/spacing";
import {exhaustive} from "~/shared/helpers/control/exhaustive";
import {PostCommentModel} from "~/shared/models/post_model";
import {sprinkles} from "~/shared/styles/styles";

export function PostsView({
    list,
    onTogglePostComments: _onTogglePostComments,
    onLoadPostCommentsFromStart: _onLoadPostCommentsFromStart,
}: {
    list: PaginatedPostList;
    onTogglePostComments: (index: number) => void;
    onLoadPostCommentsFromStart: (
        index: number,
        options: {
            afterCommentId: number | null;
            beforeCommentId: number | null;
            limit: number;
            hasMoreCommentsAfter: boolean;
            comments: ReadonlyArray<PostCommentModel>;
        },
    ) => void;
}) {
    const padding: Spacing = "4";

    const onTogglePostComments = useEvent(_onTogglePostComments);
    const onLoadPostCommentsFromStart = useEvent(_onLoadPostCommentsFromStart);

    const remPx = useRemPx();

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
                                            onLoadPostCommentsFromStart={options =>
                                                onLoadPostCommentsFromStart(index, options)
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
                // post width border. This full post width border will be hidden under two
                // boxes at the bottom of the post. This creates the effect of the comment
                // input being full width and sticky when you haven't scrolled to the bottom of
                // the post but when you have scrolled to the bottom the comment input is
                // rendered inline and not full width.
                case "PostCommentInput": {
                    const height: Spacing = "16";

                    const node = (
                        <Box
                            height={height}
                            display="flex"
                            alignItems="center"
                            borderTop="grey-5"
                            backgroundColor="grey-0"
                        >
                            <Box flexGrow="1">
                                <PostCommentInput post={item.post} />
                            </Box>
                        </Box>
                    );

                    return {
                        key: `PostCommentInput:${item.post.id}`,
                        minHeight: addRemLengths(spacing[height], spacing[padding]),
                        withManualLayout: true,
                        render: ({
                            offset,
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
                                        <Box paddingX={padding}>
                                            <Box
                                                position="relative"
                                                marginX="auto"
                                                maxWidth="160"
                                                height={height}
                                                backgroundColor="grey-0"
                                                borderBottomRadius="md"
                                                boxShadow="elevation-5"
                                                paddingX="5"
                                            >
                                                <Box
                                                    position="absolute"
                                                    top="0"
                                                    left="0"
                                                    right="0"
                                                    display="flex"
                                                    justifyContent="space-between"
                                                >
                                                    <Box
                                                        width="5"
                                                        height="5"
                                                        backgroundColor="grey-0"
                                                        position="relative"
                                                        zIndex="30"
                                                    />
                                                    <Box
                                                        width="5"
                                                        height="5"
                                                        backgroundColor="grey-0"
                                                        position="relative"
                                                        zIndex="30"
                                                    />
                                                </Box>
                                                {shouldRenderWithRelativePositioning && node}
                                            </Box>
                                        </Box>
                                        <Spacer space={padding} />
                                    </div>
                                    {!shouldRenderWithRelativePositioning && (
                                        <>
                                            <div
                                                style={{
                                                    position: "absolute",
                                                    top: postContentOffsetEnd,
                                                    left: spacing[padding],
                                                    right: spacing[padding],
                                                    height:
                                                        offset -
                                                        postContentOffsetEnd +
                                                        convertRemLengthToPx(
                                                            spacing[height],
                                                            remPx,
                                                        ),
                                                    pointerEvents: "none",
                                                    display: "flex",
                                                    justifyContent: "center",
                                                    alignItems: "flex-end",
                                                }}
                                            >
                                                <div
                                                    style={{
                                                        position: "sticky",
                                                        bottom: 0,
                                                    }}
                                                    className={sprinkles({
                                                        zIndex: "20",
                                                        width: "full",
                                                        maxWidth: "160",
                                                        marginX: "auto",
                                                        pointerEvents: "auto",
                                                        paddingX: "5",
                                                    })}
                                                >
                                                    {node}
                                                </div>
                                                <Box
                                                    // Render a white backdrop below the entire post so that when the user is jump
                                                    // scrolling we don't have the pinned comment input and the wash
                                                    // background color.
                                                    position="absolute"
                                                    bottom={height}
                                                    width="full"
                                                    maxWidth="160"
                                                    marginX="auto"
                                                    backgroundColor="grey-0"
                                                    zIndex="-10"
                                                    borderTopRadius="md"
                                                    style={{
                                                        top:
                                                            -postContentPosition.height +
                                                            (item.postContentItemIndex === 0
                                                                ? convertRemLengthToPx(
                                                                      spacing[padding],
                                                                      remPx,
                                                                  )
                                                                : 0) +
                                                            1,
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
                                                        offset -
                                                        postContentOffsetEnd +
                                                        convertRemLengthToPx(
                                                            spacing[height],
                                                            remPx,
                                                        ) +
                                                        1,
                                                    pointerEvents: "none",
                                                    display: "flex",
                                                    alignItems: "flex-end",
                                                }}
                                            >
                                                <div
                                                    style={{
                                                        position: "sticky",
                                                        bottom: 0,
                                                    }}
                                                    className={sprinkles({
                                                        zIndex: "10",
                                                        width: "full",
                                                        height,
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
        [list, onLoadPostCommentsFromStart, onTogglePostComments, remPx],
    );

    return (
        <VirtualizedScrollView
            // TODO(calebmer): We should use a bigger height for this virtualized list
            // that's closer to the size of a post. Probably the minimum height of a post?
            bufferedItemHeight={bufferedMessageViewHeight}
            itemCount={list.getItemCount()}
            renderItem={renderItem}
        />
    );
}
