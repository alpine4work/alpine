import {
    Memo,
    Ref,
    forwardRef,
    useCallback,
    useEffect,
    useId,
    useImperativeHandle,
    useReducer,
    useRef,
} from "react";
import {
    CollaborativeContentEditorAction,
    CollaborativeContentEditorState,
    createCollaborativeContentEditorStateReducer,
    getInitialCollaborativeContentEditorState,
} from "~/client/content/collaborative_content_editor_state.js";
import {ContentEditor, ContentEditorRef} from "~/client/content/content_editor.js";
import {reduceContentReferences} from "~/client/content/content_editor_state.js";
import {ContentView} from "~/client/content/content_view.js";
import {Box} from "~/client/design/box.js";
import {FocusRing} from "~/client/design/focus_ring.js";
import {useShowToast} from "~/client/design/toast.js";
import {useDevConsoleTool} from "~/client/dev/dev_console.js";
import {useEvent} from "~/client/helpers/lifecycle/use_event.js";
import {runWithImmediatePriority} from "~/client/helpers/run_with_immediate_priority.js";
import {TaskUndoStackEntry} from "~/client/tasks/internal/use_task_undo_stack_state.js";
import {useWebSocket} from "~/client/web_socket/use_web_socket.js";
import {Spacing, assertSpacing} from "~/shared/design/spacing.js";
import {UnavailableError} from "~/shared/error/error.js";
import {errorDisplayMessage} from "~/shared/error/error_display_message.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.js";
import {cast} from "~/shared/helpers/control/cast.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.js";
import {noop} from "~/shared/helpers/control/noop.js";
import {Id, generateId} from "~/shared/id/id.js";
import {TaskId} from "~/shared/id/types/id_types.js";
import {sprinkles} from "~/shared/styles/styles.js";
import {TaskNotesCollaborationProtocol} from "~/shared/tasks/task_notes_collaboration_protocol.js";
import {TaskNotesContentWithReferences} from "~/shared/tasks/task_notes_content_schema.js";

type TaskNotesContentEditorState = CollaborativeContentEditorState<
    TaskNotesContentWithReferences,
    TaskNotesContentEditorExtraState
>;

type TaskNotesContentEditorExtraState = {
    readonly taskId: TaskId;
};

type TaskNotesContentEditorAction = CollaborativeContentEditorAction<
    TaskNotesContentWithReferences,
    TaskNotesContentEditorExtraAction
>;

type TaskNotesContentEditorExtraAction = {
    readonly type: "Reset";
    readonly state: TaskNotesContentEditorState;
};

const reduceCollaborativeContentEditorState = createCollaborativeContentEditorStateReducer<
    TaskNotesContentWithReferences,
    TaskNotesContentEditorExtraState,
    TaskNotesContentEditorExtraAction
>((state, action) => {
    if (action.type === "Extra") {
        cast<"Reset">(action.extra.type);
        return action.extra.state;
    }

    return state;
});

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
    const showToast = useShowToast();

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

    const [state, _dispatch] = useReducer(
        reduceCollaborativeContentEditorState,
        {
            initialVersion: initialNotesVersion,
            initialContent: initialNotesContent,
            reduceReferences: reduceContentReferences,
            extra: {taskId},
            // We incorporate notes undo/redo into the task system's undo/redo stack.
            disableUndoKeyboardShortcuts: true,
        },
        getInitialCollaborativeContentEditorState,
    );

    const dispatch = useCallback((actions: ReadonlyArray<TaskNotesContentEditorAction>) => {
        // It is essential for correctness that actions which change `editorState` run
        // immediately. Consider the case where we receive some steps from the server
        // (`ReceiveSteps` action) and the user makes an edit (`Edit` action) at the
        // exact same time.
        //
        // React gives the `ReceiveSteps` action a lower priority since it came from a
        // WebSocket message. It runs the reducer then *cancels* the React re-render
        // since an `Edit` comes in at a high, user interaction, priority.
        //
        // When we receive an action that changes `editorState`, we need React to
        // immediately re-render the component with the new state so if a user types in
        // their ProseMirror `EditorView` it is applied on top of the `editorState` we
        // received from the server.
        runWithImmediatePriority(() => {
            _dispatch(actions);
        });
    }, []);

    const getState = useEvent(() => state);

    // If the `TaskId` changes then we need to reset our state since we're
    // connecting to a different notes backend.
    if (state.extra.taskId !== taskId) {
        dispatch([
            {
                type: "Extra",
                extra: {
                    type: "Reset",
                    state: getInitialCollaborativeContentEditorState({
                        initialVersion: initialNotesVersion,
                        initialContent: initialNotesContent,
                        reduceReferences: reduceContentReferences,
                        extra: {taskId},
                    }),
                },
            },
        ]);
    }

    // TODO(calebmer): Instead of a component error, WebSocket connection errors
    // should probably be a big blocking modal that the user can retry?
    if (state.errorState.hasError) throw state.errorState.error;

    const {
        isConnected,
        procedures: {backfill, updateContent},
        toggleShouldConnect,
    } = useWebSocket(
        TaskNotesCollaborationProtocol,
        `/api/durable-objects/task-notes/${taskId}`,
        event => {
            switch (event.type) {
                case "UpdateContentWithoutPersistence": {
                    dispatch([
                        {
                            type: "ReceiveSteps",
                            newVersion: event.newVersion,
                            steps: event.steps.map(step => ({
                                step,
                                clientId: event.clientId,
                            })),
                            stepsContentReferences: event.stepsContentReferences,
                        },
                    ]);
                    break;
                }
                case "PersistedContent": {
                    // TODO(calebmer, #global-loading-indicator): Show a saving indicator until
                    // content has persisted!
                    //
                    // TODO(calebmer, #unsaved-changes-confirmation): User should not be able to
                    // close the page if we haven't finished saving their document. It will
                    // look ok on their machine but might not be on the server.
                    break;
                }
                default:
                    throw exhaustive(event);
            }
        },
    );

    useDevConsoleTool("taskNotesContentEditor", () => ({toggleShouldConnect}));

    // When we first connect to our WebSocket or reconnect after a disconnect, send
    // a backfill request to update our local notes state to the latest version.
    //
    // We use `connectionIdRef` to make sure we only run the backfill once per
    // connection.
    const connectionIdRef = useRef<Id | null>(null);
    useEffect(() => {
        if (!isConnected) {
            connectionIdRef.current = null;
            return;
        }

        if (connectionIdRef.current) return;
        const connectionId = generateId();
        connectionIdRef.current = connectionId;

        backfill({
            version: getState().editorState.getVersion(),
        })
            .then(output => {
                // If while waiting on our backfill we disconnected then don't update
                // our state. We use an `Id` to make sure if we connect/reconnect quickly we
                // still ignore the backfill result.
                if (connectionIdRef.current !== connectionId) return;

                if (output.result.type === "Available") {
                    dispatch([
                        {
                            type: "ReceiveSteps",
                            newVersion: output.result.newVersion,
                            steps: output.result.steps,
                            stepsContentReferences: output.result.stepsContentReferences,
                        },
                    ]);
                } else {
                    const state = getState();

                    // If the user had some pending changes they'll be reset. Show the user an error
                    // message to let them know we threw away their changes.
                    if (state.pendingSendableSteps) {
                        showToast({
                            type: "Error",
                            title: "Couldn’t save changes to task",
                            error: new UnavailableError(
                                "Throwing away local task notes changes because collaboration service is missing the steps we need to backfill",
                                {
                                    displayMessage: errorDisplayMessage`The task’s notes changed while you were offline and we didn’t know how to update your changes to the task’s notes to avoid conflicting updates. Now if you type your changes again they’ll save.`,
                                },
                            ),
                        });
                    }

                    dispatch([
                        {
                            type: "Extra",
                            extra: {
                                type: "Reset",
                                state: getInitialCollaborativeContentEditorState({
                                    initialVersion: output.result.newVersion,
                                    initialContent: output.result.content,
                                    reduceReferences: reduceContentReferences,
                                    extra: {taskId},
                                }),
                            },
                        },
                    ]);
                }
            })
            .catch(error => {
                // If while waiting on our backfill we disconnected then don't update
                // our state. We use an `Id` to make sure if we connect/reconnect quickly we
                // still ignore the backfill result.
                if (connectionIdRef.current !== connectionId) return;

                dispatch([{type: "Error", error}]);
            });
    }, [backfill, dispatch, getState, isConnected, showToast, taskId]);

    const lastPendingSendableStepsVersionSentToServerRef = useRef<number | null>(null);
    useEffect(() => {
        // Don't send updates if we're not connected. We also want this effect to
        // re-run when we disconnect/reconnect.
        if (!isConnected) return;

        if (
            state.pendingSendableSteps &&
            lastPendingSendableStepsVersionSentToServerRef.current !==
                state.pendingSendableSteps.version
        ) {
            updateContent({
                version: state.pendingSendableSteps.version,
                steps: state.pendingSendableSteps.steps,
                clientId: state.pendingSendableSteps.clientId,
            }).catch(error => dispatch([{type: "Error", error}]));

            lastPendingSendableStepsVersionSentToServerRef.current =
                state.pendingSendableSteps.version;
        }
    }, [dispatch, isConnected, state.pendingSendableSteps, updateContent]);

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
                            onChange={state => dispatch([{type: "Edit", editorState: state}])}
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
