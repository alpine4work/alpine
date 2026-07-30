import {Selection} from "prosemirror-state";
import {ContentEditorState} from "~/client/web/content/state/content_editor_state.js";
import {AppContext} from "~/client/web/context/app_context.js";
import {
    DocumentContentEditorAction,
    DocumentContentEditorState,
    reduceDocumentContentEditorState,
} from "~/client/web/documents/internal/document_content_editor_state.js";
import {GlobalLoadingIndicator} from "~/client/web/spaces/global_loading_indicator_types.js";
import {
    WebSocketClient,
    WebSocketClientProcedures,
    WebSocketClientState,
} from "~/client/web/web_socket/web_socket_client.js";
import {AccessLevel} from "~/shared/access/access_policy.js";
import {ContentSelectionWrapper} from "~/shared/content/content_selection_schema.js";
import {DocumentCollaborationProtocol} from "~/shared/documents/document_collaboration_protocol.js";
import {DocumentContentWithReferences} from "~/shared/documents/document_content_references.js";
import {documentBackfillFutureVersionErrorMessage} from "~/shared/documents/document_error_messages.js";
import {
    DocumentCommentModel,
    DocumentCommentThreadModel,
} from "~/shared/documents/document_model.js";
import {RynamoEvent} from "~/shared/dynamo/rynamo_types.js";
import {isTransientError} from "~/shared/error/is_transient_error.js";
import {Timeout, createTimeout} from "~/shared/helpers/async/timeout.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.js";
import {ImmutableMap} from "~/shared/helpers/immutable/immutable_map.js";
import {mapIterable} from "~/shared/helpers/iterable/map_iterable.js";
import {pickObject} from "~/shared/helpers/object/pick_object.js";
import {DocumentCommentThreadId, DocumentId} from "~/shared/id/types/id_types.js";
import {MessagingRealtimeEvent} from "~/shared/messaging/messaging_realtime_protocol.js";
import {SchemaType} from "~/shared/schema/schema.js";
import {SpellCheckIgnoredLintModel} from "~/shared/spell_check/spell_check_model.js";
import {Store} from "~/shared/store/store.js";
import {ValueStore} from "~/shared/store/value_store.js";
import {WebSocketProtocolProceduresType} from "~/shared/web_socket/web_socket_protocol.js";
import {WebSocketPongMessage} from "~/shared/web_socket/web_socket_schema.js";

export type DocumentContentEditorWebSocketClientProcedures = Pick<
    WebSocketClientProcedures<
        WebSocketProtocolProceduresType<typeof DocumentCollaborationProtocol>
    >,
    (typeof DocumentContentEditorWebSocketClient.procedureNames)[number]
>;

/**
 * Object representing our connection to the document collaboration service for our
 * `<DocumentContentEditor>` component. When connected we will backfill the
 * document loaded from the server and listen to all future realtime changes.
 *
 * This class used to be implemented as a React hook called
 * `useDocumentContentEditorState()` where the state lived in a `useReducer()`.
 * Which is why we have an immutable state object with `dispatch()` function. We
 * would have kept as a React hook except we want to share this object between a
 * document route and a document comment thread peek rendered on top of the
 * document. Peeks are rendered at the space level and we can't pass props up the
 * component tree so instead we have an external store of document content editor
 * WebSocket connections accessible from anywhere.
 *
 * Useful test cases I've (@calebmer) used when working on this file:
 *
 * - Setup 2-4 browsers with a `while` loop around
 *   `ContentEditorDebugTools.simulateTyping()`. Make sure they can run forever
 *   without crashing.
 *     - Open a separate browser and reload the page a couple times. It probably
 *       loads the document at an old version but should eventually see all the
 *       typing.
 *
 * - Open three browsers. In browser 1 put your cursor somewhere in the document,
 *   in browser 2 add network throttling, in browser 3 make some changes. Then
 *   reload browser 2 and while browser 2 is loading make changes with browser 3.
 *   Browser 2 should eventually see all the updates and browser 1's cursor. (This
 *   exercises `rememberedSteps`.)
 */
export class DocumentContentEditorWebSocketClient {
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
        "getCommentThreadAndInitialCommentsIfExists",
        "getCommentsFromStart",
        "getCommentsFromEnd",
        "resolveCommentThread",
        "unresolveCommentThread",
    ] as const satisfies ReadonlyArray<
        keyof WebSocketClientProcedures<
            WebSocketProtocolProceduresType<typeof DocumentCollaborationProtocol>
        >
    >;

    public readonly documentId: DocumentId;
    public readonly accessLevel: AccessLevel;
    private readonly _getContext: () => AppContext;
    private readonly _addGlobalLoadingIndicator: (
        promise: Promise<void>,
        indicator: GlobalLoadingIndicator,
    ) => void;
    private readonly _client: WebSocketClient<typeof DocumentCollaborationProtocol>;
    private readonly _state: ValueStore<DocumentContentEditorState>;
    private _disconnect: (() => void) | null = null;

    // The number of times `updateContent()` has thrown an error. Stored at the class
    // level to survive across reconnects. Reset once `updateContent()` succeeds.
    private _updateContentRetryErrorCount = 0;

    // We provide access to procedures regarding document comments. Procedures that
    // update document content can only be called internally within this class.
    public readonly procedures: DocumentContentEditorWebSocketClientProcedures;

    public get state(): Store<DocumentContentEditorState> {
        return this._state;
    }

    public get webSocketState(): Store<WebSocketClientState> {
        return this._client.state;
    }

    constructor({
        getContext,
        addGlobalLoadingIndicator,
        documentId,
        accessLevel,
        initialState,
    }: {
        getContext: () => AppContext;
        addGlobalLoadingIndicator: (
            promise: Promise<void>,
            indicator: GlobalLoadingIndicator,
        ) => void;
        documentId: DocumentId;
        accessLevel: AccessLevel;
        initialState: DocumentContentEditorState;
    }) {
        this.documentId = documentId;
        this.accessLevel = accessLevel;
        this._getContext = getContext;
        this._addGlobalLoadingIndicator = addGlobalLoadingIndicator;
        this._client = new WebSocketClient(
            getContext,
            "DocumentCollaborationService",
            DocumentCollaborationProtocol,
            `/api/durable-objects/documents/${documentId}?access=${accessLevel}`,
        );
        this._state = new ValueStore(initialState);

        this.procedures = {
            ...pickObject(
                this._client.procedures,
                DocumentContentEditorWebSocketClient.procedureNames,
            ),
            backfillComments: async (
                input: SchemaType<
                    (typeof DocumentCollaborationProtocol)["procedureSchemas"]["backfillComments"]["inputSchema"]
                >,
            ) => {
                const output = await this._client.procedures.backfillComments(input);

                // We keep comment threads up-to-date with best effort. There are likely a handful
                // of rare correctness bugs. For instance, we don't backfill comment counts! So if
                // you miss a new comment while the page is loading you may see an old comment
                // count. However, the UI will eventually converge to the correct comment count on
                // the next realtime message or `backfillComments()` RPC call. However the UI may
                // not converge on the right set of comment authors since the full author list is
                // not included in realtime events unlike the full comment count. We consider this
                // acceptable.
                this._dispatch({
                    type: "Extra",
                    extra: {
                        type: "UpdateCommentThreadReference",
                        commentThreadId: input.commentThreadId,
                        commentCount: output.commentCount,
                        addCommentAuthor: null,
                    },
                });

                return output;
            },
        };
    }

    private _dispatchBatch(actions: ReadonlyArray<DocumentContentEditorAction>) {
        this._state.set(reduceDocumentContentEditorState(this._state.getSnapshot(), actions));
    }

    private _dispatch(action: DocumentContentEditorAction) {
        this._state.set(reduceDocumentContentEditorState(this._state.getSnapshot(), [action]));
    }

    public changeEditorState(editorState: ContentEditorState<DocumentContentWithReferences>) {
        this._dispatch({type: "Edit", editorState});
    }

    /**
     * Resolve after the collaboration service confirms that `version` has been
     * persisted.
     */
    public waitForPersistedVersion(version: number): Promise<void> {
        if (this._state.getSnapshot().persistedVersion >= version) return Promise.resolve();

        return new Promise(resolve => {
            const unsubscribe = this._state.subscribe(() => {
                if (this._state.getSnapshot().persistedVersion < version) return;

                unsubscribe();
                resolve();
            });
        });
    }

    public clearOurPresenceState() {
        this._dispatch({type: "Extra", extra: {type: "ClearOurPresenceState"}});
    }

    public unclearOurPresenceState() {
        this._dispatch({type: "Extra", extra: {type: "UnclearOurPresenceState"}});
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
                        .backfill({
                            version: this._state.getSnapshot().editorState.getVersion(),
                        })
                        .then(
                            output => {
                                // If while waiting on our backfill we disconnected then don't update our state. We
                                // use an object to make sure if we connect/reconnect quickly we still ignore the
                                // backfill result.
                                if (connectionState !== ourConnectionState) return;

                                // One dispatch call just to make sure React applies these actions atomically and
                                // doesn't do any scheduling weirdness.
                                this._dispatchBatch([
                                    {
                                        type: "Extra",
                                        extra: {
                                            type: "SetAllOtherPresenceStates",
                                            stateByConnectionId: ImmutableMap.from(
                                                mapIterable(
                                                    output.presenceStates,
                                                    presenceState => [
                                                        presenceState.connectionId,
                                                        presenceState.state,
                                                    ],
                                                ),
                                            ),
                                        },
                                    },
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

                                    // Unconditionally run this action even if we have no new remembered steps because
                                    // it will throw if the editor version in state is not `expectedVersion`. This is a
                                    // nice way to double check that our previous action actually caught us up.
                                    {
                                        type: "Extra",
                                        extra: {
                                            type: "AugmentRememberedSteps",
                                            expectedVersion: output.newVersion,
                                            startVersion:
                                                output.newVersion -
                                                output.steps.length -
                                                output.rememberInvertedSteps.length,
                                            invertedSteps: output.rememberInvertedSteps,
                                        },
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
                                    // service confirmed but couldn't persist. Let's try reverting those steps and
                                    // retrying our backfill.
                                    //
                                    // To test this branch try throwing an error from `updateDocumentContent()` in
                                    // `documents_table.ts` for some step (maybe any step that adds a "t"). The
                                    // collaboration service should accept this step but fail to persist it in the
                                    // database. An error should show up in your client, then you should hit "Retry".
                                    // At which point we'll try backfilling, hit this error, then reset the client to a
                                    // good state.
                                    let state = this._state.getSnapshot();
                                    if (
                                        error instanceof Error &&
                                        error.message.includes(
                                            documentBackfillFutureVersionErrorMessage,
                                        ) &&
                                        state.persistedVersion < state.editorState.getVersion()
                                    ) {
                                        // Dispatching `ResetToPersistedVersion` also resets `pendingSendableSteps` and
                                        // `ourPresenceState`. Reset these variables so the next update can work properly.
                                        updateGeneration += 1;
                                        lastPendingSendableStepsVersionSentToServer = null;
                                        lastOurPresenceStateSentToServer = null;

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
                case "UpdateContentWithoutPersistence": {
                    const actions: Array<DocumentContentEditorAction> = [];

                    actions.push({
                        type: "ReceiveSteps",
                        newVersion: event.newVersion,
                        steps: event.steps.map(step => ({
                            step,
                            clientId: event.clientId,
                        })),
                        stepsContentReferences: event.stepsContentReferences,
                    });

                    // If this was an acknowledgement message from our own client, don't add the
                    // presence state to our map.
                    //
                    // If we don't have an editor state then our document is loading so there should be
                    // no updates from this client and we should always update the presence state.
                    if (
                        event.clientId !== this._state.getSnapshot().editorState.getClientId() &&
                        event.updateOtherPresenceState
                    ) {
                        actions.push({
                            type: "Extra",
                            extra: {
                                type: "UpdateOtherPresenceState",
                                connectionId: event.updateOtherPresenceState.connectionId,
                                state: event.updateOtherPresenceState.state,
                            },
                        });
                    }

                    if (
                        event.resolveCommentThreadIds.length > 0 ||
                        event.unresolveCommentThreadIds.length > 0
                    ) {
                        actions.push({
                            type: "Extra",
                            extra: {
                                type: "UpdateCommentThreadResolutionStates",
                                newVersion: event.newVersion,
                                resolveCommentThreadIds: event.resolveCommentThreadIds,
                                unresolveCommentThreadIds: event.unresolveCommentThreadIds,
                            },
                        });
                    }

                    this._dispatchBatch(actions);
                    break;
                }
                case "PersistedContent": {
                    this._dispatch({type: "Persisted", newVersion: event.newVersion});
                    break;
                }
                case "UpdateOtherPresenceState": {
                    this._dispatch({
                        type: "Extra",
                        extra: {
                            type: "UpdateOtherPresenceState",
                            connectionId: event.connectionId,
                            state: event.state,
                        },
                    });
                    break;
                }
                case "Error": {
                    this._dispatch({type: "Error", error: event.error});
                    break;
                }
                case "Comments": {
                    // Comment realtime events are handled by callers to
                    // `subscribeToCommentThreadMessages()`. Keep our editor state up to date here by
                    // dispatching an action to update our references.
                    //
                    // We keep comment threads up-to-date with best effort. There are likely a handful
                    // of rare correctness bugs. For instance, we don't backfill comment counts! So if
                    // you miss a new comment while the page is loading you may see an old comment
                    // count. However, the UI will eventually converge to the correct comment count on
                    // the next realtime message or `backfillComments()` RPC call. However the UI may
                    // not converge on the right set of comment authors since the full author list is
                    // not included in realtime events unlike the full comment count. We consider this
                    // acceptable.
                    if (event.event.type === "NewMessage") {
                        this._dispatch({
                            type: "Extra",
                            extra: {
                                type: "UpdateCommentThreadReference",
                                commentThreadId: event.commentThreadId,
                                commentCount: event.event.message.index + 1,
                                addCommentAuthor: event.event.message.author,
                            },
                        });
                    }
                    break;
                }
                case "SpellCheckRealtimeEvents": {
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
        let lastOurPresenceStateSentToServer:
            | {readonly version: number; readonly selection: Selection}
            | "SilentError"
            | null = null;
        let cursorDisappearTimeout: Timeout | null = null;

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
                cursorDisappearTimeout?.clear();
                cursorDisappearTimeout = null;
                return;
            }

            if (
                state.pendingSendableSteps &&
                lastPendingSendableStepsVersionSentToServer !== state.pendingSendableSteps.version
            ) {
                cursorDisappearTimeout?.clear();
                cursorDisappearTimeout = null;

                updateGeneration += 1;
                const generation = updateGeneration;

                lastPendingSendableStepsVersionSentToServer = state.pendingSendableSteps.version;
                lastOurPresenceStateSentToServer = state.extra.ourPresenceState;

                const savingPromise = this._client.procedures
                    .updateContent({
                        version: state.pendingSendableSteps.version,
                        steps: state.pendingSendableSteps.steps,
                        clientId: state.pendingSendableSteps.clientId,
                        createCommentThreads: state.extra.pendingCreateCommentThreads ?? [],
                        intentionallyUpdateAccessPolicy:
                            state.extra.pendingIntentionallyUpdateAccessPolicy,
                        intentionallyUpdateDeletedTime:
                            state.extra.pendingIntentionallyUpdateDeletedTime,
                        updateOurPresenceState: {
                            state: state.extra.ourPresenceState
                                ? {
                                      version: state.extra.ourPresenceState.version,
                                      selection: ContentSelectionWrapper.new(
                                          state.extra.ourPresenceState.selection,
                                      ),
                                  }
                                : null,
                        },
                    })
                    .then(
                        () => {
                            this._updateContentRetryErrorCount = 0;
                        },
                        error => {
                            // If we're connected when an error occurs then this isn't a network related issue.
                            // Present the error to the user. If we're disconnected when an error occurs
                            // silently log and we want to retry when the WebSocket reconnects.
                            if (this._client.state.getSnapshot().isConnected) {
                                // If this is a transient error, don't try resetting the user's pending steps until
                                // we've retried 2 times. This means the user will manually need to hit the "Retry"
                                // button twice before we reset their state.
                                //
                                // We'd like to avoid resetting the user's pending steps if possible since that's
                                // data loss.
                                if (
                                    isTransientError(error) &&
                                    this._updateContentRetryErrorCount < 2
                                ) {
                                    this._updateContentRetryErrorCount++;
                                    this._dispatch({type: "Error", error});
                                } else {
                                    this._updateContentRetryErrorCount = 0;

                                    // Dispatching `ResetToPersistedVersion` also resets `pendingSendableSteps` and
                                    // `ourPresenceState`. Reset these variables so the next update can work properly.
                                    updateGeneration += 1;
                                    lastPendingSendableStepsVersionSentToServer = null;
                                    lastOurPresenceStateSentToServer = null;

                                    this._dispatchBatch([
                                        {type: "Extra", extra: {type: "ResetToPersistedVersion"}},
                                        {type: "Error", error},
                                    ]);
                                }
                                return;
                            }

                            this._getContext()
                                .tracer.getRoot()
                                .logException(
                                    "Couldn\u2019t update content after disconnect",
                                    error,
                                );

                            // Next time we send updates, we'll silently retry updating content if another
                            // `updateContent()` call hasn't happened in the meantime.
                            //
                            // For example, maybe the WebSocket abruptly disconnected while executing this
                            // procedure. When the WebSocket reconnects we'll try again.
                            if (generation === updateGeneration) {
                                lastPendingSendableStepsVersionSentToServer = "SilentError";
                                lastOurPresenceStateSentToServer = "SilentError";
                            }
                        },
                    );

                this._addGlobalLoadingIndicator(savingPromise, {type: "Saving"});
            }

            if (
                lastOurPresenceStateSentToServer === "SilentError" ||
                (lastOurPresenceStateSentToServer === null) !==
                    (state.extra.ourPresenceState === null) ||
                (lastOurPresenceStateSentToServer !== null &&
                    state.extra.ourPresenceState !== null &&
                    (lastOurPresenceStateSentToServer.version !==
                        state.extra.ourPresenceState.version ||
                        lastOurPresenceStateSentToServer.selection !==
                            state.extra.ourPresenceState.selection))
            ) {
                cursorDisappearTimeout?.clear();
                cursorDisappearTimeout = null;

                updateGeneration += 1;
                const generation = updateGeneration;

                lastOurPresenceStateSentToServer = state.extra.ourPresenceState;

                this._client.procedures
                    .updateOurPresenceState({
                        state: state.extra.ourPresenceState
                            ? {
                                  version: state.extra.ourPresenceState.version,
                                  selection: ContentSelectionWrapper.new(
                                      state.extra.ourPresenceState.selection,
                                  ),
                              }
                            : null,
                    })
                    .catch(error => {
                        this._getContext()
                            .tracer.getRoot()
                            .logException("Couldn\u2019t update our presence state", error);

                        // Next time we send updates, we'll silently retry sending our presence state if
                        // another `updateOurPresenceState()` call hasn't happened in the meantime.
                        //
                        // For example, maybe the WebSocket abruptly disconnected while executing this
                        // procedure. When the WebSocket reconnects we'll try again.
                        if (generation === updateGeneration) {
                            lastOurPresenceStateSentToServer = "SilentError";
                        }
                    });

                // Clear our presence state after some period of inactivity so you don't have a
                // bunch of cursors laying around the document.
                if (state.extra.ourPresenceState) {
                    // We have a much shorter timeout if our presence state is just a cursor. If the
                    // user has selected some text, we take longer to clear that timeout since maybe
                    // the user was intentionally trying to highlight text to show someone?
                    const cursorDisappearTimeoutMs =
                        state.extra.ourPresenceState.selection.from ===
                        state.extra.ourPresenceState.selection.to
                            ? 15 * 1000
                            : 15 * 60 * 1000;

                    cursorDisappearTimeout = createTimeout(() => {
                        updateGeneration += 1;
                        const generation = updateGeneration;

                        lastOurPresenceStateSentToServer = null;

                        this._client.procedures
                            .updateOurPresenceState({state: null})
                            .catch(error => {
                                this._getContext()
                                    .tracer.getRoot()
                                    .logException("Couldn\u2019t update our presence state", error);

                                // Next time we send updates, we'll silently retry sending our presence state if
                                // another `updateOurPresenceState()` call hasn't happened in the meantime.
                                //
                                // For example, maybe the WebSocket abruptly disconnected while executing this
                                // procedure. When the WebSocket reconnects we'll try again.
                                if (generation === updateGeneration) {
                                    lastOurPresenceStateSentToServer = "SilentError";
                                }
                            });
                    }, cursorDisappearTimeoutMs);
                }
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

    public subscribeToCommentThreadEvents(
        commentThreadId: DocumentCommentThreadId,
        subscriber: (
            message:
                | MessagingRealtimeEvent<DocumentCommentModel>
                | {type: "PersistedContent"; updatedCommentThread: DocumentCommentThreadModel},
        ) => void,
    ) {
        return this._client.subscribeToEvents(event => {
            if (event.type === "Comments" && event.commentThreadId === commentThreadId) {
                subscriber(event.event);
            }

            if (event.type === "PersistedContent") {
                const commentThread = event.updatedCommentThreads.find(
                    commentThread => commentThread.id === commentThreadId,
                );
                if (commentThread) {
                    subscriber({type: "PersistedContent", updatedCommentThread: commentThread});
                }
            }
        });
    }

    public subscribeToSpellCheckIgnoredLints(
        subscriber: (events: ReadonlyArray<RynamoEvent<SpellCheckIgnoredLintModel>>) => void,
    ) {
        return this._client.subscribeToEvents(event => {
            if (event.type === "SpellCheckRealtimeEvents") {
                subscriber(event.events);
            }
        });
    }

    public subscribeToPongs(subscriber: (message: WebSocketPongMessage) => void) {
        return this._client.subscribeToPongs(subscriber);
    }
}
