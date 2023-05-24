import {Ref, RefObject, useCallback, useImperativeHandle} from "react";
import {useWebSocket} from "~/client/cloudflare/use_web_socket";
import {useAppContext} from "~/client/context/app_context";
import {MessageEditing} from "~/client/messaging/message_editing";
import {MessageInput} from "~/client/messaging/message_input";
import {MessageList, MessageListItem} from "~/client/messaging/message_list";
import {useMessagingRealtime} from "~/client/messaging/use_messaging_realtime";
import {useScrollToNewMessages} from "~/client/messaging/use_scroll_to_new_messages";
import {VirtualizedScrollViewRef} from "~/client/virtualized/virtualized_scroll_view";
import {Spacing} from "~/shared/design/spacing";
import {PostCommentModel, PostModel} from "~/shared/forum/post_model";
import {PostRealtimeEvent, PostRealtimeProtocol} from "~/shared/forum/post_realtime_protocol";
import {cast} from "~/shared/helpers/control/cast";
import {exhaustive} from "~/shared/helpers/control/exhaustive";
import {pickObject} from "~/shared/helpers/object/pick_object";
import {PostId} from "~/shared/id/types/id_types";
import {MessageContent} from "~/shared/messaging/message_content_schema";
import {MessagingRealtimeEvent} from "~/shared/messaging/messaging_realtime_protocol";
import {messageInputMinHeight} from "~/shared/messaging/messaging_shared_styles";

export const postCommentInputMinHeight = messageInputMinHeight;

export type PostRealtimeProcedures = {
    updateCommentContent: (input: {commentIndex: number; content: MessageContent}) => Promise<{}>;
    deleteComment: (input: {commentIndex: number}) => Promise<{}>;
};

export function PostCommentInput({
    post,
    viewRef,
    proceduresRef,
    postComments,
    onUpdatePostComments,
    postCommentEditing,
    replyingToPostComment,
    onClearReplyingToPostComment,
    onJumpToPostComment,
    padding,
    isStickyPositioned,
}: {
    post: PostModel;
    viewRef: RefObject<VirtualizedScrollViewRef>;
    proceduresRef: Ref<PostRealtimeProcedures>;
    postComments: MessageList<PostCommentModel>;
    onUpdatePostComments: (
        update: (postComments: MessageList<PostCommentModel>) => MessageList<PostCommentModel>,
    ) => void;
    postCommentEditing: MessageEditing<PostId>;
    replyingToPostComment: PostCommentModel | null;
    onClearReplyingToPostComment: () => void;
    onJumpToPostComment: (postComment: PostCommentModel) => void;
    padding: Spacing;
    isStickyPositioned?: boolean;
}) {
    const context = useAppContext();

    // We connect to realtime in our `<PostCommentInput>` component. When comments
    // are open this component is always rendered and we only want to connect to
    // realtime when comments are open so works out.
    const {isConnected, procedures, subscribeToEvents} = useWebSocket(
        PostRealtimeProtocol,
        `/durable-objects/posts/${post.id}`,
    );

    useImperativeHandle(
        proceduresRef,
        () => pickObject(procedures, ["updateCommentContent", "deleteComment"]),
        [procedures],
    );

    useMessagingRealtime({
        messages: postComments,
        onUpdateMessages: onUpdatePostComments,
        isConnected,
        backfillMessages: useCallback(
            async ({
                clientMessageCount: clientCommentCount,
                clientLastMessageChangeTime: clientLastCommentChangeTime,
                newMessageLimit: newCommentLimit,
            }) => {
                const {
                    commentCount: messageCount,
                    lastCommentChangeTime: lastMessageChangeTime,
                    newComments: newMessages,
                    newOtherReferencedComments: newOtherReferencedMessages,
                    commentChangesResult: messageChangesResult,
                    typingStateByConnectionId,
                } = await procedures.backfillComments({
                    clientCommentCount,
                    clientLastCommentChangeTime,
                    newCommentLimit,
                });

                return {
                    messageCount,
                    lastMessageChangeTime,
                    newMessages,
                    newOtherReferencedMessages,
                    messageChangesResult,
                    typingStateByConnectionId,
                };
            },
            [procedures],
        ),
        subscribeToEvents: useCallback(
            (subscriber: (message: MessagingRealtimeEvent<PostCommentModel>) => void) => {
                const actualSubscriber = (event: PostRealtimeEvent) => {
                    // TypeScript will error if we ever add other message types here. At that point
                    // this code should turn into a switch.
                    cast<"Comments">(event.type);
                    subscriber(event.event);
                };

                return subscribeToEvents(actualSubscriber);
            },
            [subscribeToEvents],
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
        stickyInputHeight: isStickyPositioned ? postCommentInputMinHeight : undefined,
    });

    return (
        <MessageInput
            data-testid={`PostCommentInput:${post.id}`}
            messageNoun="comment"
            messages={postComments}
            onUpdateMessages={onUpdatePostComments}
            createMessage={async input => {
                await procedures.createComment({
                    parentCommentIndex: input.parentMessageIndex,
                    content: input.content,
                });
            }}
            messageEditing={postCommentEditing}
            replyingToMessage={replyingToPostComment}
            marginX={padding}
            onClearReplyingToMessage={onClearReplyingToPostComment}
            onJumpToMessage={onJumpToPostComment}
            onShowTypingIndicator={() => {
                // Don't show an error updating typing indicators to the user. We will see an
                // error in our logs but the user won't see any weird behavior if the
                // request fails.
                procedures
                    .startTypingInCommentInput({})
                    .catch(error =>
                        context.tracer
                            .getRoot()
                            .logUncaughtException("Couldn't update typing indicator", error),
                    );
            }}
            onHideTypingIndicator={() => {
                // Don't show an error updating typing indicators to the user. We will see an
                // error in our logs but the user won't see any weird behavior if the
                // request fails.
                procedures
                    .stopTypingInCommentInput({})
                    .catch(error =>
                        context.tracer
                            .getRoot()
                            .logUncaughtException("Couldn't update typing indicator", error),
                    );
            }}
            withoutBorderTop={isStickyPositioned}
        />
    );
}
