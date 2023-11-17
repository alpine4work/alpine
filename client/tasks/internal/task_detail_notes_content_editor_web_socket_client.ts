import {
    CollaborativeContentEditorAction,
    CollaborativeContentEditorState,
    createCollaborativeContentEditorStateReducer,
    getInitialCollaborativeContentEditorState,
} from "~/client/content/collaborative_content_editor_state.js";
import {
    ContentEditorState,
    reduceContentReferences,
} from "~/client/content/content_editor_state.js";
import {AppContext} from "~/client/context/app_context.js";
import {ErrorToast} from "~/client/design/toast.js";
import {Store} from "~/client/helpers/store/store.js";
import {ValueStore} from "~/client/helpers/store/value_store.js";
import {WebSocketClient, WebSocketClientState} from "~/client/web_socket/web_socket_client.js";
import {UnavailableError} from "~/shared/error/error.js";
import {errorDisplayMessage} from "~/shared/error/error_display_message.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {cast} from "~/shared/helpers/control/cast.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.js";
import {TaskId} from "~/shared/id/types/id_types.js";
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

/**
 * Object representing our connection to the task notes collaboration service
 * for our `<TaskDetailNotesField>` component. When connected we will backfill
 * the notes loaded from the server and listen to all future realtime changes.
 *
 * This class was forked from `DocumentContentEditorWebSocketClient`. We should
 * keep the two classes roughly in sync.
 */
export class TaskDetailNotesContentEditorWebSocketClient {
    public readonly taskId: TaskId;
    private readonly _showToast: (toast: ErrorToast) => void;
    private readonly _client: WebSocketClient<typeof TaskNotesCollaborationProtocol>;
    private readonly _state: ValueStore<TaskNotesContentEditorState>;
    private _disconnect: (() => void) | null = null;

    public get state(): Store<TaskNotesContentEditorState> {
        return this._state;
    }

    public get webSocketState(): Store<WebSocketClientState> {
        return this._client.state;
    }

    constructor(
        getContext: () => AppContext,
        {
            taskId,
            initialNotesVersion,
            initialNotesContent,
            showToast,
        }: {
            taskId: TaskId;
            initialNotesVersion: number;
            initialNotesContent: TaskNotesContentWithReferences;
            showToast: (toast: ErrorToast) => void;
        },
    ) {
        this.taskId = taskId;
        this._client = new WebSocketClient(
            getContext,
            TaskNotesCollaborationProtocol,
            `/api/durable-objects/task-notes/${taskId}`,
        );
        this._state = new ValueStore(
            getInitialCollaborativeContentEditorState({
                initialVersion: initialNotesVersion,
                initialContent: initialNotesContent,
                reduceReferences: reduceContentReferences,
                extra: {taskId},
            }),
        );
        this._showToast = showToast;
    }

    private _dispatchBatch(actions: ReadonlyArray<TaskNotesContentEditorAction>) {
        this._state.set(reduceCollaborativeContentEditorState(this._state.getSnapshot(), actions));
    }

    private _dispatch(action: TaskNotesContentEditorAction) {
        this._state.set(reduceCollaborativeContentEditorState(this._state.getSnapshot(), [action]));
    }

    public changeEditorState(editorState: ContentEditorState<TaskNotesContentWithReferences>) {
        this._dispatch({type: "Edit", editorState});
    }

    public connect() {
        assert(this._disconnect === null, "WebSocket is already connected");

        let connectionState: {isBackfilling: boolean} | null = null;

        this._client.connect();

        const unsubscribeFromClientState = this._client.state.subscribe(() => {
            const clientState = this._client.state.getSnapshot();

            if (connectionState !== null && !clientState.isConnected) {
                connectionState = null;

                maybeSendUpdatesToServer();
            }

            // Whenever we successfully connect to the WebSocket, send a backfill request
            // so we can get any steps we missed while disconnected from the WebSocket.
            if (connectionState === null && clientState.isConnected) {
                const ourConnectionState = {isBackfilling: true};
                connectionState = ourConnectionState;

                this._client.procedures
                    .backfill({
                        version: this._state.getSnapshot().editorState.getVersion(),
                    })
                    .then(
                        output => {
                            // If while waiting on our backfill we disconnected then don't update
                            // our state. We use an object to make sure if we connect/reconnect quickly we
                            // still ignore the backfill result.
                            if (connectionState !== ourConnectionState) return;

                            if (output.result.type === "Available") {
                                this._dispatch({
                                    type: "ReceiveSteps",
                                    newVersion: output.result.newVersion,
                                    steps: output.result.steps,
                                    stepsContentReferences: output.result.stepsContentReferences,
                                });
                            } else {
                                const state = this._state.getSnapshot();

                                // If the user had some pending changes they'll be reset. Show the user an error
                                // message to let them know we threw away their changes.
                                if (state.pendingSendableSteps) {
                                    this._showToast({
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

                                this._dispatch({
                                    type: "Extra",
                                    extra: {
                                        type: "Reset",
                                        state: getInitialCollaborativeContentEditorState({
                                            initialVersion: output.result.newVersion,
                                            initialContent: output.result.content,
                                            reduceReferences: reduceContentReferences,
                                            extra: {taskId: this.taskId},
                                        }),
                                    },
                                });
                            }

                            ourConnectionState.isBackfilling = false;
                            maybeSendUpdatesToServer();
                        },
                        error => {
                            // If while waiting on our backfill we disconnected then don't update
                            // our state. We use an object to make sure if we connect/reconnect quickly we
                            // still ignore the backfill result.
                            if (connectionState !== ourConnectionState) return;

                            this._dispatch({type: "Error", error});
                        },
                    );

                maybeSendUpdatesToServer();
            }
        });

        const unsubscribeFromClientMessages = this._client.subscribeToEvents(event => {
            switch (event.type) {
                case "UpdateContentWithoutPersistence": {
                    this._dispatch({
                        type: "ReceiveSteps",
                        newVersion: event.newVersion,
                        steps: event.steps.map(step => ({
                            step,
                            clientId: event.clientId,
                        })),
                        stepsContentReferences: event.stepsContentReferences,
                    });
                    break;
                }
                case "PersistedContent": {
                    // TODO(calebmer, #global-loading-indicator): Show a saving indicator until
                    // content has persisted!
                    //
                    // TODO(calebmer, #unsaved-changes-confirmation): User should not be able to
                    // close the page if we haven't finished saving their notes. It will
                    // look ok on their machine but might not be on the server.
                    break;
                }
                default:
                    throw exhaustive(event);
            }
        });

        const unsubscribeFromState = this._state.subscribe(() => {
            maybeSendUpdatesToServer();
        });

        let lastPendingSendableStepsVersionSentToServer: number | null = null;

        // NOTE(calebmer): Originally this function (and everything around it) was
        // implemented as a `useDocumentContentEditorState()` hook. This function
        // specifically was was in a `useEffect()` so the code style makes more sense
        // in that context. This function was written assuming it could be called on
        // basically any update.
        const maybeSendUpdatesToServer = () => {
            const state = this._state.getSnapshot();

            // Don't send an update to the server if:
            //
            // 1. We're disconnected (`connectionState === null`)
            // 2. We're waiting on a backfill (`connectionState.isBackfilling === true`)
            //
            // We have to wait for a backfill (2) in case we were connected previously,
            // sent an update, but didn't get an acknowledgement for the update back.
            if (connectionState === null || connectionState.isBackfilling === true) {
                return;
            }

            if (
                state.pendingSendableSteps &&
                lastPendingSendableStepsVersionSentToServer !== state.pendingSendableSteps.version
            ) {
                this._client.procedures
                    .updateContent({
                        version: state.pendingSendableSteps.version,
                        steps: state.pendingSendableSteps.steps,
                        clientId: state.pendingSendableSteps.clientId,
                    })
                    .catch(error => this._dispatch({type: "Error", error}));

                lastPendingSendableStepsVersionSentToServer = state.pendingSendableSteps.version;
            }
        };

        this._disconnect = () => {
            unsubscribeFromClientState();
            unsubscribeFromClientMessages();
            unsubscribeFromState();
            this._client.disconnect();
        };
    }

    public disconnect() {
        assert(this._disconnect !== null, "WebSocket is already disconnected");
        this._disconnect();
        this._disconnect = null;
    }
}
