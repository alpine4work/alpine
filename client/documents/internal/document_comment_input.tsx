import {RefObject, useCallback} from "react";
import {useAppContext} from "~/client/context/app_context";
import {DocumentContentEditorWebSocketClientProcedures} from "~/client/documents/internal/document_content_editor_web_socket_client";
import {SubscribeToCommentThreadEventsFunction} from "~/client/documents/internal/use_document_content_editor_web_socket";
import {MemoObject} from "~/client/helpers/types/memo_object";
import {MessageEditing} from "~/client/messaging/message_editing";
import {MessageInput} from "~/client/messaging/message_input";
import {MessageList, MessageListItem} from "~/client/messaging/message_list";
import {getMessageListItemKey} from "~/client/messaging/messaging_view";
import {useMessagingRealtime} from "~/client/messaging/use_messaging_realtime";
import {useScrollToNewMessages} from "~/client/messaging/use_scroll_to_new_messages";
import {VirtualizedScrollViewRef} from "~/client/virtualized/virtualized_scroll_view";
import {Spacing} from "~/shared/design/spacing";
import {MessagingRealtimeEvent} from "~/shared/messaging/messaging_realtime_protocol";
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
    procedures,
    subscribeToCommentThreadEvents,
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
    procedures: MemoObject<DocumentContentEditorWebSocketClientProcedures>;
    subscribeToCommentThreadEvents: SubscribeToCommentThreadEventsFunction;
    marginX?: Spacing;
}) {
    const context = useAppContext();

    // We connect to realtime in our `<DocumentCommentInput>` component. This
    // component is always mounted for a document comment thread.
    useMessagingRealtime({
        messages: comments,
        onUpdateMessages: onUpdateComments,
        isConnected,
        backfillMessages: useCallback(
            async ({
                clientMessageCount: clientCommentCount,
                clientLastMessageChangeTime: clientLastCommentChangeTime,
                newMessageLimit: newCommentLimit,
            }) => {
                const {
                    commentCount,
                    lastCommentChangeTime,
                    newComments,
                    newOtherReferencedComments,
                    commentChangesResult,
                    typingStateByConnectionId,
                } = await procedures.backfillComments({
                    commentThreadId: commentThread.id,
                    clientCommentCount,
                    clientLastCommentChangeTime,
                    newCommentLimit,
                });
                return {
                    messageCount: commentCount,
                    lastMessageChangeTime: lastCommentChangeTime,
                    newMessages: newComments,
                    newOtherReferencedMessages: newOtherReferencedComments,
                    messageChangesResult: commentChangesResult,
                    typingStateByConnectionId,
                };
            },
            [commentThread.id, procedures],
        ),
        subscribeToEvents: useCallback(
            (subscriber: (message: MessagingRealtimeEvent<DocumentCommentModel>) => void) =>
                subscribeToCommentThreadEvents(commentThread.id, subscriber),
            [commentThread.id, subscribeToCommentThreadEvents],
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
            messageNoun="comment"
            messages={comments}
            onUpdateMessages={onUpdateComments}
            createMessage={async input => {
                await procedures.createComment({
                    commentThreadId: commentThread.id,
                    parentCommentIndex: input.parentMessageIndex,
                    content: input.content,
                });
            }}
            messageEditing={messageEditing}
            replyingToMessage={replyingToComment}
            onClearReplyingToMessage={onClearReplyingToComment}
            onJumpToMessage={onJumpToComment}
            onShowTypingIndicator={() => {
                procedures
                    .startTypingInCommentInput({commentThreadId: commentThread.id})
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
                procedures
                    .stopTypingInCommentInput({commentThreadId: commentThread.id})
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
