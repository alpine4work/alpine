import {Step} from "prosemirror-transform";
import {Memo, ReactNode, Ref, useCallback, useEffect, useMemo, useRef, useState} from "react";
import {useAppContext} from "~/client/context/app_context.js";
import {Box} from "~/client/design/box.js";
import {ScrollbarInsetDynamic} from "~/client/design/scrollbar.js";
import {Spacer} from "~/client/design/spacer.js";
import {MemoObject} from "~/client/helpers/types/memo_object.js";
import {useErrorState} from "~/client/helpers/use_error_state.js";
import {getInitialLoadMessageCount} from "~/client/messaging/get_initial_load_message_count.js";
import {MessagingView, MessagingViewRef} from "~/client/messaging/messaging_view.js";
import {useClientInfo} from "~/client/remix/client_info_context.js";
import {useRouteLayout} from "~/client/remix/route_layout_context.js";
import {TaskCommentsViewShimmer} from "~/client/shimmer/route_shimmer.js";
import {taskCommentsHeaderNavigationBarSpacing} from "~/client/styles/tasks_shared_styles.js";
import {TaskDetailNotesContentEditorWebSocketClientProcedures} from "~/client/tasks/task_detail_notes_content_editor_web_socket_client.js";
import {spacing} from "~/shared/design/core/spacing.js";
import {FileAttachmentTarget} from "~/shared/files/file_attachment_target.js";
import {FileEntityId} from "~/shared/files/file_entity_id.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.js";
import {FileId, TaskId} from "~/shared/id/types/id_types.js";
import {MessageContent} from "~/shared/messaging/message_content_schema.js";
import {MessageContentPayloadParent} from "~/shared/messaging/message_schema.js";
import {MessagingRealtimeEvent} from "~/shared/messaging/messaging_realtime_protocol.js";
import {
    getTaskCommentsFromEnd,
    getTaskCommentsFromStart,
} from "~/shared/rpc/tasks_rpc_definitions.js";
import {TaskCommentModel} from "~/shared/tasks/model/task_comment_model.js";
import {ServerSynchronizationCheckpoint} from "~/shared/web_socket/server_synchronization_checkpoint.js";
import {WebSocketPongMessage} from "~/shared/web_socket/web_socket_schema.js";

export type TaskCommentsViewInitialComments = {
    checkpoint: ServerSynchronizationCheckpoint;
    commentCount: number;
    comments: ReadonlyArray<TaskCommentModel>;
    otherReferencedComments: ReadonlyArray<TaskCommentModel>;
};

export function TaskCommentsView({
    taskId,
    initialScrollToCommentIndex,
    getCommentUrl,
    initialComments: initialCommentsFromProps,
    onInitialCommentsAvailable,
    scrollViewRef,
    extraChildren,
    scrollbarInsetTop,
    isConnected,
    procedures,
    subscribeToEvents,
    subscribeToPongs,
}: {
    taskId: TaskId;
    initialScrollToCommentIndex: number | null;
    getCommentUrl: Memo<(messageIndex: number) => URL>;
    initialComments: TaskCommentsViewInitialComments | null;
    onInitialCommentsAvailable?: Memo<() => void>;
    scrollViewRef?: Ref<HTMLDivElement>;
    extraChildren?: ReactNode;
    scrollbarInsetTop?: ScrollbarInsetDynamic;
    isConnected: boolean;
    procedures: MemoObject<TaskDetailNotesContentEditorWebSocketClientProcedures>;
    subscribeToEvents: Memo<
        (subscriber: (event: MessagingRealtimeEvent<TaskCommentModel>) => void) => () => void
    >;
    subscribeToPongs: Memo<(subscriber: (message: WebSocketPongMessage) => void) => () => void>;
}) {
    const context = useAppContext();
    const routeLayout = useRouteLayout();
    const messagingRef = useRef<MessagingViewRef<TaskId>>(null);
    const [initialComments, setInitialComments] = useState(initialCommentsFromProps);

    const setErrorState = useErrorState();

    const clientInfo = useClientInfo();

    const isLoadingInitialCommentsRef = useRef(false);
    const hasCalledInitialCommentsAvailableRef = useRef(false);
    useEffect(() => {
        if (initialComments) {
            if (!hasCalledInitialCommentsAvailableRef.current) {
                hasCalledInitialCommentsAvailableRef.current = true;
                onInitialCommentsAvailable?.();
            }
            return;
        }

        if (isLoadingInitialCommentsRef.current) return;
        isLoadingInitialCommentsRef.current = true;

        const limit = getInitialLoadMessageCount(clientInfo);

        getTaskCommentsFromEnd(context, {
            taskId,
            limit,
            afterCommentIndex: null,
            beforeCommentIndex: null,
        }).then(
            output => {
                isLoadingInitialCommentsRef.current = false;
                setInitialComments(output);
            },
            error => {
                isLoadingInitialCommentsRef.current = false;
                setErrorState(error);
            },
        );
    }, [initialComments, context, taskId, clientInfo, setErrorState, onInitialCommentsAvailable]);

    const hasInitializedRef = useRef(false);

    // TODO(calebmer): Support server-side rendering for immediately jumping to a
    // comment in the middle of a post. This will make transitions seamless when
    // you click on a link to a comment.
    useEffect(() => {
        if (!initialComments) return;

        if (hasInitializedRef.current) return;
        hasInitializedRef.current = true;

        const messaging = assertExists(messagingRef.current);

        if (initialScrollToCommentIndex !== null) {
            messaging.jumpToMessageRange({
                roomKey: taskId,
                startIndex: initialScrollToCommentIndex,
                endIndex: initialScrollToCommentIndex,
                start: null,
                end: null,
            });
        }
    }, [initialScrollToCommentIndex, initialComments, taskId]);

    const header = useMemo(() => {
        if (routeLayout !== "narrow") {
            return {
                minHeight: spacing[taskCommentsHeaderNavigationBarSpacing],
                node: (
                    <>
                        <Box height="safe-area-inset-top"> </Box>
                        <Spacer space={taskCommentsHeaderNavigationBarSpacing} />
                    </>
                ),
            };
        } else
            return {
                minHeight: spacing[taskCommentsHeaderNavigationBarSpacing],
                node: (
                    <>
                        <Spacer space={taskCommentsHeaderNavigationBarSpacing} />
                    </>
                ),
            };
    }, [routeLayout]);

    const getMessagesFromStart = useCallback(
        async (input: {
            limit: number;
            afterMessageIndex: number | null;
            beforeMessageIndex: number | null;
        }) => {
            const {commentCount, comments, otherReferencedComments} =
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
            const {commentCount, comments, otherReferencedComments} = await getTaskCommentsFromEnd(
                context,
                {
                    taskId,
                    limit: input.limit,
                    afterCommentIndex: input.afterMessageIndex,
                    beforeCommentIndex: input.beforeMessageIndex,
                },
            );
            return {
                messageCount: commentCount,
                messages: comments,
                otherReferencedMessages: otherReferencedComments,
            };
        },
        [taskId, context],
    );

    const backfillMessages = useCallback(
        async ({
            checkpoint,
            clientMessageCount: clientCommentCount,
            newMessageLimit: newCommentLimit,
        }: {
            checkpoint: ServerSynchronizationCheckpoint;
            clientMessageCount: number;
            newMessageLimit: number;
        }) => {
            const {
                commentCount: messageCount,
                newComments: newMessages,
                newOtherReferencedComments: newOtherReferencedMessages,
                commentUpdatesResult: messageUpdatesResult,
                typingStateByConnectionId,
            } = await procedures.backfillComments({
                checkpoint,
                clientCommentCount,
                newCommentLimit,
            });

            return {
                messageCount,
                newMessages,
                newOtherReferencedMessages,
                messageUpdatesResult,
                typingStateByConnectionId,
            };
        },
        [procedures],
    );

    const createMessage = useCallback(
        (input: {
            content: MessageContent;
            parent: MessageContentPayloadParent | null;
            fileIds: ReadonlyArray<FileId | FileEntityId>;
        }) => {
            return procedures.createComment({
                content: input.content,
                parent: input.parent,
                fileIds: input.fileIds,
            });
        },
        [procedures],
    );

    const updateMessageContent = useCallback(
        (input: {messageIndex: number; contentVersion: number; steps: ReadonlyArray<Step>}) => {
            return procedures.updateCommentContent({
                commentIndex: input.messageIndex,
                contentVersion: input.contentVersion,
                steps: input.steps,
            });
        },
        [procedures],
    );

    const deleteMessage = useCallback(
        (input: {messageIndex: number}) => {
            return procedures.deleteComment({
                commentIndex: input.messageIndex,
            });
        },
        [procedures],
    );

    const fileAttachmentTarget = useMemo(
        (): FileAttachmentTarget => ({type: "TaskComments", taskId}),
        [taskId],
    );

    if (!initialComments) {
        return <TaskCommentsViewShimmer />;
    } else {
        return (
            <MessagingView
                ref={messagingRef}
                elementRef={scrollViewRef}
                extraChildren={extraChildren}
                scrollbarInsetTop={scrollbarInsetTop}
                initialScrollOffset="bottom"
                messageNoun="comment"
                initialMessagesResult={{
                    checkpoint: initialComments.checkpoint,
                    messageCount: initialComments.commentCount,
                    messages: initialComments.comments,
                    otherReferencedMessages: initialComments.otherReferencedComments,
                }}
                header={header}
                randomSeedForShimmer={taskId}
                fileAttachmentTarget={fileAttachmentTarget}
                getMessagesFromStart={getMessagesFromStart}
                getMessagesFromEnd={getMessagesFromEnd}
                // TODO(calebmer, #typescript-5.9.2): Discovered after TS version upgrade, not
                // fixing for now. Only errs when Bazel runs TypeScript which is strange.
                // eslint-disable-next-line @typescript-eslint/prefer-ts-expect-error
                // @ts-ignore
                backfillMessages={backfillMessages}
                createMessage={createMessage}
                updateMessageContent={updateMessageContent}
                deleteMessage={deleteMessage}
                startTypingInMessageInput={procedures.startTypingInCommentInput}
                stopTypingInMessageInput={procedures.stopTypingInCommentInput}
                isConnected={isConnected}
                // TODO(calebmer, #typescript-5.9.2): Discovered after TS version upgrade, not
                // fixing for now. Only errs when Bazel runs TypeScript which is strange.
                // eslint-disable-next-line @typescript-eslint/prefer-ts-expect-error
                // @ts-ignore
                subscribeToEvents={subscribeToEvents}
                subscribeToPongs={subscribeToPongs}
                getMessageUrl={getCommentUrl}
            />
        );
    }
}
