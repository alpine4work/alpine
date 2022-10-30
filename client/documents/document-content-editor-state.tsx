import {TextSelection} from "prosemirror-state";
import {Step} from "prosemirror-transform";
import {ContentEditorState} from "~/client/content/content-editor-state";
import {DocumentContent, isDocumentContent} from "~/shared/documents/document-content-schema";
import {DocumentModel} from "~/shared/documents/document-model";
import {assert} from "~/shared/helpers/control/assert";
import {exhaustive} from "~/shared/helpers/control/exhaustive";
import {isDeepEqual} from "~/shared/helpers/control/is-deep-equal";
import {Lazy} from "~/shared/helpers/control/lazy";
import {Id} from "~/shared/id/id";
import {DocumentEditorPresenceUpdateSchema} from "~/shared/network/documents-network-definition";
import {SchemaType} from "~/shared/schema/schema";

export type State = {
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

export function getInitialState(initialDocument: DocumentModel): State {
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

export type Action =
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

export function reduce(state: State, action: Action): State {
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
