import {Selection} from "prosemirror-state";
import {ContentEditorState} from "~/client/content/content_editor_state.js";
import {AppContext} from "~/client/context/app_context.js";
import {
    DocumentContentEditorAction,
    DocumentContentEditorState,
    getInitialDocumentContentEditorState,
    reduceDocumentContentEditorState,
} from "~/client/documents/internal/document_content_editor_state.js";
import {Store} from "~/client/helpers/store/store.js";
import {ValueStore} from "~/client/helpers/store/value_store.js";
import {
    WebSocketClient,
    WebSocketClientProcedures,
    WebSocketClientState,
} from "~/client/web_socket/web_socket_client.js";
import {DocumentCollaborationProtocol} from "~/shared/documents/document_collaboration_protocol.js";
import {DocumentContentWithReferences} from "~/shared/documents/document_content_references.js";
import {DocumentCommentModel, DocumentModel} from "~/shared/documents/document_model.js";
import {Timeout, createTimeout} from "~/shared/helpers/async/timeout.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.js";
import {ImmutableMap} from "~/shared/helpers/immutable/immutable_map.js";
import {mapIterable} from "~/shared/helpers/iterable/map_iterable.js";
import {pickObject} from "~/shared/helpers/object/pick_object.js";
import {Id, generateId} from "~/shared/id/id.js";
import {DocumentCommentThreadId, DocumentId} from "~/shared/id/types/id_types.js";
import {MessagingRealtimeEvent} from "~/shared/messaging/messaging_realtime_protocol.js";
import {ProsemirrorSelectionWrapper} from "~/shared/prosemirror/prosemirror_selection_schema.js";
import {WebSocketProtocolProceduresType} from "~/shared/web_socket/web_socket_protocol.js";

export type DocumentContentEditorWebSocketClientProcedures = Pick<
    WebSocketClientProcedures<
        WebSocketProtocolProceduresType<typeof DocumentCollaborationProtocol>
    >,
    | "backfillComments"
    | "createComment"
    | "updateCommentContent"
    | "deleteComment"
    | "startTypingInCommentInput"
    | "stopTypingInCommentInput"
    | "getCommentThreadAndInitialComments"
    | "getCommentsFromStart"
    | "getCommentsFromEnd"
>;

/**
 * Object representing our connection to the document collaboration service for
 * our `<DocumentContentEditor>` component. When connected we will backfill the
 * document loaded from the server and listen to all future realtime changes.
 *
 * This class used to be implemented as a React hook called
 * `useDocumentContentEditorState()` where the state lived in a `useReducer()`.
 * Which is why we have an immutable state object with `dispatch()` function.
 * We would have kept as a React hook except we want to share this object
 * between a document route and a document comment thread peek rendered on top
 * of the document. Peeks are rendered at the space level and we can't pass
 * props up the component tree so instead we have an external store of document
 * content editor WebSocket connections accessible from anywhere.
 *
 * Useful test cases I've (@calebmer) used when working on this file:
 *
 * - Setup 2-4 browsers with a `while` loop around
 *   `ContentEditorDebugTools.simulateTyping()`. Make sure they can run forever
 *   without crashing.
 *
 *     - Open a separate browser and reload the page a couple times. It
 *       probably loads the document at an old version but should eventually
 *       see all the typing.
 *
 * - Open three browsers. In browser 1 put your cursor somewhere in the
 *   document, in browser 2 add network throttling, in browser 3 make some
 *   changes. Then reload browser 2 and while browser 2 is loading make changes
 *   with browser 3. Browser 2 should eventually see all the updates and browser
 *   1's cursor. (This exercises `rememberedSteps`.)
 */
export class DocumentContentEditorWebSocketClient {
    public readonly documentId: DocumentId;
    private readonly _client: WebSocketClient<typeof DocumentCollaborationProtocol>;
    private readonly _state: ValueStore<DocumentContentEditorState>;
    private _disconnect: (() => void) | null = null;

    // We provide access to procedures regarding document comments. Procedures that
    // update document content can only be called internally within this class.
    public readonly procedures: DocumentContentEditorWebSocketClientProcedures;

    public get state(): Store<DocumentContentEditorState> {
        return this._state;
    }

    public get webSocketState(): Store<WebSocketClientState> {
        return this._client.state;
    }

    constructor(getContext: () => AppContext, initialDocument: DocumentModel) {
        this.documentId = initialDocument.id;
        this._client = new WebSocketClient(
            getContext,
            DocumentCollaborationProtocol,
            `/api/durable-objects/documents/${initialDocument.id}`,
        );
        this._state = new ValueStore(getInitialDocumentContentEditorState(initialDocument));

        this.procedures = pickObject(this._client.procedures, [
            "backfillComments",
            "createComment",
            "updateCommentContent",
            "deleteComment",
            "startTypingInCommentInput",
            "stopTypingInCommentInput",
            "getCommentThreadAndInitialComments",
            "getCommentsFromStart",
            "getCommentsFromEnd",
        ]);
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

    public connect() {
        assert(this._disconnect === null, "WebSocket is already connected");

        let connectionId: Id | null = null;

        this._client.connect();

        const unsubscribeFromClientState = this._client.state.subscribe(() => {
            const clientState = this._client.state.getSnapshot();

            if (connectionId !== null && !clientState.isConnected) {
                connectionId = null;

                maybeSendUpdatesToServer();
            }

            // Whenever we successfully connect to the WebSocket, send a backfill request
            // so we can get any steps we missed while disconnected from the WebSocket.
            if (connectionId === null && clientState.isConnected) {
                const ourConnectionId = generateId();
                connectionId = ourConnectionId;

                this._client.procedures
                    .backfill({
                        version: this._state.getSnapshot().editorState.getVersion(),
                    })
                    .then(
                        output => {
                            // If while waiting on our backfill we disconnected then don't update
                            // our state. We use an `Id` to make sure if we connect/reconnect quickly we
                            // still ignore the backfill result.
                            if (connectionId !== ourConnectionId) return;

                            // One dispatch call just to make sure React applies these actions atomically
                            // and doesn't do any scheduling weirdness.
                            this._dispatchBatch([
                                {
                                    type: "Extra",
                                    extra: {
                                        type: "SetAllOtherPresenceStates",
                                        stateByConnectionId: ImmutableMap.from(
                                            mapIterable(output.presenceStates, presenceState => [
                                                presenceState.connectionId,
                                                presenceState.state,
                                            ]),
                                        ),
                                    },
                                },
                                {
                                    type: "ReceiveSteps",
                                    newVersion: output.newVersion,
                                    steps: output.steps,
                                    stepsContentReferences: output.stepsContentReferences,
                                },

                                // Unconditionally run this action even if we have no new remembered steps
                                // because it will throw if the editor version in state is not
                                // `expectedVersion`. This is a nice way to double check that our previous
                                // action actually caught us up.
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
                        },
                        error => {
                            // If while waiting on our backfill we disconnected then don't update
                            // our state. We use an `Id` to make sure if we connect/reconnect quickly we
                            // still ignore the backfill result.
                            if (connectionId !== ourConnectionId) return;

                            this._dispatch({type: "Error", error});
                        },
                    );

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
                    // If we don't have an editor state then our document is loading so there should
                    // be no updates from this client and we should always update the presence
                    // state.
                    if (event.clientId !== this._state.getSnapshot().editorState.getClientId()) {
                        actions.push({
                            type: "Extra",
                            extra: {
                                type: "UpdateOtherPresenceState",
                                connectionId: event.updateOtherPresenceState.connectionId,
                                state: event.updateOtherPresenceState.state,
                            },
                        });
                    }

                    this._dispatchBatch(actions);
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
                    // `subscribeToCommentThreadMessages()`. Keep our editor state up to date here
                    // by dispatching an action to update our references.
                    //
                    // We keep comment threads up-to-date with best effort. There are likely a
                    // handful of rare correctness bugs. For instance, we don't backfill comment
                    // counts! So if you miss a new comment while the page is loading you may see an
                    // old comment count. However, the UI will eventually converge to the correct
                    // comment count on the next realtime message. However the UI may not converge
                    // on the right set of comment authors since the full author list is not
                    // included in realtime events unlike the full comment count. We consider
                    // this acceptable.
                    if (event.event.type === "NewMessage") {
                        this._dispatch({
                            type: "Extra",
                            extra: {
                                type: "UpdateCommentThread",
                                commentThreadId: event.commentThreadId,
                                commentCount: event.event.message.index + 1,
                                addCommentAuthor: event.event.message.author,
                            },
                        });
                    }
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
        let lastOurPresenceStateSentToServer: {
            readonly version: number;
            readonly selection: Selection;
        } | null = null;
        let cursorDisappearTimeout: Timeout | null = null;

        // NOTE(calebmer): Originally this function (and everything around it) was
        // implemented as a `useDocumentContentEditorState()` hook. This function
        // specifically was was in a `useEffect()` so the code style makes more sense
        // in that context. This function was written assuming it could be called on
        // basically any update.
        const maybeSendUpdatesToServer = () => {
            const state = this._state.getSnapshot();

            if (connectionId === null) {
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

                this._client.procedures
                    .updateContent({
                        version: state.pendingSendableSteps.version,
                        steps: state.pendingSendableSteps.steps,
                        clientId: state.pendingSendableSteps.clientId,
                        createCommentThreads: state.extra.pendingCreateCommentThreads ?? [],
                        updateOurPresenceState: {
                            state: state.extra.ourPresenceState
                                ? {
                                      version: state.extra.ourPresenceState.version,
                                      selection: ProsemirrorSelectionWrapper.new(
                                          state.extra.ourPresenceState.selection,
                                      ),
                                  }
                                : null,
                        },
                    })
                    .catch(error => this._dispatch({type: "Error", error}));

                lastPendingSendableStepsVersionSentToServer = state.pendingSendableSteps.version;
                lastOurPresenceStateSentToServer = state.extra.ourPresenceState;
            }

            if (
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

                this._client.procedures
                    .updateOurPresenceState({
                        state: state.extra.ourPresenceState
                            ? {
                                  version: state.extra.ourPresenceState.version,
                                  selection: ProsemirrorSelectionWrapper.new(
                                      state.extra.ourPresenceState.selection,
                                  ),
                              }
                            : null,
                    })
                    .catch(error => this._dispatch({type: "Error", error}));

                lastOurPresenceStateSentToServer = state.extra.ourPresenceState;

                // Clear our presence state after some period of inactivity so you don't have a
                // bunch of cursors laying around the document.
                if (state.extra.ourPresenceState) {
                    // We have a much shorter timeout if our presence state is just a cursor. If
                    // the user has selected some text, we take longer to clear that timeout since
                    // maybe the user was intentionally trying to highlight text to show someone?
                    const cursorDisappearTimeoutMs =
                        state.extra.ourPresenceState.selection.from ===
                        state.extra.ourPresenceState.selection.to
                            ? 15 * 1000
                            : 15 * 60 * 1000;

                    cursorDisappearTimeout = createTimeout(() => {
                        this._client.procedures
                            .updateOurPresenceState({state: null})
                            .catch(error => this._dispatch({type: "Error", error}));
                    }, cursorDisappearTimeoutMs);
                }
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

    public subscribeToCommentThreadEvents(
        commentThreadId: DocumentCommentThreadId,
        subscriber: (message: MessagingRealtimeEvent<DocumentCommentModel>) => void,
    ) {
        return this._client.subscribeToEvents(event => {
            if (event.type === "Comments" && event.commentThreadId === commentThreadId) {
                subscriber(event.event);
            }
        });
    }
}
