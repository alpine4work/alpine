import murmurhash from "murmurhash";
import {TextSelection} from "prosemirror-state";
import {Step} from "prosemirror-transform";
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
import {ContentEditorPhantomTextSelection} from "~/client/content/content_editor";
import {ContentEditorState} from "~/client/content/content_editor_state";
import {useWebSocket} from "~/client/helpers/use_web_socket";
import {themeColors} from "~/shared/design/theme_colors";
import {
    DocumentCollaborationMessageFromClientSchema,
    DocumentCollaborationMessageFromServerSchema,
    DocumentCollaborationPresenceState,
} from "~/shared/documents/document_collaboration_schema";
import {DocumentContent, isDocumentContent} from "~/shared/documents/document_content_schema";
import {DocumentModel} from "~/shared/documents/document_model";
import {runPromiseWithoutAwaiting} from "~/shared/helpers/async/run_promise_without_awaiting";
import {assert} from "~/shared/helpers/control/assert";
import {exhaustive} from "~/shared/helpers/control/exhaustive";
import {Lazy} from "~/shared/helpers/control/lazy";
import {ImmutableMap} from "~/shared/helpers/immutable/immutable_map";
import {mapIterable} from "~/shared/helpers/iterable/map_iterable";
import {Id, generateId} from "~/shared/id/id";
import {getDocumentContentSteps} from "~/shared/network/documents_network_definition";
import {defaultThemeColor} from "~/shared/styles/styles";

type State = {
    /**
     * We may get `ReceiveSteps` actions out of order (e.g. the server sends an
     * `UpdateContent` message before a `BackfillResponse` message). If we see an
     * action for a future version we put it in this array and re-apply the action
     * when older steps are applied.
     */
    readonly pendingActions: Array<ReceiveStepsAction>;
    /**
     * The current state of the editor.
     */
    readonly editorState: ContentEditorState<DocumentContent>;
    /**
     * Remember some number of steps in our state to map phantom selections from
     * presence when they have an old version.
     */
    readonly rememberedSteps: ReadonlyArray<{
        readonly step: Step;
        readonly contentBeforeStep: Lazy<DocumentContent>;
        readonly contentAfterStep: Lazy<DocumentContent>;
    }>;
    /**
     * Steps we have sent to the server which we are waiting on
     * acknowledgement for.
     */
    readonly pendingSendableSteps: {
        readonly steps: ReadonlyArray<Step>;
        readonly clientId: Id;
        readonly version: number;
        readonly messageId: Id;
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
            readonly textSelection: TextSelection;
        } | null;
        readonly shouldSendToServerRef: MutableRefObject<boolean>;
    };
};

function getInitialState(initialDocument: DocumentModel): State {
    const editorState = ContentEditorState.createCollab({
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
    };
}

type Action = EditAction | ReceiveStepsAction | AugmentRememberedStepsAction;

type EditAction = {
    readonly type: "Edit";
    readonly editorState: ContentEditorState<DocumentContent>;
};

type ReceiveStepsAction = {
    readonly type: "ReceiveSteps";
    readonly newVersion: number;
    readonly steps: ReadonlyArray<{readonly step: Step; readonly clientId: Id}>;
    readonly acknowledgeMessageId: Id | null;
    readonly discardRememberedStepsBeforeVersion: number;
};

type AugmentRememberedStepsAction = {
    readonly type: "AugmentRememberedSteps";
    readonly startVersion: number;
    readonly steps: ReadonlyArray<{
        readonly step: Step;
        readonly invertedStep: Step;
    }>;
};

function reduce(state: State, action: Action): State {
    const oldVersion = state.editorState.getVersion();
    state = reduceWithAction(state, action);
    const newVersion = state.editorState.getVersion();

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

    return pendingActions.reduce(reduceWithAction, state);
}

function reduceWithAction(oldState: State, action: Action): State {
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

            const textSelection = action.editorState.getTextSelection();

            // Don't update our `presenceState` when there are steps we are sending to the
            // server. Other clients would not know how to interpret our state until they
            // see our steps.
            if (oldState.pendingSendableSteps) {
                return {
                    ...oldState,
                    editorState: action.editorState,
                };
            }

            const pendingSendableSteps = action.editorState.sendableSteps();
            return {
                ...oldState,
                editorState: action.editorState,
                pendingSendableSteps: pendingSendableSteps
                    ? {
                          steps: pendingSendableSteps.steps,
                          version: pendingSendableSteps.version,
                          clientId: pendingSendableSteps.clientId,
                          messageId: generateId(),
                          shouldSendToServerRef: {current: true},
                      }
                    : null,
                ourPresenceState: {
                    state: textSelection
                        ? {
                              version: action.editorState.getVersion(),
                              textSelection,
                          }
                        : null,
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
            const steps = action.steps.slice(action.steps.length - action.newVersion - oldVersion);
            assert(oldVersion + steps.length === action.newVersion);

            // If we've already seen all the steps, no change is needed.
            if (steps.length === 0) return oldState;

            let editorState = oldState.editorState;
            let stepTransaction: Array<{step: Step; clientId: Id}> = [];

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
            //
            // We also throw away steps we don't need anymore based on
            // `discardRememberedStepsBeforeVersion`.
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
                        step,
                        contentBeforeStep: previousContent,
                        contentAfterStep: content,
                    };
                });

                rememberedSteps = [...oldState.rememberedSteps, ...newRememberedSteps];
                rememberedSteps = rememberedSteps.slice(
                    rememberedSteps.length -
                        (editorState.getVersion() - action.discardRememberedStepsBeforeVersion),
                );
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
            assert(
                action.startVersion + action.steps.length ===
                    oldState.editorState.getVersion() - oldState.rememberedSteps.length,
            );

            let content =
                oldState.rememberedSteps[oldState.rememberedSteps.length - 1]?.contentBeforeStep ??
                new Lazy(() => oldState.editorState.getContentWithoutSendableSteps());

            const newRememberedSteps = [...action.steps].reverse().map(({step, invertedStep}) => {
                const previousContent = content;

                content = new Lazy(() => {
                    const stepResult = invertedStep.apply(previousContent.get());
                    assert(stepResult.doc);
                    assert(isDocumentContent(stepResult.doc));
                    return stepResult.doc;
                });

                return {
                    step,
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
        default:
            throw exhaustive(action);
    }
}

export function useDocumentContentEditorState(initialDocument: DocumentModel) {
    const documentId = initialDocument.id;

    const [state, _dispatch] = useReducer(reduce, initialDocument, getInitialState);

    const dispatch = useCallback((action: Action) => {
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
        let priorityLevel: number | null;
        switch (action.type) {
            case "Edit":
            case "ReceiveSteps":
                priorityLevel = unstable_ImmediatePriority;
                break;
            case "AugmentRememberedSteps":
                priorityLevel = null;
                break;
            default:
                throw exhaustive(action);
        }

        if (priorityLevel === null) {
            _dispatch(action);
        } else {
            unstable_runWithPriority(priorityLevel, () => {
                _dispatch(action);
            });
        }
    }, []);

    const [otherPresenceStateByConnectionId, setOtherPresenceStateByConnectionId] = useState<
        ImmutableMap<Id, DocumentCollaborationPresenceState>
    >(ImmutableMap.empty());

    const [errorState, setErrorState] = useState<
        {hasError: false} | {hasError: true; error: unknown}
    >({hasError: false});

    // TODO(calebmer): We probably want some retry mechanism for the user? But
    // until the user retries, we don't want an infinite loop where we keep trying
    // to update the document content.
    if (errorState.hasError) throw errorState.error;

    const {isConnected, sendMessage} = useWebSocket(
        DocumentCollaborationMessageFromClientSchema,
        DocumentCollaborationMessageFromServerSchema,
        `/durable-objects/documents/${documentId}`,
        message => {
            switch (message.type) {
                case "BackfillResponse": {
                    dispatch({
                        type: "ReceiveSteps",
                        newVersion: message.newVersion,
                        steps: message.steps,
                        acknowledgeMessageId: null,
                        // If `smallestPresenceStateVersion` is not set then discard ALL steps by
                        // setting to the new version.
                        discardRememberedStepsBeforeVersion:
                            smallestPresenceStateVersion ?? message.newVersion,
                    });

                    setOtherPresenceStateByConnectionId(
                        ImmutableMap.from(
                            mapIterable(message.presenceStates, presenceState => [
                                presenceState.connectionId,
                                presenceState.state,
                            ]),
                        ),
                    );
                    break;
                }
                case "UpdateContentBeforePersistence": {
                    dispatch({
                        type: "ReceiveSteps",
                        newVersion: message.newVersion,
                        steps: message.steps.map(step => ({
                            step,
                            clientId: message.clientId,
                        })),
                        acknowledgeMessageId: message.acknowledgeMessageId,
                        // If `smallestPresenceStateVersion` is not set then discard ALL steps by
                        // setting to the new version.
                        discardRememberedStepsBeforeVersion:
                            smallestPresenceStateVersion ?? message.newVersion,
                    });

                    // If this was an acknowledgement message from our own client, don't add the
                    // presence state to our map.
                    if (message.clientId !== state.editorState.getClientId()) {
                        setOtherPresenceStateByConnectionId(otherPresenceStateByConnectionId =>
                            message.updateOtherPresenceState.state
                                ? otherPresenceStateByConnectionId.set(
                                      message.updateOtherPresenceState.connectionId,
                                      message.updateOtherPresenceState.state,
                                  )
                                : otherPresenceStateByConnectionId.delete(
                                      message.updateOtherPresenceState.connectionId,
                                  ),
                        );
                    }
                    break;
                }
                case "PersistedContent": {
                    // TODO(calebmer): Show a saving indicator until content has persisted!
                    break;
                }
                case "UpdateOtherPresenceState": {
                    setOtherPresenceStateByConnectionId(otherPresenceStateByConnectionId =>
                        message.state
                            ? otherPresenceStateByConnectionId.set(
                                  message.connectionId,
                                  message.state,
                              )
                            : otherPresenceStateByConnectionId.delete(message.connectionId),
                    );
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
                updateOurPresenceState: {state: state.ourPresenceState.state},
            });

            state.pendingSendableSteps.shouldSendToServerRef.current = false;
            state.ourPresenceState.shouldSendToServerRef.current = false;
        }

        if (state.ourPresenceState.shouldSendToServerRef.current) {
            sendMessage({
                type: "UpdateOurPresenceState",
                state: state.ourPresenceState.state,
            });

            state.ourPresenceState.shouldSendToServerRef.current = false;
        }
    }, [isConnected, sendMessage, state.pendingSendableSteps, state.ourPresenceState]);

    // The presence states we get from our presence channel may be outdated because
    // when the document updates and the cursor needs to move, we do not send a
    // `UpdateOtherPresenceState` update as this would cause a thundering herd of
    // presence updates on every content update.
    //
    // There may be some performance optimizations we could be doing here. If you
    // have 100 cursors but only 1 is moving you only need to recompute that 1.
    const {smallestPresenceStateVersion, presenceStates} = useMemo(() => {
        let smallestPresenceStateVersion = null;

        let presenceStates: Array<DocumentCollaborationPresenceState & {connectionId: Id}> = [];

        for (const [connectionId, _presenceState] of otherPresenceStateByConnectionId) {
            let presenceState = _presenceState;

            // Record the smallest presence state version before mapping the selections
            // forward.
            //
            // We use this to remember steps after this version. And to fetch steps after
            // this version if we haven't seen them.
            if (
                smallestPresenceStateVersion === null ||
                presenceState.version < smallestPresenceStateVersion
            ) {
                smallestPresenceStateVersion = presenceState.version;
            }

            /* ========================================================================== *\
             * 1. Fast-forward outdated presence states if we can, otherwise drop         *
            \* ========================================================================== */

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
            const editorVersion = state.editorState.getVersion();
            if (
                presenceState.version < editorVersion &&
                presenceState.version >= editorVersion - state.rememberedSteps.length
            ) {
                const oldContent =
                    state.rememberedSteps[
                        state.rememberedSteps.length - (editorVersion - presenceState.version)
                    ]!.contentBeforeStep.get();

                let selection: TextSelection | null = new TextSelection(
                    oldContent.resolve(presenceState.textSelection.anchor),
                    oldContent.resolve(presenceState.textSelection.head),
                );

                for (let version = presenceState.version; version < editorVersion; version++) {
                    if (!selection) break;

                    const {step, contentAfterStep} =
                        state.rememberedSteps[
                            state.rememberedSteps.length - (editorVersion - version)
                        ]!;

                    const newSelection = selection.map(contentAfterStep.get(), step.getMap());
                    selection = newSelection instanceof TextSelection ? newSelection : null;
                }

                // If in the process of mapping the selection forward we lost the selection
                // then remove the presence state from our array.
                if (!selection) continue;

                presenceState = {
                    version: editorVersion,
                    textSelection: {
                        anchor: selection.$anchor.pos,
                        head: selection.$head.pos,
                    },
                };
            }

            // Drop any presence states that are not at the current version.
            //
            // There are two kinds of states we expect to discard here:
            //
            // 1. Presence states at a future version. (Should not happen.)
            // 2. Presence states that we couldn't catch because we don't have enough
            //    `rememberedSteps`. We will try to fetch more `rememberedSteps` to
            //    render these.
            if (presenceState.version !== editorVersion) continue;

            presenceStates.push({...presenceState, connectionId});
        }

        /* ========================================================================== *\
         * 2. Apply local, unconfirmed, steps to presence states                      *
        \* ========================================================================== */

        // Other clients do not know about our local, unconfirmed, steps in
        // `sendableSteps()`. So we need to apply those steps to every single presence
        // state.
        const sendableSteps = state.editorState.sendableSteps();
        if (sendableSteps) {
            let version = state.editorState.getVersion();

            for (const origin of sendableSteps.origins) {
                const newPresenceStates: Array<
                    DocumentCollaborationPresenceState & {connectionId: Id}
                > = [];

                for (const presenceState of presenceStates) {
                    const selection = new TextSelection(
                        origin.before.resolve(presenceState.textSelection.anchor),
                        origin.before.resolve(presenceState.textSelection.head),
                    );

                    const newSelection = selection.map(origin.doc, origin.mapping);
                    if (!(selection instanceof TextSelection)) continue;

                    newPresenceStates.push({
                        connectionId: presenceState.connectionId,
                        version: version + origin.steps.length,
                        textSelection: {
                            anchor: newSelection.$anchor.pos,
                            head: newSelection.$head.pos,
                        },
                    });
                }

                presenceStates = newPresenceStates;
                version += origin.steps.length;
            }
        }

        return {smallestPresenceStateVersion, presenceStates};
    }, [otherPresenceStateByConnectionId, state.editorState, state.rememberedSteps]);

    // Transform the presence states of our connected clients into cursor
    // decorations. We drop any cursors from before our document loaded because we
    // don't have the steps to map their positions.
    const phantomTextSelections = useMemo(() => {
        const phantomTextSelections: Array<ContentEditorPhantomTextSelection> = [];

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

            phantomTextSelections.push({
                key: presenceState.connectionId,
                color,
                anchor: presenceState.textSelection.anchor,
                head: presenceState.textSelection.head,
            });
        }

        return phantomTextSelections;
    }, [presenceStates]);

    // If we have a presence state with a version earlier than our last remembered
    // version, then send a network request to load the steps our client is missing
    // so we can render the older presence state.
    const lastRememberedVersion = state.editorState.getVersion() - state.rememberedSteps.length;
    useEffect(() => {
        if (smallestPresenceStateVersion === null) return;
        if (lastRememberedVersion <= smallestPresenceStateVersion) return;

        let isCancelled = false;

        runPromiseWithoutAwaiting(async () => {
            try {
                const {steps} = await getDocumentContentSteps({
                    id: documentId,
                    startVersion: smallestPresenceStateVersion,
                    endVersion: lastRememberedVersion,
                });

                if (isCancelled) return;

                dispatch({
                    type: "AugmentRememberedSteps",
                    startVersion: smallestPresenceStateVersion,
                    steps,
                });
            } catch (error) {
                setErrorState({hasError: true, error});
            }
        });

        return () => {
            isCancelled = true;
        };
        // Important: Be careful about what you put in this dependency array! New
        // dependencies will cause extra network requests which may not be necessary.
    }, [documentId, lastRememberedVersion, smallestPresenceStateVersion, dispatch]);

    return {
        editorState: state.editorState,
        onChangeEditorState: (editorState: ContentEditorState<DocumentContent>) =>
            dispatch({type: "Edit", editorState}),
        phantomTextSelections,
    };
}
