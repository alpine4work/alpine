import {Command, Selection} from "prosemirror-state";
import {Step, StepMap} from "prosemirror-transform";
import {WebSocketClient, WebSocketClientState} from "~/client/cloudflare/web_socket_client";
import {
    ContentEditorReferencesAction,
    ContentEditorState,
    updateContentEditorReferences,
} from "~/client/content/content_editor_state";
import {AppContext} from "~/client/context/app_context";
import {Store} from "~/client/helpers/store/store";
import {ValueStore} from "~/client/helpers/store/value_store";
import {DocumentContent, isDocumentContent} from "~/shared/content/document_content_schema";
import {MessageContent, createSimpleMessageContent} from "~/shared/content/message_content_schema";
import {
    DocumentCollaborationMessageFromClient,
    DocumentCollaborationMessageFromClientSchema,
    DocumentCollaborationMessageFromServer,
    DocumentCollaborationMessageFromServerSchema,
    DocumentCollaborationPresenceState,
} from "~/shared/documents/document_collaboration_schema";
import {Timeout, createTimeout} from "~/shared/helpers/async/timeout";
import {assert} from "~/shared/helpers/control/assert";
import {exhaustive} from "~/shared/helpers/control/exhaustive";
import {Lazy} from "~/shared/helpers/control/lazy";
import {ImmutableMap} from "~/shared/helpers/immutable/immutable_map";
import {filterMapIterable} from "~/shared/helpers/iterable/filter_map_iterable";
import {mapIterable} from "~/shared/helpers/iterable/map_iterable";
import {generateId} from "~/shared/id/id";
import {
    ContentEditorClientId,
    DocumentCommentThreadId,
    DocumentId,
    WebSocketConnectionId,
} from "~/shared/id/types/id_types";
import {
    MessagingRealtimeMessageFromClient,
    MessagingRealtimeMessageFromServer,
} from "~/shared/messaging/messaging_realtime_schema";
import {AccountModel} from "~/shared/models/account_model";
import {
    DocumentCommentModel,
    DocumentContentReferences,
    DocumentContentWithReferences,
    DocumentModel,
    mergeDocumentContentReferences,
} from "~/shared/models/document_model";
import {ProsemirrorSelectionWrapper} from "~/shared/prosemirror/prosemirror_selection_schema";
import {trimSpacesFromProsemirrorRange} from "~/shared/prosemirror/trim_spaces_from_prosemirror_range";

export const createDocumentCommentThreadMetaKey = "createCommentThread";

export type DocumentContentEditorState = {
    /**
     * We may get `ReceiveSteps` actions out of order (e.g. the server sends an
     * `UpdateContent` message before a `BackfillCatchUpResponse` message). If we
     * see an action for a future version we put it in this array and re-apply the
     * action when older steps are applied.
     */
    readonly pendingActions: ReadonlyArray<DocumentContentEditorReceiveStepsAction>;

    /**
     * The current state of the editor.
     *
     * Will be null while the WebSocket is initializing and we know the
     * `DocumentId` but not the contents of the document.
     */
    readonly editorState: ContentEditorState<DocumentContentWithReferences> | null;

    /**
     * Remember some number of steps in our state to map phantom selections from
     * presence when they have an old version.
     *
     * The version of the document in the first remembered step's
     * `contentBeforeStep` is `editorState.getVersion() - rememberedSteps.length`.
     * Remembered steps are relative to `editorState` so if `editorState` is null
     * this is empty.
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
        // This action should be idempotent and runnable out-of-order. We don't have
        // strong comment thread correctness guarantees but it should converge to a
        // correct value as you use the product.
        case "UpdateDocumentCommentThread": {
            const commentThread = references.commentThreadById.get(action.commentThreadId);
            const newCommentThreadById = new Map(references.commentThreadById);
            const {commentThreadId, commentCount, addCommentAuthor} = action;

            if (!commentThread) {
                newCommentThreadById.set(commentThreadId, {
                    commentCount,
                    commentAuthors: addCommentAuthor ? [addCommentAuthor] : [],
                });
            } else {
                const newCommentThread = {
                    commentCount: Math.max(commentThread.commentCount, commentCount),
                    commentAuthors:
                        addCommentAuthor &&
                        commentThread.commentAuthors.every(
                            account => account.id !== addCommentAuthor.id,
                        )
                            ? [...commentThread.commentAuthors, addCommentAuthor]
                            : commentThread.commentAuthors,
                };

                // If the comment thread did not change, return the old references object.
                if (
                    newCommentThread.commentCount === commentThread.commentCount &&
                    newCommentThread.commentAuthors.length === commentThread.commentAuthors.length
                ) {
                    return references;
                }

                newCommentThreadById.set(commentThreadId, newCommentThread);
            }

            return {
                ...references,
                commentThreadById: newCommentThreadById,
            };
        }
        default:
            throw exhaustive(action);
    }
}

export function getInitialDocumentContentEditorState(
    currentAccount: AccountModel,
    initialDocument: DocumentModel | null,
): DocumentContentEditorState {
    const editorState = initialDocument
        ? ContentEditorState.createCollaborative<DocumentContentWithReferences>({
              version: initialDocument.version,
              content: initialDocument.content,
              reduceReferences: reduceDocumentContentReferences,
          })
        : null;

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
    | DocumentContentEditorResetEditorAction
    | DocumentContentEditorAugmentRememberedStepsAction
    | DocumentContentEditorSetAllOtherPresenceStatesAction
    | DocumentContentEditorUpdateOtherPresenceStateAction
    | DocumentContentEditorErrorAction
    | DocumentContentEditorUpdateCommentThreadAction;

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

type DocumentContentEditorResetEditorAction = {
    readonly type: "ResetEditor";
    readonly version: number;
    readonly content: DocumentContentWithReferences;
};

type DocumentContentEditorAugmentRememberedStepsAction = {
    readonly type: "AugmentRememberedSteps";
    readonly expectedVersion: number;
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

type DocumentContentEditorUpdateCommentThreadAction = {
    readonly type: "UpdateCommentThread";
    readonly commentThreadId: DocumentCommentThreadId;
    readonly commentCount: number;
    readonly addCommentAuthor: AccountModel | null;
};

export function reduceDocumentContentEditorState(
    state: DocumentContentEditorState,
    actions: ReadonlyArray<DocumentContentEditorAction>,
): DocumentContentEditorState {
    const oldRememberedSteps = state.rememberedSteps;
    const oldOtherPresenceStateByConnectionId = state.otherPresenceStateByConnectionId;

    const oldVersion = state.editorState?.getVersion();
    state = actions.reduce(
        (state, action) => actuallyReduceDocumentContentEditorState(state, action),
        state,
    );
    const newVersion = state.editorState?.getVersion();

    // If we are not currently sending steps to the server but we have some
    // sendable steps, then populate the `pendingSendableSteps` action.
    //
    // Most often this runs after an `Edit` action as we're typing. But may also
    // happen after a `ReceiveSteps` action where we've acknowledged our last
    // pending sendable steps.
    if (state.editorState && !state.pendingSendableSteps) {
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
        state.editorState &&
        (state.rememberedSteps !== oldRememberedSteps ||
            state.otherPresenceStateByConnectionId !== oldOtherPresenceStateByConnectionId)
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
            // If there is no editor state then we are currently loading the document so
            // ignore all edits. We consider the editor inert during this time. Typing
            // does nothing.
            if (!oldState.editorState) return oldState;

            // If an edit was made on top of a version of `editorState` that's different
            // from what's in state that means we may have some data loss!
            //
            // We've observed this happen when React cancels a low priority render in
            // response to a user keyboard event. So we wrap `dispatch()` so that it always
            // runs at a high priority.
            assert(
                action.editorState.getVersion() === oldState.editorState.getVersion(),
                "Edit was made on top of an editor state with a different base version than what is actually in our state",
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
            // If we don't have an editor state we are loading the document from the
            // server. If our document is taking a bit to load (maybe we need to load a lot
            // of content references?) then we may get a `ReceiveSteps` message before we
            // have the document to apply the steps to. So save the `ReceiveSteps` message
            // to try again later.
            if (!oldState.editorState) {
                return {
                    ...oldState,
                    pendingActions: [...oldState.pendingActions, action],
                };
            }

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
                const oldEditorState = oldState.editorState;
                let content = new Lazy(() => oldEditorState.getDocWithoutSendableSteps());

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
        case "ResetEditor": {
            const editorState =
                ContentEditorState.createCollaborative<DocumentContentWithReferences>({
                    version: action.version,
                    content: action.content,
                    reduceReferences: reduceDocumentContentReferences,
                });

            // NOTE(calebmer): We don't spread `...oldState` here so that when new state is
            // added it forces us to consider whether it should be reset or not.
            return {
                // Keep pending actions since we may have received updates while waiting on
                // our backfill.
                pendingActions: oldState.pendingActions,
                // Reset `editorState` and `rememberedSteps`. `rememberedSteps` is relative to
                // `editorState` so when `editorState` changes we can't appropriately interpret
                // `rememberedSteps` any longer.
                editorState,
                rememberedSteps: [],
                // Allow sending new changes from our new editor state which so far has no
                // pending changes. If there is an in-flight pending changes it will still be
                // in-flight, we will still get the update message, but we don't need to wait
                // for that acknowledgement anymore to send steps from our new editor state.
                //
                // We also would never be able to clear this since we are changing the
                // `ContentEditorClientId` in this reset.
                pendingSendableSteps: null,
                // Reset presence state since that's tied to editor state.
                ourPresenceState: null,
                // Keep the presence states of other users since that will be the same
                // regardless of our editor state.
                otherPresenceStateByConnectionId: oldState.otherPresenceStateByConnectionId,
                // Keep error state. We're resetting the editor, not errors.
                errorState: oldState.errorState,
            };
        }
        // If we are missing some remembered steps for fast-forwarding presence states
        // then we have an effect which fetches those steps from the server. This
        // action integrates the old steps into our state.
        case "AugmentRememberedSteps": {
            assert(
                action.expectedVersion === oldState.editorState?.getVersion(),
                "Failed to augment remembered steps because editor version does not match expected version",
            );

            // Drop steps we're trying to remember that we already have.
            const rememberInvertedSteps = action.invertedSteps.slice(
                0,
                oldState.editorState.getVersion() -
                    oldState.rememberedSteps.length -
                    action.startVersion,
            );
            if (rememberInvertedSteps.length === 0) return oldState;

            const oldEditorState = oldState.editorState;
            let content =
                oldState.rememberedSteps[oldState.rememberedSteps.length - 1]?.contentBeforeStep ??
                new Lazy(() => oldEditorState.getDocWithoutSendableSteps());

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
        case "UpdateCommentThread": {
            // If there is no old state, the editor should be inert.
            if (!oldState.editorState) return oldState;

            return {
                ...oldState,
                editorState: oldState.editorState.updateReferences({
                    type: "UpdateDocumentCommentThread",
                    commentThreadId: action.commentThreadId,
                    commentCount: action.commentCount,
                    addCommentAuthor: action.addCommentAuthor,
                }),
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

    public get webSocketState(): Store<WebSocketClientState> {
        return this._client.state;
    }

    constructor(
        getContext: () => AppContext,
        currentAccount: AccountModel,
        documentId: DocumentId,
        initialDocument: DocumentModel | null,
    ) {
        this.documentId = documentId;
        this._client = new WebSocketClient(
            getContext,
            DocumentCollaborationMessageFromClientSchema,
            DocumentCollaborationMessageFromServerSchema,
            `/durable-objects/documents/${documentId}`,
        );
        this._state = new ValueStore(
            getInitialDocumentContentEditorState(currentAccount, initialDocument),
        );
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
                            version: this._state.getSnapshot().editorState?.getVersion() ?? null,
                        })
                        .catch(error => this._dispatch({type: "Error", error}));

                    maybeSendUpdatesToServer();
                }
            }
        });

        const unsubscribeFromClientMessages = this._client.subscribeToMessages(message => {
            switch (message.type) {
                case "BackfillCatchUpResponse": {
                    // One dispatch call just to make sure React applies these actions atomically
                    // and doesn't do any scheduling weirdness.
                    this._dispatchBatch([
                        {
                            type: "SetAllOtherPresenceStates",
                            stateByConnectionId: ImmutableMap.from(
                                mapIterable(message.presenceStates, presenceState => [
                                    presenceState.connectionId,
                                    presenceState.state,
                                ]),
                            ),
                        },
                        {
                            type: "ReceiveSteps",
                            newVersion: message.newVersion,
                            steps: message.steps,
                            stepsContentReferences: message.stepsContentReferences,
                        },

                        // Unconditionally run this action even if we have no new remembered steps
                        // because it will throw if the editor version in state is not
                        // `expectedVersion`. This is a nice way to double check that our previous
                        // action actually caught us up.
                        {
                            type: "AugmentRememberedSteps",
                            expectedVersion: message.newVersion,
                            startVersion:
                                message.newVersion -
                                message.steps.length -
                                message.rememberInvertedSteps.length,
                            invertedSteps: message.rememberInvertedSteps,
                        },
                    ]);
                    break;
                }
                // For the edge case where an `initialDocument` is not provided. Then we need
                // to load it during backfill.
                //
                // We expect this case to be very rare. For instance in the following race
                // condition:
                //
                // 1. User starts loading comment thread peek on top of document (so its
                //    `loader` is instructed to not load the document)
                // 2. User navigates away from document before peek finishes loading
                // 3. Peek stays and finishes loading with no document. If it were still on top
                //    of the document route, there would be a shared WebSocket to reuse in
                //    context. Since there is not and the peek creates its own WebSocket client
                //    then we need to load the document from the server
                case "BackfillResetResponse": {
                    // One dispatch call just to make sure React applies these actions atomically
                    // and doesn't do any scheduling weirdness.
                    this._dispatchBatch([
                        {
                            type: "SetAllOtherPresenceStates",
                            stateByConnectionId: ImmutableMap.from(
                                mapIterable(message.presenceStates, presenceState => [
                                    presenceState.connectionId,
                                    presenceState.state,
                                ]),
                            ),
                        },
                        {
                            type: "ResetEditor",
                            version: message.version,
                            content: message.content,
                        },

                        // Unconditionally run this action even if we have no new remembered steps
                        // because it will throw if the editor version in state is not
                        // `expectedVersion`. This is a nice way to double check that our previous
                        // action actually caught us up.
                        {
                            type: "AugmentRememberedSteps",
                            expectedVersion: message.version,
                            startVersion: message.version - message.rememberInvertedSteps.length,
                            invertedSteps: message.rememberInvertedSteps,
                        },
                    ]);
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
                    //
                    // If we don't have an editor state then our document is loading so there should
                    // be no updates from this client and we should always update the presence
                    // state.
                    if (message.clientId !== this._state.getSnapshot().editorState?.getClientId()) {
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
                    // Comment realtime events are handled by callers to
                    // `subscribeToCommentThreadMessages()`. Keep our editor state up to date here
                    // by dispatching an action to update our references.
                    //
                    // We keep comment threads up-to-date with best effort. There are likely a
                    // handful of rare correctness bugs. For instance, we don't backfill comment
                    // counts! So if you miss a new comment while the page is loading you may see an
                    // old comment count. However, the UI will eventually converge to the correct
                    // comment count on the next realtime message or if the user opens the comment
                    // thread. However the UI may not converge on the right set of comment authors
                    // since the full author list is not included in realtime events unlike the full
                    // comment count. We consider this acceptable.
                    if (message.message.type === "NewMessage") {
                        this._dispatch({
                            type: "UpdateCommentThread",
                            commentThreadId: message.commentThreadId,
                            commentCount: message.message.message.index + 1,
                            addCommentAuthor: message.message.message.author,
                        });
                    } else if (message.message.type === "BackfillMessagesResponse") {
                        this._dispatch({
                            type: "UpdateCommentThread",
                            commentThreadId: message.commentThreadId,
                            commentCount: message.message.messageCount,
                            addCommentAuthor: null,
                        });
                    }
                    break;
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

    public subscribeToCommentThreadMessages(
        commentThreadId: DocumentCommentThreadId,
        subscriber: (message: MessagingRealtimeMessageFromServer<DocumentCommentModel>) => void,
    ) {
        return this._client.subscribeToMessages(message => {
            if (message.type === "Comments" && message.commentThreadId === commentThreadId) {
                subscriber(message.message);
            }
        });
    }
}

/**
 * Command for adding a comment to a document. This command was adapted from
 * `createToggleMarkCommand()`.
 */
function createAddCommentCommand(currentAccount: AccountModel): Command {
    return (state, dispatch) => {
        let doesAnyNodeAllowMarkType = false;

        state.doc.nodesBetween(state.selection.from, state.selection.to, (node, pos) => {
            // If we have found at least one node that can become our mark type we don't
            // need to keep iterating.
            if (doesAnyNodeAllowMarkType) return false;

            // Ignore nodes that aren't inline.
            if (!node.isInline) return;

            // Ignore nodes that don't support our mark type.
            const $pos = state.doc.resolve(pos);
            if (
                !state.schema.marks.comment ||
                !$pos.parent.type.allowsMarkType(state.schema.marks.comment)
            ) {
                return;
            }

            doesAnyNodeAllowMarkType = true;
        });

        if (!doesAnyNodeAllowMarkType) return false;

        if (dispatch) {
            const commentThreadId = generateId<DocumentCommentThreadId>();
            const range = trimSpacesFromProsemirrorRange(state.doc, state.selection);
            dispatch(
                updateContentEditorReferences(
                    state.tr
                        .addMark(
                            range.from,
                            range.to,
                            state.schema.mark("comment", {commentThreadId}),
                        )
                        .setMeta(createDocumentCommentThreadMetaKey, {
                            commentThreadId,
                            initialCommentContent: createSimpleMessageContent("test"),
                        })
                        .scrollIntoView(),
                    {
                        type: "UpdateDocumentCommentThread",
                        commentThreadId,
                        commentCount: 1,
                        addCommentAuthor: currentAccount,
                    },
                ),
            );
        }

        return true;
    };
}
