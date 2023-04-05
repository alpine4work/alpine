import {Selection} from "prosemirror-state";
import {Step, StepMap} from "prosemirror-transform";
import {WebSocketClient} from "~/client/cloudflare/web_socket_client";
import {
    ContentEditorReferencesAction,
    ContentEditorState,
} from "~/client/content/content_editor_state";
import {AppContext} from "~/client/context/app_context";
import {Store} from "~/client/helpers/store/store";
import {ValueStore} from "~/client/helpers/store/value_store";
import {DocumentContent, isDocumentContent} from "~/shared/content/document_content_schema";
import {MessageContent} from "~/shared/content/message_content_schema";
import {
    DocumentCollaborationMessageFromClient,
    DocumentCollaborationMessageFromClientSchema,
    DocumentCollaborationMessageFromServer,
    DocumentCollaborationMessageFromServerSchema,
    DocumentCollaborationPresenceState,
} from "~/shared/documents/document_collaboration_schema";
import {UnimplementedError} from "~/shared/error/error";
import {Timeout, createTimeout} from "~/shared/helpers/async/timeout";
import {assert} from "~/shared/helpers/control/assert";
import {exhaustive} from "~/shared/helpers/control/exhaustive";
import {Lazy} from "~/shared/helpers/control/lazy";
import {ImmutableMap} from "~/shared/helpers/immutable/immutable_map";
import {filterMapIterable} from "~/shared/helpers/iterable/filter_map_iterable";
import {mapIterable} from "~/shared/helpers/iterable/map_iterable";
import {
    ContentEditorClientId,
    DocumentCommentThreadId,
    DocumentId,
    WebSocketConnectionId,
} from "~/shared/id/types/id_types";
import {MessagingRealtimeMessageFromClient} from "~/shared/messaging/messaging_realtime_schema";
import {
    DocumentContentReferences,
    DocumentContentWithReferences,
    DocumentModel,
    mergeDocumentContentReferences,
} from "~/shared/models/document_model";
import {ProsemirrorSelectionWrapper} from "~/shared/prosemirror/prosemirror_selection_schema";

export const createDocumentCommentThreadMetaKey = "createCommentThread";

export type DocumentContentEditorState = {
    /**
     * We may get `ReceiveSteps` actions out of order (e.g. the server sends an
     * `UpdateContent` message before a `BackfillResponse` message). If we see an
     * action for a future version we put it in this array and re-apply the action
     * when older steps are applied.
     */
    readonly pendingActions: Array<DocumentContentEditorReceiveStepsAction>;

    /**
     * The current state of the editor.
     */
    readonly editorState: ContentEditorState<DocumentContentWithReferences>;

    /**
     * Remember some number of steps in our state to map phantom selections from
     * presence when they have an old version.
     */
    readonly rememberedSteps: ReadonlyArray<{
        readonly stepMap: StepMap;
        readonly contentBeforeStep: Lazy<DocumentContent>;
        readonly contentAfterStep: Lazy<DocumentContent>;
    }>;

    /**
     * Steps we have sent to the server which we are waiting on
     * acknowledgement for.
     */
    readonly pendingSendableSteps: {
        readonly steps: ReadonlyArray<Step>;
        readonly version: number;
        readonly clientId: ContentEditorClientId;
        readonly createCommentThreads: ReadonlyArray<{
            readonly commentThreadId: DocumentCommentThreadId;
            readonly initialCommentContent: MessageContent;
        }>;
    } | null;

    /**
     * The current text selection to broadcast over presence and the version at
     * which the selection was recorded.
     *
     * We only broadcast a selection update when the user makes a change to keep
     * the number of updates low. Other clients will rebase the selection forward
     * to display it on their editor.
     */
    readonly ourPresenceState: {
        readonly version: number;
        readonly selection: Selection;
    } | null;

    /**
     * The presence state of other selected clients.
     *
     * An `ImmutableMap` since we update pretty frequently so we want fast
     * immutable map update performance.
     */
    readonly otherPresenceStateByConnectionId: ImmutableMap<
        WebSocketConnectionId,
        DocumentCollaborationPresenceState
    >;

    /**
     * Is there an error from our WebSocket?
     */
    readonly errorState:
        | {readonly hasError: false}
        | {readonly hasError: true; readonly error: unknown};
};

export function reduceDocumentContentReferences(
    references: DocumentContentReferences,
    action: ContentEditorReferencesAction<DocumentContentReferences>,
): DocumentContentReferences {
    switch (action.type) {
        case "Merge":
            return mergeDocumentContentReferences(references, action.references);
        case "AddAccount": {
            return {
                ...references,
                accountById: new Map([
                    ...references.accountById,
                    [action.account.id, action.account],
                ]),
            };
        }
        default:
            throw exhaustive(action);
    }
}

export function getInitialDocumentContentEditorState(
    initialDocument: DocumentModel,
): DocumentContentEditorState {
    const editorState = ContentEditorState.createCollaborative<DocumentContentWithReferences>({
        version: initialDocument.version,
        content: initialDocument.content,
        reduceReferences: reduceDocumentContentReferences,
    });

    return {
        pendingActions: [],
        editorState,
        rememberedSteps: [],
        pendingSendableSteps: null,
        ourPresenceState: null,
        otherPresenceStateByConnectionId: ImmutableMap.empty(),
        errorState: {hasError: false},
    };
}

export type DocumentContentEditorAction =
    | DocumentContentEditorEditAction
    | DocumentContentEditorReceiveStepsAction
    | DocumentContentEditorAugmentRememberedStepsAction
    | DocumentContentEditorSetAllOtherPresenceStatesAction
    | DocumentContentEditorUpdateOtherPresenceStateAction
    | DocumentContentEditorErrorAction;

type DocumentContentEditorEditAction = {
    readonly type: "Edit";
    readonly editorState: ContentEditorState<DocumentContentWithReferences>;
};

type DocumentContentEditorReceiveStepsAction = {
    readonly type: "ReceiveSteps";
    readonly newVersion: number;
    readonly steps: ReadonlyArray<{readonly step: Step; readonly clientId: ContentEditorClientId}>;
    readonly stepsContentReferences: DocumentContentReferences;
};

type DocumentContentEditorAugmentRememberedStepsAction = {
    readonly type: "AugmentRememberedSteps";
    readonly startVersion: number;
    readonly invertedSteps: ReadonlyArray<Step>;
};

type DocumentContentEditorSetAllOtherPresenceStatesAction = {
    readonly type: "SetAllOtherPresenceStates";
    readonly stateByConnectionId: ImmutableMap<
        WebSocketConnectionId,
        DocumentCollaborationPresenceState
    >;
};

type DocumentContentEditorUpdateOtherPresenceStateAction = {
    readonly type: "UpdateOtherPresenceState";
    readonly connectionId: WebSocketConnectionId;
    readonly state: DocumentCollaborationPresenceState | null;
};

type DocumentContentEditorErrorAction = {
    readonly type: "Error";
    readonly error: unknown;
};

export function reduceDocumentContentEditorState(
    state: DocumentContentEditorState,
    actions: ReadonlyArray<DocumentContentEditorAction>,
): DocumentContentEditorState {
    const oldRememberedSteps = state.rememberedSteps;
    const oldOtherPresenceStateByConnectionId = state.otherPresenceStateByConnectionId;

    const oldVersion = state.editorState.getVersion();
    state = actions.reduce(
        (state, action) => actuallyReduceDocumentContentEditorState(state, action),
        state,
    );
    const newVersion = state.editorState.getVersion();

    // If we are not currently sending steps to the server but we have some
    // sendable steps, then populate the `pendingSendableSteps` action.
    //
    // Most often this runs after an `Edit` action as we're typing. But may also
    // happen after a `ReceiveSteps` action where we've acknowledged our last
    // pending sendable steps.
    if (!state.pendingSendableSteps) {
        const sendableSteps = state.editorState.sendableSteps();
        if (sendableSteps) {
            // We can have multiple steps from the same origin transaction. So uniquify our
            // new comment thread objects.
            const createCommentThreads = Array.from(
                new Set(
                    filterMapIterable(
                        sendableSteps.origins,
                        transaction =>
                            transaction.getMeta(createDocumentCommentThreadMetaKey) ?? null,
                    ),
                ),
            );

            state = {
                ...state,
                pendingSendableSteps: sendableSteps
                    ? {
                          steps: sendableSteps.steps,
                          version: sendableSteps.version,
                          clientId: sendableSteps.clientId,
                          createCommentThreads,
                      }
                    : null,
                // Make sure our presence state is up-to-date as well since we will send it to
                // the server along with our sendable steps.
                ourPresenceState: {
                    version: state.editorState.getVersion(),
                    selection: state.editorState.getSelection(),
                },
            };
        }
    }

    // If `rememberedSteps` or `otherPresenceStateByConnectionId` changed, then
    // discard any `rememberedSteps` we don't need anymore for rebasing
    // presence state selections.
    if (
        state.rememberedSteps !== oldRememberedSteps ||
        state.otherPresenceStateByConnectionId !== oldOtherPresenceStateByConnectionId
    ) {
        let discardRememberedStepsBeforeVersion = state.editorState.getVersion();

        for (const presenceState of state.otherPresenceStateByConnectionId.values()) {
            if (presenceState.version < discardRememberedStepsBeforeVersion)
                discardRememberedStepsBeforeVersion = presenceState.version;
        }

        const newRememberedSteps = state.rememberedSteps.slice(
            state.rememberedSteps.length -
                (state.editorState.getVersion() - discardRememberedStepsBeforeVersion),
        );

        state = {...state, rememberedSteps: newRememberedSteps};
    }

    // If the version changed then we want to retry our pending actions since they
    // may be ok to run now.
    if (oldVersion === newVersion) return state;

    // We may receive actions out of order, but make sure we run them in order
    // now.
    const pendingActions = [...state.pendingActions].sort((pendingAction1, pendingAction2) => {
        const baseVersion1 = pendingAction1.newVersion - pendingAction1.steps.length;
        const baseVersion2 = pendingAction2.newVersion - pendingAction2.steps.length;
        return baseVersion1 - baseVersion2;
    });

    // We are going to try and run all pending actions. If actions are still
    // pending they will be put back into this array.
    state = {...state, pendingActions: []};

    return pendingActions.reduce(actuallyReduceDocumentContentEditorState, state);
}

function actuallyReduceDocumentContentEditorState(
    oldState: DocumentContentEditorState,
    action: DocumentContentEditorAction,
): DocumentContentEditorState {
    switch (action.type) {
        case "Edit": {
            // If an edit was made on top of a version of `editorState` that's different
            // from what's in state that means we may have some data loss!
            //
            // We've observed this happen when React cancels a low priority render in
            // response to a user keyboard event. So we wrap `dispatch()` so that it always
            // runs at a high priority.
            assert(
                action.editorState.getVersion() === oldState.editorState.getVersion(),
                "Edit was made on top of an editor state with a different base version than what is in React state",
            );

            // Don't update our `presenceState` when there are steps we are sending to the
            // server. Other clients would not know how to interpret our state until they
            // see our steps.
            if (oldState.pendingSendableSteps) {
                return {
                    ...oldState,
                    editorState: action.editorState,
                };
            }

            return {
                ...oldState,
                editorState: action.editorState,
                ourPresenceState: {
                    version: action.editorState.getVersion(),
                    selection: action.editorState.getSelection(),
                },
            };
        }
        case "ReceiveSteps": {
            const oldVersion = oldState.editorState.getVersion();
            if (action.newVersion <= oldVersion) return oldState;

            // If we received an action that's applied on a future version of our content,
            // we can't commit it until our local state has caught up. So stick it in
            // pending actions and we'll come back to it.
            if (oldVersion < action.newVersion - action.steps.length) {
                return {
                    ...oldState,
                    pendingActions: [...oldState.pendingActions, action],
                };
            }

            // We may dispatch this action multiple times with the same steps. Remove any
            // steps we've already seen.
            const steps = action.steps.slice(
                action.steps.length - (action.newVersion - oldVersion),
            );
            assert(oldVersion + steps.length === action.newVersion);

            // If we've already seen all the steps, no change is needed.
            if (steps.length === 0) return oldState;

            const editorState = oldState.editorState.receiveSteps(
                steps,
                action.stepsContentReferences,
            );

            // Whenever we receive steps, we add them to our `rememberedSteps` array.
            // We discard steps when we don't need them to rebase presence states.
            let rememberedSteps;
            {
                let content = new Lazy(() => oldState.editorState.getDocWithoutSendableSteps());

                const newRememberedSteps = steps.map(({step}) => {
                    const previousContent = content;

                    content = new Lazy(() => {
                        const stepResult = step.apply(previousContent.get());
                        assert(stepResult.doc);
                        assert(isDocumentContent(stepResult.doc));
                        return stepResult.doc;
                    });

                    return {
                        stepMap: step.getMap(),
                        contentBeforeStep: previousContent,
                        contentAfterStep: content,
                    };
                });

                rememberedSteps = [...oldState.rememberedSteps, ...newRememberedSteps];
            }

            return {
                ...oldState,
                editorState,
                rememberedSteps,
                pendingSendableSteps:
                    oldState.pendingSendableSteps &&
                    action.steps.some(({clientId}) => clientId === editorState.getClientId()) &&
                    action.newVersion >= oldState.pendingSendableSteps.version
                        ? null
                        : oldState.pendingSendableSteps,
            };
        }
        // If we are missing some remembered steps for fast-forwarding presence states
        // then we have an effect which fetches those steps from the server. This
        // action integrates the old steps into our state.
        case "AugmentRememberedSteps": {
            // Drop steps we're trying to remember that we already have.
            const rememberInvertedSteps = action.invertedSteps.slice(
                0,
                oldState.editorState.getVersion() -
                    oldState.rememberedSteps.length -
                    action.startVersion,
            );
            if (rememberInvertedSteps.length === 0) return oldState;

            let content =
                oldState.rememberedSteps[oldState.rememberedSteps.length - 1]?.contentBeforeStep ??
                new Lazy(() => oldState.editorState.getDocWithoutSendableSteps());

            const newRememberedSteps = [...rememberInvertedSteps].reverse().map(invertedStep => {
                const previousContent = content;

                content = new Lazy(() => {
                    const stepResult = invertedStep.apply(previousContent.get());
                    assert(stepResult.doc);
                    assert(isDocumentContent(stepResult.doc));
                    return stepResult.doc;
                });

                return {
                    stepMap: invertedStep.getMap().invert(),
                    contentBeforeStep: content,
                    contentAfterStep: previousContent,
                };
            });

            newRememberedSteps.reverse();

            return {
                ...oldState,
                rememberedSteps: [...newRememberedSteps, ...oldState.rememberedSteps],
            };
        }
        case "SetAllOtherPresenceStates": {
            return {
                ...oldState,
                otherPresenceStateByConnectionId: action.stateByConnectionId,
            };
        }
        case "UpdateOtherPresenceState": {
            return {
                ...oldState,
                otherPresenceStateByConnectionId: action.state
                    ? oldState.otherPresenceStateByConnectionId.set(
                          action.connectionId,
                          action.state,
                      )
                    : oldState.otherPresenceStateByConnectionId.delete(action.connectionId),
            };
        }
        case "Error": {
            return {
                ...oldState,
                errorState: {hasError: true, error: action.error},
            };
        }
        default:
            throw exhaustive(action);
    }
}

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
    private readonly _client: WebSocketClient<
        DocumentCollaborationMessageFromClient,
        DocumentCollaborationMessageFromServer
    >;
    private readonly _state: ValueStore<DocumentContentEditorState>;
    private _disconnect: (() => void) | null = null;

    public get state(): Store<DocumentContentEditorState> {
        return this._state;
    }

    constructor(getContext: () => AppContext, initialDocument: DocumentModel) {
        this.documentId = initialDocument.id;
        this._client = new WebSocketClient(
            getContext,
            DocumentCollaborationMessageFromClientSchema,
            DocumentCollaborationMessageFromServerSchema,
            `/durable-objects/documents/${initialDocument.id}`,
        );
        this._state = new ValueStore(getInitialDocumentContentEditorState(initialDocument));
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

        let isConnected = false;

        this._client.connect();

        const unsubscribeFromClientState = this._client.state.subscribe(() => {
            const clientState = this._client.state.getSnapshot();

            if (isConnected !== clientState.isConnected) {
                isConnected = clientState.isConnected;

                // Whenever we successfully connect to the WebSocket, send a backfill request
                // so we can get any steps we missed while disconnected from the WebSocket.
                if (isConnected) {
                    this._client
                        .sendMessage({
                            type: "BackfillRequest",
                            version: this._state.getSnapshot().editorState.getVersion(),
                        })
                        .catch(error => this._dispatch({type: "Error", error}));

                    maybeSendUpdatesToServer();
                }
            }
        });

        const unsubscribeFromClientMessages = this._client.subscribeToMessages(message => {
            switch (message.type) {
                case "BackfillResponse": {
                    const actions: Array<DocumentContentEditorAction> = [];

                    actions.push({
                        type: "SetAllOtherPresenceStates",
                        stateByConnectionId: ImmutableMap.from(
                            mapIterable(message.presenceStates, presenceState => [
                                presenceState.connectionId,
                                presenceState.state,
                            ]),
                        ),
                    });

                    actions.push({
                        type: "ReceiveSteps",
                        newVersion: message.newVersion,
                        steps: message.steps,
                        stepsContentReferences: message.stepsContentReferences,
                    });

                    if (message.rememberInvertedSteps.length > 0) {
                        actions.push({
                            type: "AugmentRememberedSteps",
                            startVersion:
                                message.newVersion -
                                message.steps.length -
                                message.rememberInvertedSteps.length,
                            invertedSteps: message.rememberInvertedSteps,
                        });
                    }

                    // One dispatch call just to make sure React applies these actions atomically
                    // and doesn't do any scheduling weirdness.
                    this._dispatchBatch(actions);
                    break;
                }
                case "UpdateContentWithoutPersistence": {
                    const actions: Array<DocumentContentEditorAction> = [];

                    actions.push({
                        type: "ReceiveSteps",
                        newVersion: message.newVersion,
                        steps: message.steps.map(step => ({
                            step,
                            clientId: message.clientId,
                        })),
                        stepsContentReferences: message.stepsContentReferences,
                    });

                    // If this was an acknowledgement message from our own client, don't add the
                    // presence state to our map.
                    if (message.clientId !== this._state.getSnapshot().editorState.getClientId()) {
                        actions.push({
                            type: "UpdateOtherPresenceState",
                            connectionId: message.updateOtherPresenceState.connectionId,
                            state: message.updateOtherPresenceState.state,
                        });
                    }

                    this._dispatchBatch(actions);
                    break;
                }
                case "PersistedContent": {
                    // TODO(calebmer): Show a saving indicator until content has persisted!
                    break;
                }
                case "UpdateOtherPresenceState": {
                    this._dispatch({
                        type: "UpdateOtherPresenceState",
                        connectionId: message.connectionId,
                        state: message.state,
                    });
                    break;
                }
                case "Error": {
                    this._dispatch({type: "Error", error: message.error});
                    break;
                }
                case "Comments": {
                    // NOCOMMIT
                    throw new UnimplementedError("TODO");
                }
                default:
                    throw exhaustive(message);
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

            if (!isConnected) {
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

                this._client
                    .sendMessage({
                        type: "UpdateContent",
                        version: state.pendingSendableSteps.version,
                        steps: state.pendingSendableSteps.steps,
                        clientId: state.pendingSendableSteps.clientId,
                        createCommentThreads: state.pendingSendableSteps.createCommentThreads,
                        updateOurPresenceState: {
                            state: state.ourPresenceState
                                ? {
                                      version: state.ourPresenceState.version,
                                      selection: ProsemirrorSelectionWrapper.new(
                                          state.ourPresenceState.selection,
                                      ),
                                  }
                                : null,
                        },
                    })
                    .catch(error => this._dispatch({type: "Error", error}));

                lastPendingSendableStepsVersionSentToServer = state.pendingSendableSteps.version;
                lastOurPresenceStateSentToServer = state.ourPresenceState;
            }

            if (
                (lastOurPresenceStateSentToServer === null) !== (state.ourPresenceState === null) ||
                (lastOurPresenceStateSentToServer !== null &&
                    state.ourPresenceState !== null &&
                    (lastOurPresenceStateSentToServer.version !== state.ourPresenceState.version ||
                        lastOurPresenceStateSentToServer.selection !==
                            state.ourPresenceState.selection))
            ) {
                cursorDisappearTimeout?.clear();
                cursorDisappearTimeout = null;

                this._client
                    .sendMessage({
                        type: "UpdateOurPresenceState",
                        state: state.ourPresenceState
                            ? {
                                  version: state.ourPresenceState.version,
                                  selection: ProsemirrorSelectionWrapper.new(
                                      state.ourPresenceState.selection,
                                  ),
                              }
                            : null,
                    })
                    .catch(error => this._dispatch({type: "Error", error}));

                lastOurPresenceStateSentToServer = state.ourPresenceState;

                // Clear our presence state after some period of inactivity so you don't have a
                // bunch of cursors laying around the document.
                if (state.ourPresenceState) {
                    // We have a much shorter timeout if our presence state is just a cursor. If
                    // the user has selected some text, we take longer to clear that timeout since
                    // maybe the user was intentionally trying to highlight text to show someone?
                    const cursorDisappearTimeoutMs =
                        state.ourPresenceState.selection.from ===
                        state.ourPresenceState.selection.to
                            ? 15 * 1000
                            : 15 * 60 * 1000;

                    cursorDisappearTimeout = createTimeout(() => {
                        this._client
                            .sendMessage({
                                type: "UpdateOurPresenceState",
                                state: null,
                            })
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

    public async sendCommentThreadMessage(
        commentThreadId: DocumentCommentThreadId,
        message: MessagingRealtimeMessageFromClient,
    ) {
        await this._client.sendMessage({
            type: "Comments",
            commentThreadId,
            message,
        });
    }
}
