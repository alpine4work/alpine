/**
 * Test cases I've used when working on this file:
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

import murmurhash from "murmurhash";
import {Selection, TextSelection} from "prosemirror-state";
import {Mapping, Step, StepMap} from "prosemirror-transform";
import {
    MutableRefObject,
    useCallback,
    useEffect,
    useMemo,
    useReducer,
    useRef,
    useState,
} from "react";
import {unstable_ImmediatePriority, unstable_runWithPriority} from "scheduler";
import {ContentEditorPhantomSelection} from "~/client/content/content_editor";
import {ContentEditorState} from "~/client/content/content_editor_state";
import {useDevConsoleTool} from "~/client/dev/dev_console";
import {useWebSocket} from "~/client/helpers/use_web_socket";
import {
    DocumentContent,
    DocumentContentProsemirrorSchema,
    isDocumentContent,
} from "~/shared/content/document_content_schema";
import {defaultThemeColor, themeColors} from "~/shared/design/theme_colors";
import {
    DocumentCollaborationMessageFromClientSchema,
    DocumentCollaborationMessageFromServerSchema,
    DocumentCollaborationPresenceState,
} from "~/shared/documents/document_collaboration_schema";
import {createTimeout} from "~/shared/helpers/async/timeout";
import {assert} from "~/shared/helpers/control/assert";
import {exhaustive} from "~/shared/helpers/control/exhaustive";
import {Lazy} from "~/shared/helpers/control/lazy";
import {ImmutableMap} from "~/shared/helpers/immutable/immutable_map";
import {mapIterable} from "~/shared/helpers/iterable/map_iterable";
import {generateId} from "~/shared/id/id";
import {
    ContentEditorClientId,
    DocumentCollaborationMessageId,
    WebSocketConnectionId,
} from "~/shared/id/types/id_types";
import {DocumentModel} from "~/shared/models/document_model";
import {ProsemirrorSelectionWrapper} from "~/shared/prosemirror/prosemirror_selection_schema";

export type DocumentContentEditorState = {
    /**
     * We may get `ReceiveSteps` actions out of order (e.g. the server sends an
     * `UpdateContent` message before a `BackfillResponse` message). If we see an
     * action for a future version we put it in this array and re-apply the action
     * when older steps are applied.
     */
    readonly pendingActions: Array<ReceiveStepsDocumentContentEditorAction>;

    /**
     * The current state of the editor.
     */
    readonly editorState: ContentEditorState<DocumentContent>;

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
        readonly clientId: ContentEditorClientId;
        readonly version: number;
        readonly messageId: DocumentCollaborationMessageId;
        readonly shouldSendToServerRef: MutableRefObject<boolean>;
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
        readonly state: {
            readonly version: number;
            readonly selection: Selection;
        } | null;
        readonly shouldSendToServerRef: MutableRefObject<boolean>;
    };

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
};

export function getInitialDocumentContentEditorState(
    initialDocument: DocumentModel,
): DocumentContentEditorState {
    const editorState = ContentEditorState.createCollaborative({
        version: initialDocument.version,
        content: initialDocument.content,
    });

    return {
        pendingActions: [],
        editorState,
        rememberedSteps: [],
        pendingSendableSteps: null,
        ourPresenceState: {
            state: null,
            shouldSendToServerRef: {current: false},
        },
        otherPresenceStateByConnectionId: ImmutableMap.empty(),
    };
}

export type DocumentContentEditorAction =
    | EditDocumentContentEditorAction
    | ReceiveStepsDocumentContentEditorAction
    | AugmentRememberedStepsDocumentContentEditorAction
    | SetAllOtherPresenceStatesDocumentContentEditorAction
    | UpdateOtherPresenceStateDocumentContentEditorAction;

type EditDocumentContentEditorAction = {
    readonly type: "Edit";
    readonly editorState: ContentEditorState<DocumentContent>;
};

type ReceiveStepsDocumentContentEditorAction = {
    readonly type: "ReceiveSteps";
    readonly newVersion: number;
    readonly steps: ReadonlyArray<{readonly step: Step; readonly clientId: ContentEditorClientId}>;
    readonly acknowledgeMessageId: DocumentCollaborationMessageId | null;
};

type AugmentRememberedStepsDocumentContentEditorAction = {
    readonly type: "AugmentRememberedSteps";
    readonly startVersion: number;
    readonly invertedSteps: ReadonlyArray<Step>;
};

type SetAllOtherPresenceStatesDocumentContentEditorAction = {
    readonly type: "SetAllOtherPresenceStates";
    readonly stateByConnectionId: ImmutableMap<
        WebSocketConnectionId,
        DocumentCollaborationPresenceState
    >;
};

type UpdateOtherPresenceStateDocumentContentEditorAction = {
    readonly type: "UpdateOtherPresenceState";
    readonly connectionId: WebSocketConnectionId;
    readonly state: DocumentCollaborationPresenceState | null;
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
            state = {
                ...state,
                pendingSendableSteps: sendableSteps
                    ? {
                          steps: sendableSteps.steps,
                          version: sendableSteps.version,
                          clientId: sendableSteps.clientId,
                          messageId: generateId(),
                          shouldSendToServerRef: {current: true},
                      }
                    : null,
                // Make sure our presence state is up-to-date as well since we will send it to
                // the server along with our sendable steps.
                ourPresenceState: {
                    state: {
                        version: state.editorState.getVersion(),
                        selection: state.editorState.getSelection(),
                    },
                    shouldSendToServerRef: {current: true},
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
                    state: {
                        version: action.editorState.getVersion(),
                        selection: action.editorState.getSelection(),
                    },
                    shouldSendToServerRef: {current: true},
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

            let editorState = oldState.editorState;
            let stepTransaction: Array<{step: Step; clientId: ContentEditorClientId}> = [];

            // `prosemirror-collab` needs steps from our `clientId` to be at the beginning
            // of the `receiveSteps()` call. So call `receiveSteps()` whenever the
            // `clientId` of our steps change.
            //
            // Arguably, this is a bug in `prosemirror-collab`.
            //
            // Here is the code which requires our steps to be first this:
            // https://github.com/ProseMirror/prosemirror-collab/blob/94df0cc9288960e7e64dc9721abbf8f656df444f/src/collab.ts#L125-L129
            for (const {step, clientId} of steps) {
                if (
                    stepTransaction.length > 0 &&
                    stepTransaction[stepTransaction.length - 1]!.clientId !== clientId
                ) {
                    editorState = editorState.receiveSteps(stepTransaction);
                    stepTransaction = [];
                }

                stepTransaction.push({step, clientId});
            }

            editorState = editorState.receiveSteps(stepTransaction);
            stepTransaction = [];

            // Whenever we receive steps, we add them to our `rememberedSteps` array.
            // We discard steps when we don't need them to rebase presence states.
            let rememberedSteps;
            {
                let content = new Lazy(() => oldState.editorState.getContentWithoutSendableSteps());

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
                    oldState.pendingSendableSteps?.messageId === action.acknowledgeMessageId
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
                new Lazy(() => oldState.editorState.getContentWithoutSendableSteps());

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
        default:
            throw exhaustive(action);
    }
}

export function useDocumentContentEditorState(initialDocument: DocumentModel) {
    const documentId = initialDocument.id;

    const [state, _dispatch] = useReducer(
        reduceDocumentContentEditorState,
        initialDocument,
        getInitialDocumentContentEditorState,
    );

    const dispatch = useCallback((actions: ReadonlyArray<DocumentContentEditorAction>) => {
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
        let priorityLevel: number | null = null;
        for (const action of actions) {
            switch (action.type) {
                case "Edit":
                case "ReceiveSteps":
                    priorityLevel = unstable_ImmediatePriority;
                    break;
                case "AugmentRememberedSteps":
                case "SetAllOtherPresenceStates":
                case "UpdateOtherPresenceState":
                    break;
                default:
                    throw exhaustive(action);
            }
        }

        if (priorityLevel === null) {
            _dispatch(actions);
        } else {
            unstable_runWithPriority(priorityLevel, () => {
                _dispatch(actions);
            });
        }
    }, []);

    const [errorState, setErrorState] = useState<
        {hasError: false} | {hasError: true; error: unknown}
    >({hasError: false});

    // TODO(calebmer): We probably want some retry mechanism for the user? But
    // until the user retries, we don't want an infinite loop where we keep trying
    // to update the document content.
    if (errorState.hasError) throw errorState.error;

    const {isConnected, sendMessage, toggleShouldConnect} = useWebSocket(
        DocumentCollaborationMessageFromClientSchema,
        DocumentCollaborationMessageFromServerSchema,
        `/durable-objects/documents/${documentId}`,
        message => {
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
                        acknowledgeMessageId: null,
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
                    dispatch(actions);
                    break;
                }
                case "UpdateContentBeforePersistence": {
                    const actions: Array<DocumentContentEditorAction> = [];

                    actions.push({
                        type: "ReceiveSteps",
                        newVersion: message.newVersion,
                        steps: message.steps.map(step => ({
                            step,
                            clientId: message.clientId,
                        })),
                        acknowledgeMessageId: message.acknowledgeMessageId,
                    });

                    // If this was an acknowledgement message from our own client, don't add the
                    // presence state to our map.
                    if (message.clientId !== state.editorState.getClientId()) {
                        actions.push({
                            type: "UpdateOtherPresenceState",
                            connectionId: message.updateOtherPresenceState.connectionId,
                            state: message.updateOtherPresenceState.state,
                        });
                    }

                    dispatch(actions);
                    break;
                }
                case "PersistedContent": {
                    // TODO(calebmer): Show a saving indicator until content has persisted!
                    break;
                }
                case "UpdateOtherPresenceState": {
                    dispatch([
                        {
                            type: "UpdateOtherPresenceState",
                            connectionId: message.connectionId,
                            state: message.state,
                        },
                    ]);
                    break;
                }
                case "Error": {
                    setErrorState({
                        hasError: true,
                        error: message.error,
                    });
                    break;
                }
                default:
                    throw exhaustive(message);
            }
        },
    );

    const versionRef = useRef(state.editorState.getVersion());
    useEffect(() => {
        versionRef.current = state.editorState.getVersion();
    });

    // Whenever we successfully connect to the WebSocket, send a backfill request
    // so we can get any steps we missed while disconnected from the WebSocket.
    useEffect(() => {
        if (isConnected) {
            sendMessage({
                type: "BackfillRequest",
                version: versionRef.current,
            });
        }

        // NOTE(calebmer): Be careful about what you put into this dependency array! We
        // only want to re-run this effect when the `isConnected` flag flips.
    }, [isConnected, sendMessage]);

    // Send any updates we have in state to the server when we are connected! Only
    // sends each update to the server once. Tracks whether we have sent updates
    // with a ref.
    useEffect(() => {
        if (!isConnected) return;

        if (state.pendingSendableSteps?.shouldSendToServerRef.current) {
            sendMessage({
                type: "UpdateContent",
                version: state.pendingSendableSteps.version,
                steps: state.pendingSendableSteps.steps,
                clientId: state.pendingSendableSteps.clientId,
                messageId: state.pendingSendableSteps.messageId,
                updateOurPresenceState: {
                    state: state.ourPresenceState.state
                        ? {
                              version: state.ourPresenceState.state.version,
                              selection: ProsemirrorSelectionWrapper.new(
                                  state.ourPresenceState.state.selection,
                              ),
                          }
                        : null,
                },
            });

            state.pendingSendableSteps.shouldSendToServerRef.current = false;
            state.ourPresenceState.shouldSendToServerRef.current = false;
        }

        if (state.ourPresenceState.shouldSendToServerRef.current) {
            sendMessage({
                type: "UpdateOurPresenceState",
                state: state.ourPresenceState.state
                    ? {
                          version: state.ourPresenceState.state.version,
                          selection: ProsemirrorSelectionWrapper.new(
                              state.ourPresenceState.state.selection,
                          ),
                      }
                    : null,
            });

            state.ourPresenceState.shouldSendToServerRef.current = false;
        }
    }, [isConnected, sendMessage, state.pendingSendableSteps, state.ourPresenceState]);

    // Clear our presence state after some period of inactivity so you don't have a
    // bunch of cursors laying around the document.
    useEffect(() => {
        if (!isConnected) return;
        if (!state.ourPresenceState.state) return;

        // We have a much shorter timeout if our presence state is just a cursor. If
        // the user has selected some text, we take longer to clear that timeout since
        // maybe the user was intentionally trying to highlight text to show someone?
        const cursorDisappearTimeoutMs =
            state.ourPresenceState.state.selection.from ===
            state.ourPresenceState.state.selection.to
                ? 15 * 1000
                : 15 * 60 * 1000;

        const timeout = createTimeout(() => {
            sendMessage({
                type: "UpdateOurPresenceState",
                state: null,
            });
        }, cursorDisappearTimeoutMs);

        return () => {
            timeout.clear();
        };
    }, [isConnected, sendMessage, state.ourPresenceState.state]);

    // The presence states we get from our presence channel may be outdated because
    // when the document updates and the cursor needs to move, we do not send a
    // `UpdateOtherPresenceState` update as this would cause a thundering herd of
    // presence updates on every content update.
    //
    // There may be some performance optimizations we could be doing here. If you
    // have 100 cursors but only 1 is moving you only need to recompute that 1.
    const presenceStates = useMemo(() => {
        let presenceStates: Array<{
            connectionId: WebSocketConnectionId;
            selection: Selection;
        }> = [];

        for (const [connectionId, presenceState] of state.otherPresenceStateByConnectionId) {
            /* ========================================================================== *\
             * 1. Fast-forward outdated presence states if we can, otherwise drop         *
            \* ========================================================================== */

            const editorVersion = state.editorState.getVersion();

            // If the presence state version is equal to our editor version, then we don't
            // need to transform the selection.
            if (presenceState.version === editorVersion) {
                presenceStates.push({
                    connectionId,
                    selection: presenceState.selection.getAndMaybeDeserialize(
                        state.editorState.getContentWithoutSendableSteps(),
                    ),
                });
            }
            // We don't update presence states if the document changes but the selection
            // doesn't move. Instead clients are responsible for updating selections that
            // didn't move to the new document locally.
            //
            // We may not have enough `rememberedSteps` to fast-forward the presence state.
            // In this case we will drop the presence state. We then fetch
            // steps required to fast-forward the presence state asynchronously.
            //
            // It's important that we record `smallestPresenceStateVersion` before this
            // step since we're about to update all our presence state versions.
            else if (
                presenceState.version < editorVersion &&
                presenceState.version >= editorVersion - state.rememberedSteps.length
            ) {
                const oldContent =
                    state.rememberedSteps[
                        state.rememberedSteps.length - (editorVersion - presenceState.version)
                    ]!.contentBeforeStep.get();

                let selection = presenceState.selection.getAndMaybeDeserialize(oldContent);

                for (let version = presenceState.version; version < editorVersion; version++) {
                    if (!selection) break;

                    const {stepMap, contentAfterStep} =
                        state.rememberedSteps[
                            state.rememberedSteps.length - (editorVersion - version)
                        ]!;

                    selection = selection.map(contentAfterStep.get(), stepMap);
                }

                presenceStates.push({
                    connectionId,
                    selection,
                });
            } else {
                // The remaining cases here are:
                //
                // 1. Presence states at a future version. (Should not happen.)
                // 2. Presence states that we couldn't catch because we don't have enough
                //    `rememberedSteps`. We will try to fetch more `rememberedSteps` to
                //    render these.
                //
                // We are ok dropping these presence states. In case 2 we will send a network
                // request to load more steps and re-render the component. At this point the
                // presence states will be shown.
            }
        }

        /* ========================================================================== *\
         * 2. Apply local, unconfirmed, steps to presence states                      *
        \* ========================================================================== */

        // Other clients do not know about our local, unconfirmed, steps in
        // `sendableSteps()`. So we need to apply those steps to every single presence
        // state.
        const sendableSteps = state.editorState.sendableSteps();
        if (sendableSteps) {
            const content = state.editorState.getContent();

            const mapping = new Mapping();
            for (const step of sendableSteps.steps) mapping.appendMap(step.getMap());

            presenceStates = presenceStates.map(presenceState => ({
                connectionId: presenceState.connectionId,
                selection: presenceState.selection.map(content, mapping),
            }));
        }

        return presenceStates;
    }, [state.editorState, state.otherPresenceStateByConnectionId, state.rememberedSteps]);

    // Transform the presence states of our connected clients into cursor
    // decorations. We drop any cursors from before our document loaded because we
    // don't have the steps to map their positions.
    const phantomSelections = useMemo(() => {
        const phantomSelections: Array<ContentEditorPhantomSelection> = [];

        const filteredThemeColors = themeColors.filter(
            // TODO(calebmer): When the theme color is configurable, we should use that
            // instead of the default theme color.
            themeColor => themeColor !== defaultThemeColor && themeColor !== "yellow",
        );

        for (const presenceState of presenceStates) {
            const color =
                filteredThemeColors[
                    murmurhash.v3(presenceState.connectionId) % filteredThemeColors.length
                ]!;

            phantomSelections.push({
                key: presenceState.connectionId,
                color,
                anchor: presenceState.selection.anchor,
                head: presenceState.selection.head,
                isTextSelection: presenceState.selection instanceof TextSelection,
            });
        }

        return phantomSelections;
    }, [presenceStates]);

    useDevConsoleTool(
        "DocumentContentEditor",
        useCallback(
            () => ({
                prosemirrorSchema: DocumentContentProsemirrorSchema,
                toggleShouldConnect,
            }),
            [toggleShouldConnect],
        ),
    );

    return {
        editorState: state.editorState,
        onChangeEditorState: (editorState: ContentEditorState<DocumentContent>) =>
            dispatch([{type: "Edit", editorState}]),
        phantomSelections,
    };
}
