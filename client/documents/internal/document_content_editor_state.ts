import {Selection} from "prosemirror-state";
import {Step, StepMap} from "prosemirror-transform";
import {
    ContentEditorReferencesAction,
    ContentEditorState,
    createCommentThreadMetaKey,
} from "~/client/content/content_editor_state.js";
import {AccountModel} from "~/shared/accounts/account_model.js";
import {DocumentCollaborationPresenceState} from "~/shared/documents/document_collaboration_protocol.js";
import {
    DocumentContentReferences,
    DocumentContentWithReferences,
    mergeDocumentContentReferences,
} from "~/shared/documents/document_content_references.js";
import {DocumentContent, isDocumentContent} from "~/shared/documents/document_content_schema.js";
import {DocumentModel} from "~/shared/documents/document_model.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.js";
import {Lazy} from "~/shared/helpers/control/lazy.js";
import {ImmutableMap} from "~/shared/helpers/immutable/immutable_map.js";
import {filterMapIterable} from "~/shared/helpers/iterable/filter_map_iterable.js";
import {
    ContentEditorClientId,
    DocumentCommentThreadId,
    WebSocketConnectionId,
} from "~/shared/id/types/id_types.js";
import {
    MessageContent,
    MessageContentWithReferences,
} from "~/shared/messaging/message_content_schema.js";

export type DocumentContentEditorState = {
    /**
     * We may get `ReceiveSteps` actions out of order (e.g. the server sends an
     * `UpdateContent` message before a backfill response). If we
     * see an action for a future version we put it in this array and re-apply the
     * action when older steps are applied.
     */
    readonly pendingActions: ReadonlyArray<DocumentContentEditorReceiveStepsAction>;

    /**
     * The current state of the editor.
     */
    readonly editorState: ContentEditorState<DocumentContentWithReferences>;

    /**
     * Remember some number of steps in our state to map phantom selections from
     * presence when they have an old version.
     *
     * The version of the document in the first remembered step's
     * `contentBeforeStep` is `editorState.getVersion() - rememberedSteps.length`.
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
                    filterMapIterable(sendableSteps.origins, transaction => {
                        const createCommentThread: {
                            commentThreadId: DocumentCommentThreadId;
                            initialCommentContent: MessageContentWithReferences;
                        } | null = transaction.getMeta(createCommentThreadMetaKey) ?? null;

                        if (!createCommentThread) return null;

                        return {
                            commentThreadId: createCommentThread.commentThreadId,
                            initialCommentContent: createCommentThread.initialCommentContent.doc,
                        };
                    }),
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
