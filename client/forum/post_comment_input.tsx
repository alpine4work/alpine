import {Ref, RefObject, useCallback} from "react";
import {usePostRealtime} from "~/client/forum/use_post_realtime";
import {MessageInput, messageInputMinHeight} from "~/client/messaging/message_input";
import {MessageList} from "~/client/messaging/message_list";
import {MessagingRealtimeActions} from "~/client/messaging/use_messaging_realtime";
import {useScrollToNewMessages} from "~/client/messaging/use_scroll_to_new_messages";
import {VirtualizedScrollViewRef} from "~/client/virtualized/virtualized_scroll_view";
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
    withoutBorderTop,
}: {
    post: PostModel;
    viewRef: RefObject<VirtualizedScrollViewRef>;
    actionsRef: Ref<MessagingRealtimeActions>;
    postComments: MessageList<PostCommentModel>;
    onUpdatePostComments: (
        update: (postComments: MessageList<PostCommentModel>) => MessageList<PostCommentModel>,
    ) => void;
    replyingToPostComment: PostCommentModel | null;
    onClearReplyingToPostComment: () => void;
    onJumpToPostComment: (postComment: PostCommentModel) => void;
    withoutBorderTop?: boolean;
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

    // We perform the scroll adjustment for new messages in the
    // `<PostCommentInput>` component which will always be mounted when the post's
    // comment section is open.
    useScrollToNewMessages({
        viewRef,
        messages: postComments,
        getMessageViewKey: useCallback(
            postCommentIndex => `PostComment:${post.id}:${postCommentIndex}`,
            [post.id],
        ),
        stickyInputHeight: postCommentInputMinHeight,
    });

    return (
        <MessageInput
            data-testid={`PostCommentInput:${post.id}`}
            messageNoun="comment"
            messages={postComments}
            onUpdateMessages={onUpdatePostComments}
            createMessage={input => actions.createMessage(input)}
            replyingToMessage={replyingToPostComment}
            onClearReplyingToMessage={onClearReplyingToPostComment}
            onJumpToMessage={onJumpToPostComment}
            withoutBorderTop={withoutBorderTop}
        />
    );
}
