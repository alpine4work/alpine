import {Memo, Ref, RefObject, useCallback, useRef} from "react";
import {flushSync} from "react-dom";
import {MessageInputRef} from "~/client/content/messaging/message_input_base.js";
import {useReporter} from "~/client/design/reporter.js";
import {DocumentContentEditorWebSocketClientProcedures} from "~/client/documents/internal/document_content_editor_web_socket_client.js";
import {SubscribeToCommentThreadEventsFunction} from "~/client/documents/use_document_content_editor_web_socket.js";
import {useEvent} from "~/client/helpers/lifecycle/use_event.js";
import {useMergedRefs} from "~/client/helpers/refs/use_merged_refs.js";
import {MemoObject} from "~/client/helpers/types/memo_object.js";
import {MessageEditing} from "~/client/messaging/message_editing.js";
import {MessageInput} from "~/client/messaging/message_input.js";
import {MessageList, MessageListItem} from "~/client/messaging/message_list.js";
import {getMessageListItemKey} from "~/client/messaging/render_message_list_item.js";
import {useMessagingRealtime} from "~/client/messaging/use_messaging_realtime.js";
import {useScrollToNewMessages} from "~/client/messaging/use_scroll_to_new_messages.js";
import {VirtualizedScrollViewRef} from "~/client/virtualized/virtualized_scroll_view.js";
import {
    DocumentCommentModel,
    DocumentCommentRoomKey,
    DocumentCommentThreadModel,
} from "~/shared/documents/document_model.js";
import {FileAttachmentTarget} from "~/shared/files/file_attachment_target.js";
import {MessageContentPayloadParent} from "~/shared/messaging/message_schema.js";
import {MessagingRealtimeEvent} from "~/shared/messaging/messaging_realtime_protocol.js";

export function DocumentCommentInput({
    isStickyPositioned,
    inputRef: inputRefProp,
    viewRef,
    commentThread,
    comments,
    fileAttachmentTarget,
    onUpdateCommentThread,
    messageEditing,
    parent,
    onParentClear,
    onJumpToComment,
    onDeleteComment,
    isConnected,
    procedures,
    subscribeToCommentThreadEvents,
    withMobileMaxHeight,
    onFocus,
    onBeforeFocusFromReplyOrEditingChange,
}: {
    isStickyPositioned: boolean;
    inputRef?: Ref<MessageInputRef>;
    viewRef: RefObject<VirtualizedScrollViewRef>;
    commentThread: DocumentCommentThreadModel;
    comments: MessageList<DocumentCommentModel>;
    fileAttachmentTarget: Memo<FileAttachmentTarget>;
    onUpdateCommentThread: (
        update: (state: {
            commentThread: DocumentCommentThreadModel;
            comments: MessageList<DocumentCommentModel>;
        }) => {
            commentThread: DocumentCommentThreadModel;
            comments: MessageList<DocumentCommentModel>;
        },
    ) => void;
    messageEditing: MessageEditing<DocumentCommentRoomKey>;
    parent: MessageContentPayloadParent | null;
    onParentClear: () => void;
    onJumpToComment: (comment: DocumentCommentModel) => void;
    onDeleteComment: (commentIndex: number) => Promise<void>;
    isConnected: boolean;
    procedures: MemoObject<DocumentContentEditorWebSocketClientProcedures>;
    subscribeToCommentThreadEvents: SubscribeToCommentThreadEventsFunction;
    withMobileMaxHeight: boolean;
    onFocus?: () => void;
    onBeforeFocusFromReplyOrEditingChange?: () => {preventDefault: boolean} | void;
}) {
    const reporter = useReporter();

    const inputRef = useRef<MessageInputRef>(null);

    const handlePersistedContentEvent = useEvent(
        (updatedCommentThread: DocumentCommentThreadModel) => {
            onUpdateCommentThread(({commentThread, comments}) => ({
                commentThread:
                    updatedCommentThread.version >= commentThread.version
                        ? updatedCommentThread
                        : commentThread,
                comments,
            }));
        },
    );

    // We connect to realtime in our `<DocumentCommentInput>` component. This
    // component is always mounted for a document comment thread.
    useMessagingRealtime({
        messages: comments,
        onUpdateMessages: (update, extra) => {
            onUpdateCommentThread(({commentThread, comments}) => ({
                commentThread:
                    extra?.commentThread && extra.commentThread.version >= commentThread.version
                        ? extra.commentThread
                        : commentThread,
                comments: update(comments),
            }));
        },
        isConnected,
        backfillMessages: useCallback(
            async ({
                clientMessageCount: clientCommentCount,
                clientLastMessageChangeTime: clientLastCommentChangeTime,
                newMessageLimit: newCommentLimit,
            }) => {
                const {
                    commentThread: newCommentThread,
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
                    extra: {commentThread: newCommentThread},
                };
            },
            [commentThread.id, procedures],
        ),
        subscribeToEvents: useCallback(
            (subscriber: (event: MessagingRealtimeEvent<DocumentCommentModel>) => void) =>
                subscribeToCommentThreadEvents(commentThread.id, event => {
                    if (event.type === "PersistedContent") {
                        // Synchronously flush since we want the React updates made here to be applied
                        // in the same render as our WebSocket client's state `ValueStore` updates in
                        // response to this event.
                        //
                        // We want these state updates to happen at the same time since we're replacing
                        // the optimistic "unpersisted" resolution state from our state store with a
                        // more permanent update to the `commentThread` object. If these renders don't
                        // happen at the same time the user may see the resolve button briefly flash
                        // into an incorrect state.
                        //
                        // Given our WebSocket client's state `ValueStore` is subscribed to using
                        // `useSyncExternalStore()` we'll already be synchronously rendering so it's ok
                        // to again synchronously render here.
                        flushSync(() => {
                            handlePersistedContentEvent(event.updatedCommentThread);
                        });
                    } else {
                        subscriber(event);
                    }
                }),
            [commentThread.id, handlePersistedContentEvent, subscribeToCommentThreadEvents],
        ),
    });

    useScrollToNewMessages({
        viewRef,
        inputRef,
        isInputStickyPositioned: isStickyPositioned,
        messages: comments,
        getItemKey: useCallback(
            (item: MessageListItem<DocumentCommentModel>) =>
                getMessageListItemKey(item, commentThread.id),
            [commentThread.id],
        ),
    });

    return (
        <MessageInput
            ref={useMergedRefs(inputRef, inputRefProp ?? null)}
            data-testid={`DocumentCommentInput:${commentThread.id}`}
            messageNoun="comment"
            isNotBottomBar={isStickyPositioned}
            messages={comments}
            onUpdateMessages={update =>
                onUpdateCommentThread(({commentThread, comments}) => ({
                    commentThread,
                    comments: update(comments),
                }))
            }
            createMessage={async input => {
                await procedures.createComment({
                    commentThreadId: commentThread.id,
                    parent: input.parent,
                    content: input.content,
                    fileIds: input.fileIds,
                });
            }}
            fileAttachmentTarget={fileAttachmentTarget}
            messageEditing={messageEditing}
            parent={parent}
            onParentClear={onParentClear}
            onJumpToMessage={onJumpToComment}
            onDeleteMessage={onDeleteComment}
            onShowTypingIndicator={() => {
                procedures
                    .startTypingInCommentInput({commentThreadId: commentThread.id})
                    // Don't show an error updating typing indicators to the user. We will see an
                    // error in our logs but the user won't see any weird behavior if the
                    // request fails.
                    .catch(error =>
                        reporter.logErrorWithoutDisplaying(
                            "Couldn’t update typing indicator",
                            error,
                        ),
                    );
            }}
            onHideTypingIndicator={() => {
                procedures
                    .stopTypingInCommentInput({commentThreadId: commentThread.id})
                    // Don't show an error updating typing indicators to the user. We will see an
                    // error in our logs but the user won't see any weird behavior if the
                    // request fails.
                    .catch(error =>
                        reporter.logErrorWithoutDisplaying(
                            "Couldn’t update typing indicator",
                            error,
                        ),
                    );
            }}
            withMobileMaxHeight={withMobileMaxHeight}
            onFocus={onFocus}
            onBeforeFocusFromReplyOrEditingChange={onBeforeFocusFromReplyOrEditingChange}
        />
    );
}
