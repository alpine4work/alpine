import {
    Memo,
    Ref,
    forwardRef,
    useEffect,
    useId,
    useImperativeHandle,
    useRef,
    useState,
} from "react";
import {ContentEditor, ContentEditorRef} from "~/client/content/content_editor.js";
import {ContentView} from "~/client/content/content_view.js";
import {useAppContext} from "~/client/context/app_context.js";
import {Box} from "~/client/design/box.js";
import {FocusRing} from "~/client/design/focus_ring.js";
import {ErrorToast, useShowToast} from "~/client/design/toast.js";
import {useEvents} from "~/client/helpers/lifecycle/use_event.js";
import {useStore} from "~/client/helpers/store/use_store.js";
import {TaskDetailNotesContentEditorWebSocketClient} from "~/client/tasks/internal/task_detail_notes_content_editor_web_socket_client.js";
import {TaskUndoStackEntry} from "~/client/tasks/internal/use_task_undo_stack_state.js";
import {Spacing, assertSpacing} from "~/shared/design/spacing.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.js";
import {noop} from "~/shared/helpers/control/noop.js";
import {TaskId} from "~/shared/id/types/id_types.js";
import {sprinkles} from "~/shared/styles/styles.js";
import {TaskNotesContentWithReferences} from "~/shared/tasks/task_notes_content_schema.js";

export type TaskDetailNotesFieldRef = {
    isFocused(): boolean;
    focus(): void;
};

const TaskDetailNotesFieldForwardRef = forwardRef(TaskDetailNotesField);
export {TaskDetailNotesFieldForwardRef as TaskDetailNotesField};

function TaskDetailNotesField(
    {
        taskId,
        initialNotesVersion,
        initialNotesContent,
        isReadOnly,
        padding,
        pushUndoStackEntry,
        pushUndoStackEntryFromRedo,
        pushRedoStackEntry,
    }: {
        taskId: TaskId;
        initialNotesVersion: number;
        initialNotesContent: TaskNotesContentWithReferences;
        isReadOnly: boolean;
        padding: Spacing;
        pushUndoStackEntry: Memo<(entry: TaskUndoStackEntry) => void>;
        pushUndoStackEntryFromRedo: Memo<(entry: TaskUndoStackEntry) => void>;
        pushRedoStackEntry: Memo<(entry: TaskUndoStackEntry) => void>;
    },
    ref: Ref<TaskDetailNotesFieldRef>,
) {
    const context = useAppContext();
    const showToast = useShowToast();

    const events = useEvents({
        getContext: () => context,
        showToast: (toast: ErrorToast) => showToast(toast),
    });

    const labelId = useId();
    const editorRef = useRef<ContentEditorRef>(null);

    useImperativeHandle(
        ref,
        () => ({
            isFocused: () => !isReadOnly && assertExists(editorRef.current).isFocused(),
            focus: () => {
                if (isReadOnly) return;
                assertExists(editorRef.current).focus();
            },
        }),
        [isReadOnly],
    );

    const [client, setClient] = useState(() => {
        return new TaskDetailNotesContentEditorWebSocketClient(events.getContext, {
            taskId,
            initialNotesVersion,
            initialNotesContent,
            showToast: events.showToast,
        });
    });

    // Re-initialize state if the `TaskId` changes.
    if (client.taskId !== taskId) {
        setClient(() => {
            return new TaskDetailNotesContentEditorWebSocketClient(events.getContext, {
                taskId,
                initialNotesVersion,
                initialNotesContent,
                showToast: events.showToast,
            });
        });
    }

    const [shouldConnect] = useState(true);

    useEffect(() => {
        if (!shouldConnect) return;

        client.connect();
        return () => {
            client.disconnect();
        };
    }, [client, shouldConnect]);

    const state = useStore(client.state);

    // TODO(calebmer): We probably want some retry mechanism for the user? But
    // until the user retries, we don't want an infinite loop where we keep trying
    // to update the document content.
    if (state?.errorState.hasError) throw state.errorState.error;

    // 20 perfectly fits 4 lines of regular text before the input needs to
    // start growing.
    const minHeight: Spacing = "20";

    return (
        <Box>
            <span
                id={labelId}
                className={sprinkles({
                    display: "inline-block",
                    paddingX: padding,
                    paddingBottom: "1",
                    color: "grey-60",
                })}
                // Affordance for mouse users. Clicking on a label focuses the editor.
                onClick={() => {
                    editorRef.current?.focus();
                }}
            >
                Notes
            </span>
            <FocusRing insetX={padding} isVisibleWhenFocusWithin>
                {isReadOnly ? (
                    <Box height="full" minHeight={minHeight}>
                        <ContentView
                            aria-labelledby={labelId}
                            content={state.editorState.getContent()}
                            placeholder="Add more details…"
                            className={sprinkles({
                                paddingX: assertSpacing(`${parseInt(padding, 10) - 2}`),
                            })}
                        />
                    </Box>
                ) : (
                    <Box>
                        <ContentEditor
                            ref={editorRef}
                            aria-labelledby={labelId}
                            state={state.editorState}
                            onChange={state => client.changeEditorState(state)}
                            placeholder="Add more details…"
                            className={sprinkles({
                                paddingX: assertSpacing(`${parseInt(padding, 10) - 2}`),
                                height: "full",
                                minHeight,
                            })}
                            onUndoStackEntryPushed={() => {
                                pushUndoStackEntry({
                                    type: "Notes",
                                    rootParentTaskId: taskId,
                                    taskId,
                                    contentEditorRef: editorRef,
                                    release: noop,
                                });
                            }}
                            onUndoStackEntryPushedFromRedo={() => {
                                pushUndoStackEntryFromRedo({
                                    type: "Notes",
                                    rootParentTaskId: taskId,
                                    taskId,
                                    contentEditorRef: editorRef,
                                    release: noop,
                                });
                            }}
                            onRedoStackEntryPushed={() => {
                                pushRedoStackEntry({
                                    type: "Notes",
                                    rootParentTaskId: taskId,
                                    taskId,
                                    contentEditorRef: editorRef,
                                    release: noop,
                                });
                            }}
                        />
                    </Box>
                )}
            </FocusRing>
        </Box>
    );
}
