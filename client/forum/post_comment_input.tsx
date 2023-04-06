import {Ref, RefObject, useCallback, useImperativeHandle} from "react";
import {useWebSocket} from "~/client/cloudflare/use_web_socket";
import {useAppContext} from "~/client/context/app_context";
import {MessageEditing} from "~/client/messaging/message_editing";
import {MessageInput, messageInputMinHeight} from "~/client/messaging/message_input";
import {MessageList, MessageListItem} from "~/client/messaging/message_list";
import {useMessagingRealtime} from "~/client/messaging/use_messaging_realtime";
import {useScrollToNewMessages} from "~/client/messaging/use_scroll_to_new_messages";
import {VirtualizedScrollViewRef} from "~/client/virtualized/virtualized_scroll_view";
import {cast} from "~/shared/helpers/control/cast";
import {exhaustive} from "~/shared/helpers/control/exhaustive";
import {PostId} from "~/shared/id/types/id_types";
import {
    MessagingRealtimeMessageFromClient,
    MessagingRealtimeMessageFromServer,
} from "~/shared/messaging/messaging_realtime_schema";
import {PostCommentModel, PostModel} from "~/shared/models/post_model";
import {
    PostRealtimeMessageFromClientSchema,
    PostRealtimeMessageFromServer,
    PostRealtimeMessageFromServerSchema,
} from "~/shared/posts/post_realtime_schema";

export const postCommentInputMinHeight = messageInputMinHeight;

export function PostCommentInput({
    post,
    viewRef,
    sendRealtimeMessageRef,
    postComments,
    onUpdatePostComments,
    postCommentEditing,
    replyingToPostComment,
    onClearReplyingToPostComment,
    onJumpToPostComment,
    withoutBorderTop,
}: {
    post: PostModel;
    viewRef: RefObject<VirtualizedScrollViewRef>;
    sendRealtimeMessageRef: Ref<(message: MessagingRealtimeMessageFromClient) => Promise<void>>;
    postComments: MessageList<PostCommentModel>;
    onUpdatePostComments: (
        update: (postComments: MessageList<PostCommentModel>) => MessageList<PostCommentModel>,
    ) => void;
    postCommentEditing: MessageEditing<PostId>;
    replyingToPostComment: PostCommentModel | null;
    onClearReplyingToPostComment: () => void;
    onJumpToPostComment: (postComment: PostCommentModel) => void;
    withoutBorderTop?: boolean;
}) {
    const context = useAppContext();

    // We connect to realtime in our `<PostCommentInput>` component. When comments
    // are open this component is always rendered and we only want to connect to
    // realtime when comments are open so works out.
    const {
        isConnected: isRealtimeConnected,
        sendMessage: _sendRealtimeMessage,
        subscribeToMessages: subscribeToRealtimeMessages,
    } = useWebSocket(
        PostRealtimeMessageFromClientSchema,
        PostRealtimeMessageFromServerSchema,
        `/durable-objects/posts/${post.id}`,
    );

    const sendRealtimeMessage = useCallback(
        (message: MessagingRealtimeMessageFromClient) =>
            _sendRealtimeMessage({type: "PostComments", message}),
        [_sendRealtimeMessage],
    );

    useImperativeHandle(sendRealtimeMessageRef, () => sendRealtimeMessage, [sendRealtimeMessage]);

    useMessagingRealtime({
        messages: postComments,
        onUpdateMessages: onUpdatePostComments,
        isRealtimeConnected,
        sendRealtimeMessage,
        subscribeToRealtimeMessages: useCallback(
            (
                subscriber: (message: MessagingRealtimeMessageFromServer<PostCommentModel>) => void,
            ) => {
                const actualSubscriber = (message: PostRealtimeMessageFromServer) => {
                    // TypeScript will error if we ever add other message types here. At that point
                    // this code should turn into a switch.
                    cast<"PostComments">(message.type);
                    subscriber(message.message);
                };

                return subscribeToRealtimeMessages(actualSubscriber);
            },
            [subscribeToRealtimeMessages],
        ),
    });

    // We perform the scroll adjustment for new messages in the
    // `<PostCommentInput>` component which will always be mounted when the post's
    // comment section is open.
    useScrollToNewMessages({
        viewRef,
        messages: postComments,
        getItemKey: useCallback(
            (item: MessageListItem<PostCommentModel>) => {
                switch (item.type) {
                    case "Loaded":
                    case "Optimistic":
                        return `PostComment:${post.id}:${item.messageIndex}`;
                    case "Unloaded":
                        return `UnloadedPostComment:${post.id}:${item.messageIndex}`;
                    case "TypingIndicators":
                        return `PostCommentsTypingIndicator:${post.id}`;
                    default:
                        throw exhaustive(item);
                }
            },
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
            createMessage={async input => {
                await sendRealtimeMessage({
                    type: "CreateMessage",
                    ...input,
                });
            }}
            messageEditing={postCommentEditing}
            replyingToMessage={replyingToPostComment}
            onClearReplyingToMessage={onClearReplyingToPostComment}
            onJumpToMessage={onJumpToPostComment}
            onShowTypingIndicator={() => {
                // Don't show an error updating typing indicators to the user. We will see an
                // error in our logs but the user won't see any weird behavior if the
                // request fails.
                sendRealtimeMessage({type: "StartTyping"}).catch(error =>
                    context.tracer
                        .getRoot()
                        .logUncaughtException("Couldn't update typing indicator", error),
                );
            }}
            onHideTypingIndicator={() => {
                // Don't show an error updating typing indicators to the user. We will see an
                // error in our logs but the user won't see any weird behavior if the
                // request fails.
                sendRealtimeMessage({type: "StopTyping"}).catch(error =>
                    context.tracer
                        .getRoot()
                        .logUncaughtException("Couldn't update typing indicator", error),
                );
            }}
            withoutBorderTop={withoutBorderTop}
        />
    );
}
