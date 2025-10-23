import {
    CollaborativeContentEditorAction,
    CollaborativeContentEditorState,
    createCollaborativeContentEditorStateReducer,
    getInitialCollaborativeContentEditorState,
} from "~/client/content/collaborative_content_editor_state.js";
import {
    ContentEditorState,
    reduceContentReferences,
} from "~/client/content/state/content_editor_state.js";
import {AppContext} from "~/client/context/app_context.js";
import {MemoObject} from "~/client/helpers/types/memo_object.js";
import {GlobalLoadingIndicator} from "~/client/spaces/global_loading_indicator_types.js";
import {
    WebSocketClient,
    WebSocketClientProcedures,
    WebSocketClientState,
} from "~/client/web_socket/web_socket_client.js";
import {UnavailableError} from "~/shared/error/error.js";
import {errorDisplayMessage} from "~/shared/error/error_display_message.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {cast} from "~/shared/helpers/control/cast.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.js";
import {pickObject} from "~/shared/helpers/object/pick_object.js";
import {TaskId} from "~/shared/id/types/id_types.js";
import {MessagingRealtimeEvent} from "~/shared/messaging/messaging_realtime_protocol.js";
import {Store} from "~/shared/store/store.js";
import {ValueStore} from "~/shared/store/value_store.js";
import {TaskCommentModel} from "~/shared/tasks/model/task_comment_model.js";
import {TaskNotesCollaborationProtocol} from "~/shared/tasks/task_notes_collaboration_protocol.js";
import {TaskNotesContentWithReferences} from "~/shared/tasks/task_notes_content_schema.js";
import {WebSocketProtocolProceduresType} from "~/shared/web_socket/web_socket_protocol.js";
import {WebSocketPongMessage} from "~/shared/web_socket/web_socket_schema.js";

export type TaskNotesContentEditorState = CollaborativeContentEditorState<
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

export type TaskDetailNotesContentEditorWebSocketClientProcedures = Pick<
    WebSocketClientProcedures<
        WebSocketProtocolProceduresType<typeof TaskNotesCollaborationProtocol>
    >,
    (typeof TaskDetailNotesContentEditorWebSocketClient.procedureNames)[number]
>;

export const reduceTaskNotesContentEditorState = createCollaborativeContentEditorStateReducer<
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

export function getInitialTaskNotesContentEditorState({
    taskId,
    initialNotesVersion,
    initialNotesContent,
}: {
    taskId: TaskId;
    initialNotesVersion: number;
    initialNotesContent: TaskNotesContentWithReferences;
}): TaskNotesContentEditorState {
    return getInitialCollaborativeContentEditorState({
        initialVersion: initialNotesVersion,
        initialContent: initialNotesContent,
        reduceReferences: reduceContentReferences,
        extra: {taskId},
    });
}

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
    public static readonly procedureNames = [
        "backfillComments",
        "createComment",
        "updateCommentContent",
        "deleteComment",
        "startTypingInCommentInput",
        "stopTypingInCommentInput",
    ] as const satisfies ReadonlyArray<
        keyof WebSocketClientProcedures<
            WebSocketProtocolProceduresType<typeof TaskNotesCollaborationProtocol>
        >
    >;
    private readonly _displayError: (title: string, error: unknown) => void;
    private readonly _getContext: () => AppContext;
    private readonly _addGlobalLoadingIndicator: (
        promise: Promise<unknown>,
        indicator: GlobalLoadingIndicator,
    ) => void;
    private readonly _client: WebSocketClient<typeof TaskNotesCollaborationProtocol>;
    private readonly _state: ValueStore<TaskNotesContentEditorState>;
    private _disconnect: (() => void) | null = null;

    public readonly procedures: MemoObject<TaskDetailNotesContentEditorWebSocketClientProcedures>;

    public get state(): Store<TaskNotesContentEditorState> {
        return this._state;
    }

    public get webSocketState(): Store<WebSocketClientState> {
        return this._client.state;
    }

    constructor({
        getContext,
        addGlobalLoadingIndicator,
        taskId,
        displayError,
        initialState,
    }: {
        getContext: () => AppContext;
        addGlobalLoadingIndicator: (
            promise: Promise<unknown>,
            indicator: GlobalLoadingIndicator,
        ) => void;
        taskId: TaskId;
        displayError: (title: string, error: unknown) => void;
        initialState: TaskNotesContentEditorState;
    }) {
        this.taskId = taskId;
        this._getContext = getContext;
        this._addGlobalLoadingIndicator = addGlobalLoadingIndicator;
        this._client = new WebSocketClient(
            getContext,
            "TaskNotesCollaborationService",
            TaskNotesCollaborationProtocol,
            `/api/durable-objects/task-notes/${taskId}`,
        );
        assert(initialState.extra.taskId === taskId);
        this._state = new ValueStore(initialState);
        this._displayError = displayError;

        this.procedures = pickObject(
            this._client.procedures,
            TaskDetailNotesContentEditorWebSocketClient.procedureNames,
        ) as MemoObject<TaskDetailNotesContentEditorWebSocketClientProcedures>;
    }

    private _dispatchBatch(actions: ReadonlyArray<TaskNotesContentEditorAction>) {
        this._state.set(reduceTaskNotesContentEditorState(this._state.getSnapshot(), actions));
    }

    private _dispatch(action: TaskNotesContentEditorAction) {
        this._state.set(reduceTaskNotesContentEditorState(this._state.getSnapshot(), [action]));
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
                    .backfillNotes({
                        version: this._state.getSnapshot().editorState.getVersion(),
                    })
                    .then(
                        output => {
                            // If while waiting on our backfill we disconnected then don't update
                            // our state. We use an object to make sure if we connect/reconnect quickly we
                            // still ignore the backfill result.
                            if (connectionState !== ourConnectionState) return;

                            if (output.result.type === "Available") {
                                this._dispatchBatch([
                                    {
                                        type: "ReceiveSteps",
                                        newVersion: output.result.newVersion,
                                        steps: output.result.steps,
                                        stepsContentReferences:
                                            output.result.stepsContentReferences,
                                    },
                                    {
                                        type: "Persisted",
                                        newVersion: output.result.persistedVersion,
                                    },
                                ]);
                            } else {
                                const state = this._state.getSnapshot();

                                // If the user had some pending changes they'll be reset. Show the user an error
                                // message to let them know we threw away their changes.
                                if (state.pendingSendableSteps) {
                                    this._displayError(
                                        "Couldn’t save changes to task",
                                        new UnavailableError(
                                            "Throwing away local task notes changes because collaboration service is missing the steps we need to backfill",
                                            {
                                                displayMessage: errorDisplayMessage`The task’s notes changed while you were offline and we didn’t know how to update your changes to the task’s notes to avoid conflicting updates. Now if you type your changes again they’ll save.`,
                                            },
                                        ),
                                    );
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
                case "UpdateNotesContentWithoutPersistence": {
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
                // NOTE(maximchen): We do not care about task comments when processing task notes
                case "Comments": {
                    break;
                }
                case "PersistedContent": {
                    this._dispatch({type: "Persisted", newVersion: event.newVersion});
                    break;
                }
                default:
                    throw exhaustive(event);
            }
        });

        const unsubscribeFromState = this._state.subscribe(() => {
            maybeSendUpdatesToServer();
        });

        let updateGeneration = 0;
        let lastPendingSendableStepsVersionSentToServer: number | "SilentError" | null = null;

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
                updateGeneration += 1;
                const generation = updateGeneration;

                lastPendingSendableStepsVersionSentToServer = state.pendingSendableSteps.version;

                const savingPromise = this._client.procedures
                    .updateNotesContent({
                        version: state.pendingSendableSteps.version,
                        steps: state.pendingSendableSteps.steps,
                        clientId: state.pendingSendableSteps.clientId,
                    })
                    .catch(error => {
                        // If we're connected when an error occurs then this isn't a network related
                        // issue. Present the error to the user. If we're disconnected when an error
                        // occurs silently log and we want to retry when the WebSocket reconnects.
                        if (this._client.state.getSnapshot().isConnected) {
                            this._dispatch({type: "Error", error});
                            return;
                        }

                        this._getContext()
                            .tracer.getRoot()
                            .logException("Couldn’t update content after disconnect", error);

                        // Next time we send updates, we'll silently retry updating content if another
                        // `updateContent()` call hasn't happened in the meantime.
                        //
                        // For example, maybe the WebSocket abruptly disconnected while executing this
                        // procedure. When the WebSocket reconnects we'll try again.
                        if (generation === updateGeneration) {
                            lastPendingSendableStepsVersionSentToServer = "SilentError";
                        }
                    });

                this._addGlobalLoadingIndicator(savingPromise, {type: "Saving"});
            }
        };

        this._disconnect = () => {
            unsubscribeFromClientState();
            unsubscribeFromClientMessages();
            unsubscribeFromState();

            void this._client.disconnect();
        };
    }

    public disconnect() {
        assert(this._disconnect !== null, "WebSocket is already disconnected");
        this._disconnect();
        this._disconnect = null;
    }

    public reconnect() {
        // If we're not disconnected then disconnect...
        if (this._disconnect !== null) {
            this.disconnect();
        }

        this.connect();
    }

    public subscribeToCommentEvents(
        subscriber: (message: MessagingRealtimeEvent<TaskCommentModel>) => void,
    ) {
        return this._client.subscribeToEvents(event => {
            if (event.type === "Comments") {
                subscriber(event.event);
            }
        });
    }

    public subscribeToPongs(subscriber: (message: WebSocketPongMessage) => void) {
        return this._client.subscribeToPongs(subscriber);
    }
}
