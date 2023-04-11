import {Memo, RefObject, useCallback} from "react";
import {useAppContext} from "~/client/context/app_context";
import {MessageEditing} from "~/client/messaging/message_editing";
import {MessageInput} from "~/client/messaging/message_input";
import {MessageList, MessageListItem} from "~/client/messaging/message_list";
import {getMessageListItemKey} from "~/client/messaging/messaging_view";
import {useMessagingRealtime} from "~/client/messaging/use_messaging_realtime";
import {useScrollToNewMessages} from "~/client/messaging/use_scroll_to_new_messages";
import {VirtualizedScrollViewRef} from "~/client/virtualized/virtualized_scroll_view";
import {Spacing} from "~/shared/design/spacing";
import {DocumentCommentThreadId} from "~/shared/id/types/id_types";
import {
    MessagingRealtimeMessageFromClient,
    MessagingRealtimeMessageFromServer,
} from "~/shared/messaging/messaging_realtime_schema";
import {
    DocumentCommentModel,
    DocumentCommentRoomKey,
    DocumentCommentThreadModel,
} from "~/shared/models/document_model";

export function DocumentCommentInput({
    viewRef,
    commentThread,
    comments,
    onUpdateComments,
    messageEditing,
    replyingToComment,
    onClearReplyingToComment,
    onJumpToComment,
    isConnected,
    sendCommentThreadMessage,
    subscribeToCommentThreadMessages,
    marginX,
}: {
    viewRef: RefObject<VirtualizedScrollViewRef>;
    commentThread: DocumentCommentThreadModel;
    comments: MessageList<DocumentCommentModel>;
    onUpdateComments: (
        update: (comments: MessageList<DocumentCommentModel>) => MessageList<DocumentCommentModel>,
    ) => void;
    messageEditing: MessageEditing<DocumentCommentRoomKey>;
    replyingToComment: DocumentCommentModel | null;
    onClearReplyingToComment: () => void;
    onJumpToComment: (comment: DocumentCommentModel) => void;
    isConnected: boolean;
    sendCommentThreadMessage: Memo<
        (
            commentThreadId: DocumentCommentThreadId,
            message: MessagingRealtimeMessageFromClient,
        ) => Promise<void>
    >;
    subscribeToCommentThreadMessages: Memo<
        (
            commentThreadId: DocumentCommentThreadId,
            subscriber: (message: MessagingRealtimeMessageFromServer<DocumentCommentModel>) => void,
        ) => () => void
    >;
    marginX?: Spacing;
}) {
    const context = useAppContext();

    // We connect to realtime in our `<DocumentCommentInput>` component. This
    // component is always mounted for a document comment thread.
    useMessagingRealtime({
        messages: comments,
        onUpdateMessages: onUpdateComments,
        isRealtimeConnected: isConnected,
        sendRealtimeMessage: useCallback(
            message => sendCommentThreadMessage(commentThread.id, message),
            [commentThread.id, sendCommentThreadMessage],
        ),
        subscribeToRealtimeMessages: useCallback(
            (
                subscriber: (
                    message: MessagingRealtimeMessageFromServer<DocumentCommentModel>,
                ) => void,
            ) => subscribeToCommentThreadMessages(commentThread.id, subscriber),
            [commentThread.id, subscribeToCommentThreadMessages],
        ),
    });

    useScrollToNewMessages({
        viewRef,
        messages: comments,
        getItemKey: useCallback((item: MessageListItem<DocumentCommentModel>) => {
            return getMessageListItemKey(item);
        }, []),
    });

    return (
        <MessageInput
            messages={comments}
            onUpdateMessages={onUpdateComments}
            createMessage={async input => {
                await sendCommentThreadMessage(commentThread.id, {
                    type: "CreateMessage",
                    ...input,
                });
            }}
            messageEditing={messageEditing}
            replyingToMessage={replyingToComment}
            onClearReplyingToMessage={onClearReplyingToComment}
            onJumpToMessage={onJumpToComment}
            onShowTypingIndicator={() => {
                sendCommentThreadMessage(commentThread.id, {type: "StartTyping"})
                    // Don't show an error updating typing indicators to the user. We will see an
                    // error in our logs but the user won't see any weird behavior if the
                    // request fails.
                    .catch(error =>
                        context.tracer
                            .getRoot()
                            .logUncaughtException("Couldn't update typing indicator", error),
                    );
            }}
            onHideTypingIndicator={() => {
                sendCommentThreadMessage(commentThread.id, {type: "StopTyping"})
                    // Don't show an error updating typing indicators to the user. We will see an
                    // error in our logs but the user won't see any weird behavior if the
                    // request fails.
                    .catch(error =>
                        context.tracer
                            .getRoot()
                            .logUncaughtException("Couldn't update typing indicator", error),
                    );
            }}
            marginX={marginX}
        />
    );
}
