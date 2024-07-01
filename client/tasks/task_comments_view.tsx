import {Memo, ReactNode, Ref, useCallback, useEffect, useMemo, useRef, useState} from "react";
import {useAppContext} from "~/client/context/app_context.js";
import {Box} from "~/client/design/box.js";
import {navigationBarHeight} from "~/client/design/navigation_bar.js";
import {ScrollbarInsetDynamic} from "~/client/design/scrollbar.js";
import {Spacer} from "~/client/design/spacer.js";
import {
    MessagingView,
    MessagingViewRef,
    getInitialLoadMessageCount,
} from "~/client/messaging/messaging_view.js";
import {useClientInfo} from "~/client/remix/client_info_context.js";
import {useIsMobile} from "~/client/remix/use_is_mobile.js";
import {TaskDetailNotesContentEditorWebSocketClient} from "~/client/tasks/task_detail_notes_content_editor_web_socket_client.js";
import {useWebSocket} from "~/client/web_socket/use_web_socket.js";
import {spacing} from "~/shared/design/spacing.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.js";
import {TaskId} from "~/shared/id/types/id_types.js";
import {MessageContent} from "~/shared/messaging/message_content_schema.js";
import {MessagingRealtimeEvent} from "~/shared/messaging/messaging_realtime_protocol.js";
import {
    getTaskCommentsFromEnd,
    getTaskCommentsFromStart,
} from "~/shared/rpc/tasks_rpc_definitions.js";
import {TaskCommentModel} from "~/shared/tasks/model/task_comment_model.js";
import {
    TaskNotesCollaborationEvent,
    TaskNotesCollaborationProtocol,
} from "~/shared/tasks/task_notes_collaboration_protocol.js";

type TaskCommentsViewInitialComments = {
    commentCount: number;
    lastCommentChangeTime: Date | null;
    comments: ReadonlyArray<TaskCommentModel>;
    otherReferencedComments: ReadonlyArray<TaskCommentModel>;
};

type TaskCommentsViewProps = {
    taskId: TaskId;
    withMobileLayout: boolean;
    initialScrollToCommentIndex: number | null;
    getCommentUrl: Memo<(messageIndex: number) => URL>;
    initialComments: TaskCommentsViewInitialComments | null;
    notesClient: TaskDetailNotesContentEditorWebSocketClient;
    scrollViewRef?: Ref<HTMLDivElement>;
    extraChildren?: ReactNode;
    scrollbarInsetTop?: ScrollbarInsetDynamic;
};

export function TaskCommentsView({
    taskId,
    withMobileLayout,
    initialScrollToCommentIndex,
    getCommentUrl,
    initialComments: initialCommentsFromProps,
    notesClient,
    scrollViewRef,
    extraChildren,
    scrollbarInsetTop,
}: TaskCommentsViewProps) {
    const context = useAppContext();
    const messagingRef = useRef<MessagingViewRef>(null);
    const [initialComments, setInitialComments] = useState(initialCommentsFromProps);

    const [errorState, setErrorState] = useState({hasError: false, error: {}});
    if (errorState.hasError) throw errorState.error;

    const isMobile = useIsMobile();

    const clientInfo = useClientInfo();

    const isLoadingInitialCommentsRef = useRef(false);
    useEffect(() => {
        if (initialComments) return;
        if (errorState.hasError) return;

        if (isLoadingInitialCommentsRef.current) return;
        isLoadingInitialCommentsRef.current = true;

        const limit = getInitialLoadMessageCount(clientInfo);

        getTaskCommentsFromEnd(context, {
            taskId,
            limit,
            afterCommentIndex: null,
            beforeCommentIndex: null,
        }).then(
            taskComment => {
                isLoadingInitialCommentsRef.current = false;
                setInitialComments({
                    commentCount: taskComment.commentCount,
                    lastCommentChangeTime: taskComment.lastCommentChangeTime,
                    comments: taskComment.comments,
                    otherReferencedComments: taskComment.otherReferencedComments,
                });
            },
            error => {
                isLoadingInitialCommentsRef.current = false;
                setErrorState({hasError: true, error});
            },
        );
    }, [initialComments, context, taskId, clientInfo, errorState.hasError]);

    const {isConnected, procedures, subscribeToEvents} = useWebSocket(
        "TaskNotesCollaborationService",
        TaskNotesCollaborationProtocol,
        `/api/durable-objects/task-notes/${taskId}`,
    );

    const hasInitializedRef = useRef(false);

    // TODO(calebmer): Support server-side rendering for immediately jumping to a
    // comment in the middle of a post. This will make transitions seamless when
    // you click on a link to a comment.
    useEffect(() => {
        if (!initialComments) return;

        if (hasInitializedRef.current) return;
        hasInitializedRef.current = true;

        const messaging = assertExists(messagingRef.current);

        if (initialScrollToCommentIndex !== null)
            messaging.jumpToMessageIndex(initialScrollToCommentIndex);
    }, [initialScrollToCommentIndex, initialComments]);

    const header = useMemo(() => {
        if (!withMobileLayout) {
            const space = "6";
            return {
                minHeight: spacing[space],
                node: <Spacer space={space} />,
            };
        } else {
            return {
                minHeight: spacing[navigationBarHeight[isMobile ? "mobile" : "desktop"]],
                node: (
                    <>
                        <Box height="safe-area-inset-top" />
                        <Box marginBottom={"3"} height={navigationBarHeight} />
                    </>
                ),
            };
        }
    }, [withMobileLayout, isMobile]);

    const getMessagesFromStart = useCallback(
        async (input: {
            limit: number;
            afterMessageIndex: number | null;
            beforeMessageIndex: number | null;
        }) => {
            const {commentCount, comments, otherReferencedComments, lastCommentChangeTime} =
                await getTaskCommentsFromStart(context, {
                    taskId,
                    limit: input.limit,
                    afterCommentIndex: input.afterMessageIndex,
                    beforeCommentIndex: input.beforeMessageIndex,
                });
            return {
                messageCount: commentCount,
                messages: comments,
                otherReferencedMessages: otherReferencedComments,
                lastMessageChangeTime: lastCommentChangeTime,
            };
        },
        [taskId, context],
    );

    const getMessagesFromEnd = useCallback(
        async (input: {
            limit: number;
            afterMessageIndex: number | null;
            beforeMessageIndex: number | null;
        }) => {
            const {commentCount, comments, otherReferencedComments, lastCommentChangeTime} =
                await getTaskCommentsFromEnd(context, {
                    taskId,
                    limit: input.limit,
                    afterCommentIndex: input.afterMessageIndex,
                    beforeCommentIndex: input.beforeMessageIndex,
                });
            return {
                messageCount: commentCount,
                messages: comments,
                otherReferencedMessages: otherReferencedComments,
                lastMessageChangeTime: lastCommentChangeTime,
            };
        },
        [taskId, context],
    );

    const backfillMessages = useCallback(
        async ({
            clientMessageCount: clientCommentCount,
            clientLastMessageChangeTime: clientLastCommentChangeTime,
            newMessageLimit: newCommentLimit,
        }: {
            clientMessageCount: number;
            clientLastMessageChangeTime: Date | null;
            newMessageLimit: number;
        }) => {
            const {
                commentCount: messageCount,
                lastCommentChangeTime: lastMessageChangeTime,
                newComments: newMessages,
                newOtherReferencedComments: newOtherReferencedMessages,
                commentChangesResult: messageChangesResult,
                typingStateByConnectionId,
            } = await notesClient.procedures.backfillComments({
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
        [notesClient.procedures],
    );

    const createMessage = useCallback(
        (input: {content: MessageContent; parentMessageIndex: number | null}) => {
            return notesClient.procedures.createComment({
                content: input.content,
                parentCommentIndex: input.parentMessageIndex,
            });
        },
        [notesClient.procedures],
    );

    const updateMessageContent = useCallback(
        (input: {messageIndex: number; content: MessageContent}) => {
            return notesClient.procedures.updateCommentContent({
                commentIndex: input.messageIndex,
                content: input.content,
            });
        },
        [notesClient.procedures],
    );

    const deleteMessage = useCallback(
        (input: {messageIndex: number}) => {
            return notesClient.procedures.deleteComment({
                commentIndex: input.messageIndex,
            });
        },
        [notesClient.procedures],
    );

    const subscribeToEventsCallback = useCallback(
        (subscriber: (message: MessagingRealtimeEvent<TaskCommentModel>) => void) => {
            const actualSubscriber = (event: TaskNotesCollaborationEvent) => {
                switch (event.type) {
                    case "PersistedContent": {
                        break;
                    }
                    case "Comments": {
                        subscriber(event.event);
                        break;
                    }
                    case "UpdateNotesContentWithoutPersistence": {
                        break;
                    }
                    default:
                        throw exhaustive(event);
                }
            };

            return subscribeToEvents(actualSubscriber);
        },
        [subscribeToEvents],
    );

    if (!initialComments) {
        return <>Loading shimmer...</>;
    } else {
        return (
            <MessagingView
                ref={messagingRef}
                elementRef={scrollViewRef}
                extraChildren={extraChildren}
                scrollbarInsetTop={scrollbarInsetTop}
                withMobileLayout={withMobileLayout}
                initialScrollOffset="bottom"
                messageNoun="comment"
                initialMessagesResult={{
                    messageCount: initialComments.commentCount,
                    messages: initialComments.comments,
                    otherReferencedMessages: initialComments.otherReferencedComments,
                    lastMessageChangeTime: initialComments.lastCommentChangeTime,
                }}
                header={header}
                randomSeedForShimmer={taskId}
                getMessagesFromStart={getMessagesFromStart}
                getMessagesFromEnd={getMessagesFromEnd}
                backfillMessages={backfillMessages}
                createMessage={createMessage}
                updateMessageContent={updateMessageContent}
                deleteMessage={deleteMessage}
                startTypingInMessageInput={notesClient.procedures.startTypingInCommentInput}
                stopTypingInMessageInput={notesClient.procedures.stopTypingInCommentInput}
                isConnected={isConnected}
                subscribeToEvents={subscribeToEventsCallback}
                getMessageUrl={getCommentUrl}
            />
        );
    }
}
