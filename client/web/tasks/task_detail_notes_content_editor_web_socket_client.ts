import {ContentEditorState} from "~/client/web/content/state/content_editor_state.js";
import {AppContext} from "~/client/web/context/app_context.js";
import {MemoObject} from "~/client/web/helpers/types/memo_object.js";
import {GlobalLoadingIndicator} from "~/client/web/spaces/global_loading_indicator_types.js";
import {
    TaskNotesContentEditorAction,
    TaskNotesContentEditorState,
    reduceTaskNotesContentEditorState,
} from "~/client/web/tasks/task_detail_notes_content_editor_state.js";
import {
    WebSocketClient,
    WebSocketClientProcedures,
    WebSocketClientState,
} from "~/client/web/web_socket/web_socket_client.js";
import {AccessLevel} from "~/shared/access/access_policy.js";
import {UnavailableError} from "~/shared/error/error.js";
import {errorDisplayMessage} from "~/shared/error/error_display_message.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.js";
import {pickObject} from "~/shared/helpers/object/pick_object.js";
import {TaskId} from "~/shared/id/types/id_types.js";
import {MessagingRealtimeEvent} from "~/shared/messaging/messaging_realtime_protocol.js";
import {Store} from "~/shared/store/store.js";
import {ValueStore} from "~/shared/store/value_store.js";
import {TaskCommentModel} from "~/shared/tasks/model/task_comment_model.js";
import {taskNotesBackfillFutureVersionErrorMessage} from "~/shared/tasks/task_error_messages.js";
import {TaskNotesCollaborationProtocol} from "~/shared/tasks/task_notes_collaboration_protocol.js";
import {TaskNotesContentWithReferences} from "~/shared/tasks/task_notes_content_schema.js";
import {WebSocketProtocolProceduresType} from "~/shared/web_socket/web_socket_protocol.js";
import {WebSocketPongMessage} from "~/shared/web_socket/web_socket_schema.js";

export type TaskDetailNotesContentEditorWebSocketClientProcedures = Pick<
    WebSocketClientProcedures<
        WebSocketProtocolProceduresType<typeof TaskNotesCollaborationProtocol>
    >,
    (typeof TaskDetailNotesContentEditorWebSocketClient.procedureNames)[number]
>;

/**
 * Object representing our connection to the task notes collaboration service for
 * our `<TaskDetailNotesField>` component. When connected we will backfill the
 * notes loaded from the server and listen to all future realtime changes.
 *
 * This class was forked from `DocumentContentEditorWebSocketClient`. We should
 * keep the two classes roughly in sync.
 */
export class TaskDetailNotesContentEditorWebSocketClient {
    public readonly taskId: TaskId;
    public readonly accessLevel: AccessLevel;

    public static readonly procedureNames = [
        "backfillComments",
        "createComment",
        "updateCommentContent",
        "deleteComment",
        "setCommentReaction",
        "deleteCommentReaction",
        "putCommentApprovalDecisions",
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
        accessLevel,
        displayError,
        initialState,
    }: {
        getContext: () => AppContext;
        addGlobalLoadingIndicator: (
            promise: Promise<unknown>,
            indicator: GlobalLoadingIndicator,
        ) => void;
        taskId: TaskId;
        accessLevel: AccessLevel;
        displayError: (title: string, error: unknown) => void;
        initialState: TaskNotesContentEditorState;
    }) {
        this.taskId = taskId;
        this.accessLevel = accessLevel;
        this._getContext = getContext;
        this._addGlobalLoadingIndicator = addGlobalLoadingIndicator;
        this._client = new WebSocketClient(
            getContext,
            "TaskNotesCollaborationService",
            TaskNotesCollaborationProtocol,
            `/api/durable-objects/task-notes/${taskId}?access=${accessLevel}`,
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

            // Whenever we successfully connect to the WebSocket, send a backfill request so we
            // can get any steps we missed while disconnected from the WebSocket.
            if (connectionState === null && clientState.isConnected) {
                const ourConnectionState = {isBackfilling: true};
                connectionState = ourConnectionState;

                const attemptBackfill = () => {
                    this._client.procedures
                        .backfillNotes({
                            version: this._state.getSnapshot().editorState.getVersion(),
                        })
                        .then(
                            output => {
                                // If while waiting on our backfill we disconnected then don't update our state. We
                                // use an object to make sure if we connect/reconnect quickly we still ignore the
                                // backfill result.
                                if (connectionState !== ourConnectionState) return;

                                this._dispatchBatch([
                                    {
                                        type: "ReceiveSteps",
                                        newVersion: output.newVersion,
                                        steps: output.steps,
                                        stepsContentReferences: output.stepsContentReferences,
                                    },
                                    {
                                        type: "Persisted",
                                        newVersion: output.persistedVersion,
                                    },
                                ]);

                                ourConnectionState.isBackfilling = false;
                                maybeSendUpdatesToServer();
                            },
                            error => {
                                // If while waiting on our backfill we disconnected then don't update our state. We
                                // use an object to make sure if we connect/reconnect quickly we still ignore the
                                // backfill result.
                                if (connectionState !== ourConnectionState) return;

                                try {
                                    // If the collaboration service is telling us that we're trying to backfill at a
                                    // future version then that may be because we have steps a previous collaboration
                                    // service confirmed but couldn't persist. Revert those steps back to our persisted
                                    // version and retry our backfill.
                                    let state = this._state.getSnapshot();
                                    if (
                                        error instanceof Error &&
                                        error.message.includes(
                                            taskNotesBackfillFutureVersionErrorMessage,
                                        ) &&
                                        state.persistedVersion < state.editorState.getVersion()
                                    ) {
                                        // If the user had some pending changes they'll be reset. Show the user an error
                                        // message to let them know we threw away their changes.
                                        if (state.pendingSendableSteps) {
                                            this._displayError(
                                                "Couldn\u2019t save changes to task",
                                                new UnavailableError(
                                                    "Throwing away local task notes changes because the collaboration service couldn\u2019t persist the steps we confirmed",
                                                    {
                                                        displayMessage: errorDisplayMessage`The task\u2019s notes changed while you were offline and we didn\u2019t know how to update your changes to the task\u2019s notes to avoid conflicting updates. Now if you type your changes again they\u2019ll save.`,
                                                    },
                                                ),
                                            );
                                        }

                                        // Dispatching `ResetToPersistedVersion` also resets `pendingSendableSteps`. Reset
                                        // our bookkeeping so the next update can work properly.
                                        updateGeneration += 1;
                                        lastPendingSendableStepsVersionSentToServer = null;

                                        this._dispatch({
                                            type: "Extra",
                                            extra: {type: "ResetToPersistedVersion"},
                                        });

                                        // Check that the state's version moved back to `state.persistedVersion`. This
                                        // makes sure we won't get stuck in an infinite retry loop.
                                        state = this._state.getSnapshot();
                                        assert(
                                            state.persistedVersion ===
                                                state.editorState.getVersion(),
                                        );

                                        attemptBackfill();
                                        return;
                                    }
                                } catch (newError) {
                                    // Handle an error thrown by our error handling logic.
                                    this._dispatch({type: "Error", error: newError});
                                    return;
                                }

                                this._dispatch({type: "Error", error});
                            },
                        );
                };

                attemptBackfill();

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
        // specifically was was in a `useEffect()` so the code style makes more sense in
        // that context. This function was written assuming it could be called on basically
        // any update.
        const maybeSendUpdatesToServer = () => {
            const state = this._state.getSnapshot();

            // Don't send an update to the server if:
            //
            // 1. We're disconnected (`connectionState === null`)
            // 2. We're waiting on a backfill (`connectionState.isBackfilling === true`)
            //
            // We have to wait for a backfill (2) in case we were connected previously, sent an
            // update, but didn't get an acknowledgement for the update back.
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
                        // If we're connected when an error occurs then this isn't a network related issue.
                        // Present the error to the user. If we're disconnected when an error occurs
                        // silently log and we want to retry when the WebSocket reconnects.
                        if (this._client.state.getSnapshot().isConnected) {
                            this._dispatch({type: "Error", error});
                            return;
                        }

                        this._getContext()
                            .tracer.getRoot()
                            .logException("Couldn\u2019t update content after disconnect", error);

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
