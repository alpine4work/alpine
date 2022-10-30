import murmurhash from "murmurhash";
import Head from "next/head";
import {TextSelection} from "prosemirror-state";
import {Step} from "prosemirror-transform";
import {useEffect, useMemo, useReducer, useState} from "react";
import {ContentEditor, ContentEditorPhantomTextSelection} from "~/client/content/content-editor";
import {ContentEditorState} from "~/client/content/content-editor-state";
import {sprinkles} from "~/client/design/sprinkles.css";
import {useNetworkChannel} from "~/client/network/use-network-channel";
import {useNetworkPresenceChannel} from "~/client/network/use-network-presence-channel";
import {defaultThemeColor} from "~/shared/design/color-scheme.css";
import {themeColors} from "~/shared/design/theme-colors";
import {DocumentContent, isDocumentContent} from "~/shared/documents/document-content-schema";
import {DocumentModel, getDocumentContentTitle} from "~/shared/documents/document-model";
import {runPromiseWithoutAwaiting} from "~/shared/helpers/async/run-promise-without-awaiting";
import {assert} from "~/shared/helpers/control/assert";
import {exhaustive} from "~/shared/helpers/control/exhaustive";
import {isDeepEqual} from "~/shared/helpers/control/is-deep-equal";
import {Lazy} from "~/shared/helpers/control/lazy";
import {Id} from "~/shared/id/id";
import {
    DocumentChannel,
    DocumentEditorPresenceChannel,
    DocumentEditorPresenceUpdateSchema,
    getDocumentContentSteps,
    updateDocumentContent,
} from "~/shared/network/documents-network-definition";
import {NetworkPresenceChannelStateType} from "~/shared/network/network-presence-channel";
import {SchemaType} from "~/shared/schema/schema";

type State = {
    /**
     * We may get `ReceiveSteps` actions out of order. If we see an action for a
     * future version we put it in this array and re-apply the action when older
     * steps are applied.
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
     * The current text selection to broadcast over presence and the version at
     * which the selection was recorded.
     *
     * We only broadcast a selection update when the user makes a change to keep
     * the number of updates low. Other clients will rebase the selection forward
     * to display it on their editor.
     */
    readonly selectionForPresence: {
        readonly version: number;
        readonly textSelection: TextSelection | null;
    };
    /**
     * Maintain a map of presence states we get from the `ReceiveSteps` action.
     * This will be merged with presence states we get from
     * `DocumentEditorPresenceChannel`. We send some presence states through the
     * `ReceiveSteps` action as an optimization for faster selection updates and to
     * avoid paying Ably double.
     *
     * If null then the presence state should be removed.
     */
    readonly presenceStateByKeyOverride: ReadonlyMap<
        string,
        SchemaType<typeof DocumentEditorPresenceUpdateSchema>["presenceState"]
    >;
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
        selectionForPresence: {
            version: editorState.getVersion(),
            textSelection: null,
        },
        presenceStateByKeyOverride: new Map(),
    };
}

type Action =
    | EditAction
    | ReceiveStepsAction
    | ReconcileSelectionForPresenceAction
    | AugmentRememberedStepsAction;

type EditAction = {
    readonly type: "Edit";
    readonly editorState: ContentEditorState<DocumentContent>;
};

type ReceiveStepsAction = {
    readonly type: "ReceiveSteps";
    readonly newVersion: number;
    readonly steps: ReadonlyArray<{readonly step: Step; readonly clientId: Id}>;
    readonly discardRememberedStepsBeforeVersion: number;
    readonly editorPresenceUpdate: SchemaType<typeof DocumentEditorPresenceUpdateSchema> | null;
};

type ReconcileSelectionForPresenceAction = {
    readonly type: "ReconcileSelectionForPresence";
    readonly editorPresenceUpdate:
        | SchemaType<typeof DocumentEditorPresenceUpdateSchema>["presenceState"]
        | null;
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

function getContentWithoutSendableSteps(
    state: ContentEditorState<DocumentContent>,
): DocumentContent {
    const sendableSteps = state.sendableSteps();

    if (sendableSteps && sendableSteps.origins[0]) {
        const content = sendableSteps.origins[0].before;
        assert(isDocumentContent(content));
        return content;
    }

    return state.getContent();
}

function reduceWithAction(oldState: State, action: Action): State {
    switch (action.type) {
        case "Edit": {
            // Don't send our cursor position while we have local steps! Other
            // clients will not be able to interpret our cursor position without
            // our new steps.
            const selectionForPresence = action.editorState.hasSendableSteps()
                ? oldState.selectionForPresence
                : {
                      version: action.editorState.getVersion(),
                      textSelection: action.editorState.getTextSelection(),
                  };

            return {
                ...oldState,
                editorState: action.editorState,
                selectionForPresence,
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

            let presenceStateByKeyOverride = oldState.presenceStateByKeyOverride;
            if (action.editorPresenceUpdate) {
                presenceStateByKeyOverride = new Map(presenceStateByKeyOverride).set(
                    action.editorPresenceUpdate.presenceStateKey,
                    action.editorPresenceUpdate.presenceState,
                );
            }

            // We may dispatch this action multiple times with the same steps. Remove any
            // steps we've already seen.
            const steps = action.steps.slice(action.steps.length - action.newVersion - oldVersion);
            assert(oldVersion + steps.length === action.newVersion);

            // If we've already seen all the steps, no change is needed.
            if (steps.length === 0)
                return oldState.presenceStateByKeyOverride !== presenceStateByKeyOverride
                    ? {...oldState, presenceStateByKeyOverride}
                    : oldState;

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
                let content = new Lazy(() => getContentWithoutSendableSteps(oldState.editorState));

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
                presenceStateByKeyOverride,
            };
        }
        case "ReconcileSelectionForPresence": {
            // Don't send our cursor position while we have local steps! Other
            // clients will not be able to interpret our cursor position without
            // our new steps.
            if (oldState.editorState.hasSendableSteps()) return oldState;

            const selectionForPresence = {
                version: oldState.editorState.getVersion(),
                textSelection: oldState.editorState.getTextSelection(),
            };

            // If we did not report a selection in `updateDocumentContent()` then we should
            // always send our new selection.
            if (!action.editorPresenceUpdate) return {...oldState, selectionForPresence};

            // Optimization: If the current selection is equal to what we reported in
            // `updateDocumentContent()` then we don't need to update
            // `selectionForPresence` in our state which would cost us an Ably
            // event.
            if (
                action.editorPresenceUpdate.version === selectionForPresence.version &&
                isDeepEqual(
                    action.editorPresenceUpdate.textSelection,
                    selectionForPresence.textSelection
                        ? {
                              anchor: selectionForPresence.textSelection.anchor,
                              head: selectionForPresence.textSelection.head,
                          }
                        : null,
                )
            ) {
                return oldState;
            }

            return {
                ...oldState,
                selectionForPresence,
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
                new Lazy(() => getContentWithoutSendableSteps(oldState.editorState));

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

export function DocumentContentEditor({document}: {document: DocumentModel}) {
    return (
        <DocumentContentEditorStateful
            // If a document prop with a different version is passed in then remount our
            // stateful content editor component.
            key={document.version}
            initialDocument={document}
        />
    );
}

function DocumentContentEditorStateful({initialDocument}: {initialDocument: DocumentModel}) {
    const documentId = initialDocument.id;

    const [isUpdating, setIsUpdating] = useState(false);
    const [state, dispatch] = useReducer(reduce, initialDocument, getInitialState);

    const [errorState, setErrorState] = useState<
        {hasError: false} | {hasError: true; error: unknown}
    >({hasError: false});

    // TODO(calebmer): We probably want some retry mechanism for the user? But
    // until the user retries, we don't want an infinite loop where we keep trying
    // to update the document content.
    if (errorState.hasError) throw errorState.error;

    useEffect(() => {
        // If we're already updating then don't send another update mutation. Once
        // the current mutation is done we'll send another.
        if (isUpdating || errorState.hasError) return;

        // If there are no new sendable steps from this client then don’t send a
        // mutation.
        const sendableSteps = state.editorState.sendableSteps();
        if (!sendableSteps) return;
        const {version, steps, clientId} = sendableSteps;

        runPromiseWithoutAwaiting(async () => {
            setIsUpdating(true);
            try {
                const editorPresenceUpdate = ourPresenceStateKey
                    ? {
                          presenceStateKey: ourPresenceStateKey,
                          presenceState: {
                              version: state.editorState.getVersion(),
                              textSelection: state.editorState.getTextSelection(),
                          },
                      }
                    : undefined;

                const {newVersion, newSteps, conflictingSteps, newEditorPresenceUpdate} =
                    await updateDocumentContent({
                        id: documentId,
                        version,
                        steps,
                        clientId,
                        editorPresenceUpdate,
                    });

                dispatch({
                    type: "ReceiveSteps",
                    newVersion,
                    steps: [...conflictingSteps, ...newSteps.map(step => ({step, clientId}))],
                    // If `smallestPresenceStateVersion` is not set then discard ALL steps by
                    // setting to the new version.
                    discardRememberedStepsBeforeVersion: smallestPresenceStateVersion ?? newVersion,
                    editorPresenceUpdate: null,
                });

                // While we are updating document content, we don't update
                // `state.selectionForPresence`. Now that we are done updating document content
                // let's try updating `state.selectionForPresence`! However, as an optimization
                // we include the selection in the realtime message published from
                // `updateDocumentContent()`. So only publish our current selection if it is
                // different from the one we already published.
                dispatch({
                    type: "ReconcileSelectionForPresence",
                    editorPresenceUpdate: newEditorPresenceUpdate?.presenceState ?? null,
                });
            } catch (error) {
                setErrorState({hasError: true, error});
            } finally {
                setIsUpdating(false);
            }
        });

        // This effect intentionally doesn’t have a dependency array. It shouldn't
        // need one for correctness.
    });

    useNetworkChannel(DocumentChannel, {documentId}, message => {
        dispatch({
            type: "ReceiveSteps",
            newVersion: message.newVersion,
            steps: message.steps.map(step => ({
                step,
                clientId: message.clientId,
            })),
            // If `smallestPresenceStateVersion` is not set then discard ALL steps by
            // setting to the new version.
            discardRememberedStepsBeforeVersion: smallestPresenceStateVersion ?? message.newVersion,
            editorPresenceUpdate: message.editorPresenceUpdate,
        });
    });

    // TODO(calebmer): The pricing limits on presence from Ably are...not great. We
    // probably need to migrate presence to Cloudflare Workers eventually.
    // https://faqs.ably.com/why-do-you-have-a-limit-on-the-number-of-members-present-on-a-channel
    const {ourPresenceStateKey, presenceStates: presenceStatesFromPresenceChannel} =
        useNetworkPresenceChannel(
            DocumentEditorPresenceChannel,
            {documentId},
            state.selectionForPresence.textSelection
                ? {
                      version: state.selectionForPresence.version,
                      textSelection: {
                          anchor: state.selectionForPresence.textSelection.$anchor.pos,
                          head: state.selectionForPresence.textSelection.$head.pos,
                      },
                  }
                : null,
        );

    // The presence states we get from our presence channel may be outdated in a
    // couple of ways:
    //
    // 1. We send some presence updates over `DocumentChannel` instead of
    //    `DocumentEditorPresenceChannel` for performance.
    // 2. When the document updates and the cursor needs to move, we do not send an
    //    update to `DocumentEditorPresenceChannel` as this would cause a
    //    thundering herd of presence updates.
    // 3. Theoretically possible but not supported as of 2022-10-28: We get a
    //    selection at a future version than what's in this editor. Keep an eye out
    //    for this happening in practice! We'll need to add support if it happens.
    //
    // There may be some performance optimizations we could be doing here. If you
    // have 100 cursors but only 1 is moving you only need to recompute that 1.
    const {smallestPresenceStateVersion, presenceStates} = useMemo(() => {
        let smallestPresenceStateVersion = null;

        let presenceStates: Array<
            NetworkPresenceChannelStateType<typeof DocumentEditorPresenceChannel> & {
                readonly key: string;
            }
        > = [];

        for (let presenceState of presenceStatesFromPresenceChannel) {
            /* ========================================================================== *\
             * 1. Apply presence state overrides                                          *
            \* ========================================================================== */

            // For performance, we send selection updates that happen at the same time
            // as content updates over the "update content" realtime message and we DO NOT
            // send an update over the presence channel.
            //
            // Then here in client code we merge presence state updates from the realtime
            // message with presence state from our presence channel.
            const presenceStateOverride = state.presenceStateByKeyOverride.get(presenceState.key);
            if (presenceStateOverride && presenceStateOverride.version > presenceState.version) {
                // If the override has no text selection, then this override acts as if the
                // presence state left the channel.
                if (!presenceStateOverride.textSelection) continue;

                presenceState = {
                    key: presenceState.key,
                    version: presenceStateOverride.version,
                    textSelection: presenceStateOverride.textSelection,
                };
            }

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
             * 2. Fast-forward outdated presence states if we can, otherwise drop         *
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
                    key: presenceState.key,
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
            // 1. Presence states at a future version.
            // 2. Presence states that we couldn't catch because we don't have enough
            //    `rememberedSteps`. We will try to fetch more `rememberedSteps` to
            //    render these.
            //
            // TODO(calebmer): If we have a race condition and a client has reported that
            // they are at a future version we ignore those cursors right now. Is that
            // correct?
            if (presenceState.version !== editorVersion) continue;

            presenceStates.push(presenceState);
        }

        /* ========================================================================== *\
         * 3. Apply local, unconfirmed, steps to presence states                      *
        \* ========================================================================== */

        // Other clients do not know about our local, unconfirmed, steps in
        // `sendableSteps()`. So we need to apply those steps to every single presence
        // state.
        const sendableSteps = state.editorState.sendableSteps();
        if (sendableSteps) {
            let version = state.editorState.getVersion();

            for (const origin of sendableSteps.origins) {
                const newPresenceStates: Array<
                    NetworkPresenceChannelStateType<typeof DocumentEditorPresenceChannel> & {
                        readonly key: string;
                    }
                > = [];

                for (const presenceState of presenceStates) {
                    const selection = new TextSelection(
                        origin.before.resolve(presenceState.textSelection.anchor),
                        origin.before.resolve(presenceState.textSelection.head),
                    );

                    const newSelection = selection.map(origin.doc, origin.mapping);
                    if (!(selection instanceof TextSelection)) continue;

                    newPresenceStates.push({
                        key: presenceState.key,
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
    }, [
        presenceStatesFromPresenceChannel,
        state.editorState,
        state.presenceStateByKeyOverride,
        state.rememberedSteps,
    ]);

    // Transform the presence states of our connected clients into cursor
    // decorations. We drop any cursors from before our document loaded because we
    // don't have the steps to map their positions.
    //
    // TODO(calebmer): Load older steps from the backend so we can map cursors at
    // older positions.
    const phantomTextSelections = useMemo(() => {
        const phantomTextSelections: Array<ContentEditorPhantomTextSelection> = [];

        const filteredThemeColors = themeColors.filter(
            // TODO(calebmer): When the theme color is configurable, we should use that
            // instead of the default theme color.
            themeColor => themeColor !== defaultThemeColor && themeColor !== "yellow",
        );

        for (const presenceState of presenceStates) {
            const color =
                filteredThemeColors[murmurhash.v3(presenceState.key) % filteredThemeColors.length]!;

            phantomTextSelections.push({
                key: presenceState.key,
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
    }, [documentId, lastRememberedVersion, smallestPresenceStateVersion]);

    return (
        <>
            <Head>
                <title>{getDocumentContentTitle(state.editorState.getContent())}</title>
            </Head>
            <ContentEditor
                state={state.editorState}
                onChange={editorState => dispatch({type: "Edit", editorState})}
                aria-label="Document editor"
                placeholder="Share your ideas…"
                className={sprinkles({paddingBottom: "24"})}
                phantomTextSelections={phantomTextSelections}
            />
        </>
    );
}
