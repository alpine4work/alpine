import classNames from "classnames";
import {Memo, Ref, forwardRef, useId, useImperativeHandle, useMemo, useRef} from "react";
import {ContentEditor, ContentEditorRef} from "~/client/web/content/content_editor.js";
import {ContentView} from "~/client/web/content/content_view.js";
import {ContentEditorState} from "~/client/web/content/state/content_editor_state.js";
import {Box} from "~/client/web/design/box.js";
import {FocusRing} from "~/client/web/design/focus_ring.js";
import {useStore} from "~/client/web/helpers/use_store.js";
import {usePlatform} from "~/client/web/remix/platform_context.js";
import {sprinkles, tasksStyles} from "~/client/web/styles/styles.js";
import {
    taskDetailNotesFieldLabelPaddingBottom,
    taskDetailViewFieldLabelColor,
    taskDetailViewFieldLabelFontSize,
} from "~/client/web/styles/tasks_shared_styles.js";
import {TaskUndoStackEntry} from "~/client/web/tasks/internal/use_task_undo_stack_state.js";
import {TaskNotesContentEditorState} from "~/client/web/tasks/task_detail_notes_content_editor_web_socket_client.js";
import {useWebSocketErrorDialog} from "~/client/web/web_socket/use_web_socket.js";
import {screenPaddingX} from "~/shared/design/core/spacing.js";
import {FileAttachmentTarget} from "~/shared/files/file_attachment_target.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.js";
import {noop} from "~/shared/helpers/control/noop.js";
import {TaskId} from "~/shared/id/types/id_types.js";
import {Store} from "~/shared/store/store.js";
import {TaskNotesContentWithReferences} from "~/shared/tasks/task_notes_content_schema.js";

export type TaskDetailNotesFieldRef = {
    isFocused(): boolean;
    focus(): void;
    getEditorIfExists(): ContentEditorRef<TaskNotesContentWithReferences> | null;
};

const TaskDetailNotesFieldForwardRef = forwardRef(TaskDetailNotesField);
export {TaskDetailNotesFieldForwardRef as TaskDetailNotesField};

function TaskDetailNotesField(
    {
        taskId,
        isWideProjectLayout,
        isReadOnly,
        pushUndoStackEntry,
        pushUndoStackEntryFromRedo,
        pushRedoStackEntry,
        notesEditorStateStore,
        onNotesEditorStateChange,
        reconnectNotesClient,
        ensureCreateTask,
    }: {
        taskId: TaskId;
        isWideProjectLayout: boolean;
        isReadOnly: boolean;
        pushUndoStackEntry: Memo<(entry: TaskUndoStackEntry) => void>;
        pushUndoStackEntryFromRedo: Memo<(entry: TaskUndoStackEntry) => void>;
        pushRedoStackEntry: Memo<(entry: TaskUndoStackEntry) => void>;
        notesEditorStateStore: Store<TaskNotesContentEditorState>;
        onNotesEditorStateChange: Memo<
            (state: ContentEditorState<TaskNotesContentWithReferences>) => void
        >;
        reconnectNotesClient: Memo<() => void>;
        ensureCreateTask: Memo<() => Promise<void>>;
    },
    ref: Ref<TaskDetailNotesFieldRef>,
) {
    const platform = usePlatform();

    const labelId = useId();
    const editorRef = useRef<ContentEditorRef<TaskNotesContentWithReferences>>(null);

    useImperativeHandle(
        ref,
        () => ({
            isFocused: () => !isReadOnly && assertExists(editorRef.current).isFocused(),
            focus: () => {
                if (isReadOnly) return;
                assertExists(editorRef.current).focus();
            },
            getEditorIfExists: () => {
                if (isReadOnly) return null;
                return assertExists(editorRef.current);
            },
        }),
        [isReadOnly],
    );

    const state = useStore(notesEditorStateStore);

    useWebSocketErrorDialog(
        useMemo(() => ({reconnect: reconnectNotesClient}), [reconnectNotesClient]),
        state.errorState,
    );

    const fileAttachmentTarget = useMemo(
        (): FileAttachmentTarget => ({type: "TaskNotes", taskId}),
        [taskId],
    );

    return (
        <Box>
            <span
                id={labelId}
                className={sprinkles({
                    display: "inline-block",
                    paddingX: screenPaddingX,
                    paddingBottom: taskDetailNotesFieldLabelPaddingBottom,
                    fontSize: taskDetailViewFieldLabelFontSize,
                    color: taskDetailViewFieldLabelColor,
                })}
                // Affordance for mouse users. Clicking on a label focuses the editor.
                onClick={() => {
                    editorRef.current?.focus();
                }}
            >
                Notes
            </span>
            <FocusRing insetX={screenPaddingX[platform]} isVisibleWhenFocusWithin>
                {isReadOnly ? (
                    <Box
                        className={
                            isWideProjectLayout
                                ? tasksStyles.projectDetailNotesContentEditorClassName
                                : tasksStyles.detailNotesContentEditorClassName
                        }
                    >
                        <ContentView
                            aria-labelledby={labelId}
                            content={state.editorState.getContent()}
                            fileAttachmentTarget={fileAttachmentTarget}
                            className={sprinkles({paddingX: screenPaddingX})}
                        />
                    </Box>
                ) : (
                    <Box>
                        <ContentEditor
                            ref={editorRef}
                            aria-labelledby={labelId}
                            state={state.editorState}
                            onChange={onNotesEditorStateChange}
                            placeholder="Add more details…"
                            fileAttachmentTarget={fileAttachmentTarget}
                            // Mentioning a person is probably the last thing you want to do while working
                            // on task notes since mentions won't send a notification when typing in
                            // task notes.
                            mentionFloaterSectionOrder="SuggestedInsertPeople"
                            className={classNames(
                                isWideProjectLayout
                                    ? tasksStyles.projectDetailNotesContentEditorClassName
                                    : tasksStyles.detailNotesContentEditorClassName,
                                sprinkles({paddingX: screenPaddingX}),
                            )}
                            onUndoStackEntryPushed={() => {
                                pushUndoStackEntry({
                                    type: "Notes",
                                    rootParentTaskId: taskId,
                                    extra: null,
                                    taskId,
                                    contentEditorRef: editorRef,
                                    release: noop,
                                });
                            }}
                            onUndoStackEntryPushedFromRedo={() => {
                                pushUndoStackEntryFromRedo({
                                    type: "Notes",
                                    rootParentTaskId: taskId,
                                    extra: null,
                                    taskId,
                                    contentEditorRef: editorRef,
                                    release: noop,
                                });
                            }}
                            onRedoStackEntryPushed={() => {
                                pushRedoStackEntry({
                                    type: "Notes",
                                    rootParentTaskId: taskId,
                                    extra: null,
                                    taskId,
                                    contentEditorRef: editorRef,
                                    release: noop,
                                });
                            }}
                            onEnsureFileAttachmentTarget={ensureCreateTask}
                        />
                    </Box>
                )}
            </FocusRing>
        </Box>
    );
}
