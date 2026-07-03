import {Memo, Ref, useMemo} from "react";
import {MessageInputRef} from "~/client/web/content/messaging/message_input_base.js";
import {useReporter} from "~/client/web/design/reporter.js";
import {useEvent} from "~/client/web/helpers/lifecycle/use_event.js";
import {MessageEditing} from "~/client/web/messaging/message_editing.js";
import {MessageInput} from "~/client/web/messaging/message_input.js";
import {MessageList} from "~/client/web/messaging/message_list.js";
import {JumpToMessageRangeOptions} from "~/client/web/messaging/use_jump_to_message_range.js";
import {getClientInfo} from "~/client/web/remix/client_info_context.js";
import {TaskDetailNotesContentEditorWebSocketClientProcedures} from "~/client/web/tasks/task_detail_notes_content_editor_web_socket_client.js";
import {FileAttachmentTarget} from "~/shared/files/file_attachment_target.js";
import {TaskId} from "~/shared/id/types/id_types.js";
import {MessageDraftWithFiles} from "~/shared/messaging/message_draft_schema.js";
import {MessageContentPayloadParent} from "~/shared/messaging/message_schema.js";
import {TaskCommentModel} from "~/shared/tasks/model/task_comment_model.js";

export function TaskCommentInput({
    isGhostTask,
    taskId,
    inputRef,
    procedures,
    comments,
    fileAttachmentTarget,
    onUpdateComments,
    commentEditing,
    parent,
    onParentClear,
    onParentChange,
    onJumpToCommentRange,
    ensureCreateTask,
    messageDraft,
}: {
    isGhostTask: boolean;
    taskId: TaskId;
    inputRef: Ref<MessageInputRef>;
    procedures: TaskDetailNotesContentEditorWebSocketClientProcedures;
    comments: MessageList<TaskCommentModel>;
    fileAttachmentTarget: Memo<FileAttachmentTarget>;
    onUpdateComments: (
        update: (comments: MessageList<TaskCommentModel>) => MessageList<TaskCommentModel>,
    ) => void;
    commentEditing: MessageEditing<TaskId>;
    parent: MessageContentPayloadParent | null;
    onParentClear: () => void;
    onParentChange: (parent: MessageContentPayloadParent | null) => void;
    onJumpToCommentRange: (options: JumpToMessageRangeOptions<TaskId>) => void;
    ensureCreateTask: Memo<() => Promise<void>>;
    messageDraft?: MessageDraftWithFiles;
}) {
    const reporter = useReporter();

    const getProcedures = useEvent(() => procedures);

    const draftSurface = useMemo(
        () => (!isGhostTask ? ({type: "TaskComment" as const, taskId} as const) : undefined),
        [isGhostTask, taskId],
    );

    return (
        <MessageInput
            ref={inputRef}
            messageNoun="comment"
            isNotBottomBar={true}
            // `<TaskDetailView>` sets `alwaysRegisterBottomBarFrame` to true. It's not a
            // "native mobile" bottom bar but it IS the only bottom bar in the virtualized
            // scroll view. It's just sticky via `position: sticky` instead of
            // `display: flex; flex-direction: column` (like `<ChatView>`) because we want the
            // message input to be hidden while you're looking at subtasks. (We're deprecating
            // our native mobile app so `isBottomBar` doesn't exactly make sense any more. We
            // should maybe remove it.)
            alwaysRegisterBottomBarFrame={true}
            messages={comments}
            onUpdateMessages={onUpdateComments}
            ensureFileAttachmentTarget={async () => {
                // Make sure the task is created (and this isn't a ghost task) before creating a
                // comment. This needs to run before we attach files to the comment.
                await ensureCreateTask();

                return fileAttachmentTarget;
            }}
            createMessage={async input => {
                // It's important we call `getProcedures()` to get the latest `procedures` object
                // instead of the stale one this closure captured at the start of
                // `await ensureCreateTask()`.
                //
                // If we're indeed creating a task then before `await ensureCreateTask()` is called
                // we have a `procedures` object that pushes pending procedure calls to an array.
                // After `await ensureCreateTask()` finishes the `<TaskCommentInput>` component
                // will have re-rendered and the `procedures` object will directly make procedure
                // calls on the underlying WebSocket. However, if we use the `procedures` variable
                // here we'll have the old version captured by this closure (React sure can be
                // frustrating sometimes) which will do nothing.
                await getProcedures().createComment({
                    parent: input.parent,
                    content: input.content,
                    fileIds: input.fileIds,
                    createdTimeZone: getClientInfo().timeZone,
                });
            }}
            // If this is a ghost task then we shouldn't attach files to the
            // `fileAttachmentTarget` until before we send the message. Since the task won't
            // exist yet!
            fileAttachmentTarget={!isGhostTask ? fileAttachmentTarget : null}
            messageEditing={commentEditing}
            parent={parent}
            onParentClear={onParentClear}
            onParentChange={onParentChange}
            onJumpToMessageRange={onJumpToCommentRange}
            onDeleteMessage={async commentIndex => {
                await procedures.deleteComment({commentIndex});
            }}
            onShowTypingIndicator={() => {
                // Don't show an error updating typing indicators to the user. We will see an error
                // in our logs but the user won't see any weird behavior if the request fails.
                procedures
                    .startTypingInCommentInput({})
                    .catch(error =>
                        reporter.logErrorWithoutDisplaying(
                            "Couldn\u2019t update typing indicator",
                            error,
                        ),
                    );
            }}
            onHideTypingIndicator={() => {
                // Don't show an error updating typing indicators to the user. We will see an error
                // in our logs but the user won't see any weird behavior if the request fails.
                procedures
                    .stopTypingInCommentInput({})
                    .catch(error =>
                        reporter.logErrorWithoutDisplaying(
                            "Couldn\u2019t update typing indicator",
                            error,
                        ),
                    );
            }}
            messageDraftSurface={draftSurface}
            messageDraft={messageDraft}
        />
    );
}
