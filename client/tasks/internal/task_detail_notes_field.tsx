import classNames from "classnames";
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
import {useReporter} from "~/client/design/reporter.js";
import {useEvents} from "~/client/helpers/lifecycle/use_event.js";
import {useStore} from "~/client/helpers/store/use_store.js";
import {useIsMobile} from "~/client/remix/use_is_mobile.js";
import {TaskDetailNotesContentEditorWebSocketClient} from "~/client/tasks/internal/task_detail_notes_content_editor_web_socket_client.js";
import {TaskUndoStackEntry} from "~/client/tasks/internal/use_task_undo_stack_state.js";
import {useWebSocketErrorDialog} from "~/client/web_socket/use_web_socket.js";
import {screenPaddingX} from "~/shared/design/spacing.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.js";
import {noop} from "~/shared/helpers/control/noop.js";
import {TaskId} from "~/shared/id/types/id_types.js";
import {contentSchemaStyles, sprinkles, tasksStyles} from "~/shared/styles/styles.js";
import {
    taskDetailNotesFieldLabelPaddingBottom,
    taskDetailViewFieldLabelFontSize,
} from "~/shared/styles/tasks_shared_styles.js";
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
        withMobileLayout,
        taskId,
        initialNotesVersion,
        initialNotesContent,
        isReadOnly,
        pushUndoStackEntry,
        pushUndoStackEntryFromRedo,
        pushRedoStackEntry,
        notesClient,
        setNotesClient,
    }: {
        withMobileLayout: boolean;
        taskId: TaskId;
        initialNotesVersion: number;
        initialNotesContent: TaskNotesContentWithReferences;
        isReadOnly: boolean;
        pushUndoStackEntry: Memo<(entry: TaskUndoStackEntry) => void>;
        pushUndoStackEntryFromRedo: Memo<(entry: TaskUndoStackEntry) => void>;
        pushRedoStackEntry: Memo<(entry: TaskUndoStackEntry) => void>;
        notesClient: TaskDetailNotesContentEditorWebSocketClient;
        setNotesClient: React.Dispatch<
            React.SetStateAction<TaskDetailNotesContentEditorWebSocketClient>
        >;
    },
    ref: Ref<TaskDetailNotesFieldRef>,
) {
    const context = useAppContext();
    const isMobile = useIsMobile();
    const reporter = useReporter();

    const events = useEvents({
        getContext: () => context,
        getReporter: () => reporter,
    });

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

    // const [client, setClient] = useState(() => {
    //     return new TaskDetailNotesContentEditorWebSocketClient(events.getContext, {
    //         taskId,
    //         initialNotesVersion,
    //         initialNotesContent,
    //         displayError: (title, error) => events.getReporter().displayError(title, error),
    //     });
    // });

    // Re-initialize state if the `TaskId` changes.
    if (notesClient.taskId !== taskId) {
        setNotesClient(() => {
            return new TaskDetailNotesContentEditorWebSocketClient(events.getContext, {
                taskId,
                initialNotesVersion,
                initialNotesContent,
                displayError: (title, error) => events.getReporter().displayError(title, error),
            });
        });
    }

    const [shouldConnect] = useState(true);

    useEffect(() => {
        if (!shouldConnect) return;

        notesClient.connect();
        return () => {
            notesClient.disconnect();
        };
    }, [notesClient, shouldConnect]);

    const state = useStore(notesClient.state);
    const webSocketState = useStore(notesClient.webSocketState);

    // Show the "Lost connection" error dialog if any error occurs in our WebSocket
    // connection.
    useWebSocketErrorDialog(
        notesClient,
        webSocketState?.hasError ? webSocketState : state.errorState,
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
                    color: "grey-60",
                })}
                // Affordance for mouse users. Clicking on a label focuses the editor.
                onClick={() => {
                    editorRef.current?.focus();
                }}
            >
                Notes
            </span>
            <FocusRing
                insetX={screenPaddingX[isMobile ? "mobile" : "desktop"]}
                isVisibleWhenFocusWithin
            >
                {isReadOnly ? (
                    <Box className={tasksStyles.detailNotesContentEditorClassName}>
                        <ContentView
                            aria-labelledby={labelId}
                            withMobileLayout={withMobileLayout}
                            content={state.editorState.getContent()}
                            placeholder="Add more details…"
                            className={sprinkles({
                                paddingX: contentSchemaStyles.screenPaddingXWithoutBlockPaddingX,
                            })}
                        />
                    </Box>
                ) : (
                    <Box>
                        <ContentEditor
                            ref={editorRef}
                            aria-labelledby={labelId}
                            withMobileLayout={withMobileLayout}
                            state={state.editorState}
                            onChange={state => notesClient.changeEditorState(state)}
                            placeholder="Add more details…"
                            className={classNames(
                                tasksStyles.detailNotesContentEditorClassName,
                                sprinkles({
                                    paddingX:
                                        contentSchemaStyles.screenPaddingXWithoutBlockPaddingX,
                                }),
                            )}
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
