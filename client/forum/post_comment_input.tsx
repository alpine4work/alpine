import {Ref, RefObject, useRef} from "react";
import {getRemPxWithoutListening} from "~/client/design/helpers/use_rem_px";
import {PostRealtimeActions, usePostRealtime} from "~/client/forum/use_post_realtime";
import {useLayoutEffectWithoutServerSideWarning} from "~/client/helpers/lifecycle/use_layout_effect_without_server_side_warning";
import {MessageInput, messageInputMinHeight} from "~/client/messaging/message_input";
import {MessageList} from "~/client/messaging/message_list";
import {
    messageViewMargin,
    messageViewMergedMargin,
    shouldMergeMessages,
} from "~/client/messaging/message_view";
import {VirtualizedScrollViewRef} from "~/client/virtualized/virtualized_scroll_view";
import {convertRemLengthToPx, spacing} from "~/shared/design/spacing";
import {scheduleMicrotask} from "~/shared/helpers/async/schedule_microtask";
import {assertExists} from "~/shared/helpers/control/assert_exists";
import {areRangesOverlapping} from "~/shared/helpers/geometry/are_ranges_overlapping";
import {PostCommentModel, PostModel} from "~/shared/models/post_model";

export const postCommentInputMinHeight = messageInputMinHeight;

export function PostCommentInput({
    post,
    viewRef,
    actionsRef,
    postComments,
    onUpdatePostComments,
    replyingToPostComment,
    onClearReplyingToPostComment,
    onJumpToPostComment,
}: {
    post: PostModel;
    viewRef: RefObject<VirtualizedScrollViewRef>;
    actionsRef: Ref<PostRealtimeActions>;
    postComments: MessageList<PostCommentModel>;
    onUpdatePostComments: (
        update: (postComments: MessageList<PostCommentModel>) => MessageList<PostCommentModel>,
    ) => void;
    replyingToPostComment: PostCommentModel | null;
    onClearReplyingToPostComment: () => void;
    onJumpToPostComment: (postCommentIndex: number) => void;
}) {
    // We connect to realtime in our `<PostCommentInput>` component. When comments
    // are open this component is always rendered and we only want to connect to
    // realtime when comments are open so works out.
    const {actions} = usePostRealtime({
        postId: post.id,
        actionsRef,
        postComments,
        onUpdatePostComments,
    });

    // When new comments are added, we may want to scroll our view down so that the
    // user can see the new comments. This effect performs that adjustment. We
    // perform the adjustment in the `<PostCommentInput>` component which will
    // always be mounted when the post's comment section is open.
    const lastPostCommentCountRef = useRef(postComments.getMessageCount());
    useLayoutEffectWithoutServerSideWarning(() => {
        const lastPostCommentCount = lastPostCommentCountRef.current;
        const postCommentCount = postComments.getMessageCount();
        lastPostCommentCountRef.current = postCommentCount;

        // No new comments, don't perform a scroll adjustment.
        if (lastPostCommentCount === postCommentCount) return;

        const run = () => {
            const view = assertExists(viewRef.current);

            let newPostCommentsOffset: number | null = null;
            let newPostCommentsHeight = 0;
            for (
                let postCommentIndex = lastPostCommentCount;
                postCommentIndex < postCommentCount;
                postCommentIndex++
            ) {
                const position = view.getPositionByKeyIfExists(
                    `PostComment:${post.id}:${postCommentIndex}`,
                );

                // If any position doesn't exist, don't perform a scroll adjustment.
                if (!position) return;

                if (newPostCommentsOffset === null) newPostCommentsOffset = position.offset;
                newPostCommentsHeight += position.height;
            }

            // No new comments were found.
            if (newPostCommentsOffset === null) return;

            const previousPostComment =
                lastPostCommentCount > 0
                    ? postComments.getMessage(lastPostCommentCount - 1).message
                    : null;
            const firstNewPostComment = postComments.getMessage(lastPostCommentCount).message;

            const remPx = getRemPxWithoutListening();

            const maybeNewScrollOffset =
                view.getScrollOffset() +
                newPostCommentsHeight -
                // When a new message is added we also remove some margin from the previous
                // message. Adjust our new scroll height so we don't overshoot and consider the
                // fact that some margin is lost.
                (lastPostCommentCount > 0 &&
                previousPostComment &&
                firstNewPostComment &&
                shouldMergeMessages(previousPostComment, firstNewPostComment)
                    ? convertRemLengthToPx(spacing[messageViewMargin], remPx) -
                      convertRemLengthToPx(spacing[messageViewMergedMargin], remPx)
                    : 0);

            const viewHeightWithoutCommentInput =
                view.getHeight() - convertRemLengthToPx(postCommentInputMinHeight, remPx);
            if (
                // If the new comments are completely visible with our existing scroll offset
                // then don't perform an adjustment.
                !(
                    view.getScrollOffset() <= newPostCommentsOffset &&
                    newPostCommentsOffset + newPostCommentsHeight <=
                        view.getScrollOffset() + viewHeightWithoutCommentInput
                ) &&
                // Only set the new scroll offset if it would put the new messages onscreen.
                // Otherwise the messages you're looking at will jump in a way that doesn't
                // make sense.
                areRangesOverlapping(
                    maybeNewScrollOffset,
                    maybeNewScrollOffset + viewHeightWithoutCommentInput,
                    newPostCommentsOffset,
                    newPostCommentsOffset + newPostCommentsHeight,
                )
            ) {
                view.setScrollOffset(maybeNewScrollOffset);
            }
        };

        // Run our effect after a microtask so that refs from the parent component
        // are populated.
        let isCancelled = false;
        scheduleMicrotask(() => {
            if (isCancelled) return;
            run();
        });
        return () => {
            isCancelled = true;
        };
    }, [post.id, postComments, viewRef]);

    return (
        <MessageInput
            messageNoun="comment"
            roomKey={post.id}
            messages={postComments}
            onUpdateMessages={onUpdatePostComments}
            createMessage={input =>
                actions.createPostComment({
                    parentPostCommentIndex: input.parentMessageIndex,
                    content: input.content,
                })
            }
            replyingToMessage={replyingToPostComment}
            onClearReplyingToMessage={onClearReplyingToPostComment}
            onJumpToMessage={onJumpToPostComment}
        />
    );
}
