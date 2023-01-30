import {useCallback} from "react";
import {Box} from "~/client/design/box";
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
import {VirtualizedScrollView} from "~/client/virtualized/virtualized_scroll_view";
import {RemLength, Spacing, addRemLengths, spacing} from "~/shared/design/spacing";
import {exhaustive} from "~/shared/helpers/control/exhaustive";
import {PostCommentModel} from "~/shared/models/post_model";

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

    return (
        <VirtualizedScrollView
            // TODO(calebmer): We should use a bigger height for this virtualized list
            // that's closer to the size of a post. Probably the minimum height of a post?
            bufferedItemHeight={bufferedMessageViewHeight}
            itemCount={list.getItemCount()}
            renderItem={useCallback(
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
                                                    onTogglePostComments={() =>
                                                        onTogglePostComments(index)
                                                    }
                                                    onLoadPostCommentsFromStart={options =>
                                                        onLoadPostCommentsFromStart(index, options)
                                                    }
                                                />
                                            </Box>
                                        </Box>
                                        {!item.arePostCommentsOpen && <Spacer space={padding} />}
                                    </>
                                ),
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
                                nextItem?.type === "LoadedPostComment"
                                    ? nextItem.postComment
                                    : null;

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
                            };
                        }
                        case "PostCommentInput": {
                            const height: Spacing = "16";
                            return {
                                key: `PostCommentInput:${item.post.id}`,
                                minHeight: addRemLengths(spacing[height], spacing[padding]),
                                node: (
                                    <>
                                        <Box paddingX={padding}>
                                            <Box
                                                marginX="auto"
                                                maxWidth="160"
                                                backgroundColor="grey-0"
                                                borderBottomRadius="md"
                                                boxShadow="elevation-5"
                                                paddingX="5"
                                            >
                                                <Box
                                                    height={height}
                                                    display="flex"
                                                    alignItems="center"
                                                    borderTop="grey-5"
                                                >
                                                    <Box flexGrow="1">
                                                        <PostCommentInput post={item.post} />
                                                    </Box>
                                                </Box>
                                            </Box>
                                        </Box>
                                        <Spacer space={padding} />
                                    </>
                                ),
                            };
                        }
                        default:
                            throw exhaustive(item);
                    }
                },
                [list, onLoadPostCommentsFromStart, onTogglePostComments],
            )}
        />
    );
}
