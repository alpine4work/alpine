import {Selection} from "prosemirror-state";
import {Step, StepMap} from "prosemirror-transform";
import {
    CollaborativeContentEditorAction,
    CollaborativeContentEditorState,
    createCollaborativeContentEditorStateReducer,
    getInitialCollaborativeContentEditorState,
} from "~/client/content/collaborative_content_editor_state.js";
import {
    ContentEditorReferencesAction,
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
import {DocumentCommentThreadId, WebSocketConnectionId} from "~/shared/id/types/id_types.js";
import {
    MessageContent,
    MessageContentWithReferences,
} from "~/shared/messaging/message_content_schema.js";

export type DocumentContentEditorState = CollaborativeContentEditorState<
    DocumentContentWithReferences,
    DocumentContentEditorExtraState
>;

type DocumentContentEditorExtraState = {
    /**
     * Comment threads we have sent to the server that we're waiting on
     * acknowledgement for.
     *
     * Should be non-null when `pendingSendableSteps` is non-null.
     */
    readonly pendingCreateCommentThreads: ReadonlyArray<{
        readonly commentThreadId: DocumentCommentThreadId;
        readonly initialCommentContent: MessageContent;
    }> | null;

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
};

export function getInitialDocumentContentEditorState(
    initialDocument: DocumentModel,
): DocumentContentEditorState {
    return getInitialCollaborativeContentEditorState({
        initialVersion: initialDocument.version,
        initialContent: initialDocument.content,
        reduceReferences: reduceDocumentContentReferences,
        extra: {
            pendingCreateCommentThreads: null,
            rememberedSteps: [],
            ourPresenceState: null,
            otherPresenceStateByConnectionId: ImmutableMap.empty(),
        },
    });
}

export type DocumentContentEditorAction = CollaborativeContentEditorAction<
    DocumentContentWithReferences,
    DocumentContentEditorExtraAction
>;

type DocumentContentEditorExtraAction =
    | DocumentContentEditorAugmentRememberedStepsAction
    | DocumentContentEditorSetAllOtherPresenceStatesAction
    | DocumentContentEditorUpdateOtherPresenceStateAction
    | DocumentContentEditorUpdateCommentThreadAction;

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
    const oldPendingSendableSteps = state.pendingSendableSteps;
    const oldRememberedSteps = state.extra.rememberedSteps;
    const oldOtherPresenceStateByConnectionId = state.extra.otherPresenceStateByConnectionId;

    state = baseReduceDocumentContentEditorState(state, actions);

    // If `pendingSendableSteps` changed then there's some extra state we need
    // to update...
    if (oldPendingSendableSteps !== state.pendingSendableSteps) {
        if (!state.pendingSendableSteps) {
            state = {
                ...state,
                extra: {
                    ...state.extra,
                    pendingCreateCommentThreads: null,
                },
            };
        } else {
            // We can have multiple steps from the same origin transaction. So uniquify our
            // new comment thread objects.
            const createCommentThreads = Array.from(
                new Set(
                    filterMapIterable(state.pendingSendableSteps.origins, transaction => {
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
                extra: {
                    ...state.extra,
                    pendingCreateCommentThreads: createCommentThreads,
                    // Make sure our presence state is up-to-date as well since we will send it to
                    // the server along with our sendable steps.
                    ourPresenceState: {
                        version: state.editorState.getVersion(),
                        selection: state.editorState.getSelection(),
                    },
                },
            };
        }
    }

    // If `rememberedSteps` or `otherPresenceStateByConnectionId` changed, then
    // discard any `rememberedSteps` we don't need anymore for rebasing
    // presence state selections.
    if (
        state.extra.rememberedSteps !== oldRememberedSteps ||
        state.extra.otherPresenceStateByConnectionId !== oldOtherPresenceStateByConnectionId
    ) {
        let discardRememberedStepsBeforeVersion = state.editorState.getVersion();

        for (const presenceState of state.extra.otherPresenceStateByConnectionId.values()) {
            if (presenceState.version < discardRememberedStepsBeforeVersion)
                discardRememberedStepsBeforeVersion = presenceState.version;
        }

        const newRememberedSteps = state.extra.rememberedSteps.slice(
            state.extra.rememberedSteps.length -
                (state.editorState.getVersion() - discardRememberedStepsBeforeVersion),
        );

        state = {...state, extra: {...state.extra, rememberedSteps: newRememberedSteps}};
    }

    return state;
}

const baseReduceDocumentContentEditorState = createCollaborativeContentEditorStateReducer<
    DocumentContentWithReferences,
    DocumentContentEditorExtraState,
    DocumentContentEditorExtraAction
>((state, action, oldState) => {
    if (action.type === "Edit") {
        // Don't update our `presenceState` when there are steps we are sending to the
        // server. Other clients would not know how to interpret our state until they
        // see our steps.
        if (state.pendingSendableSteps) {
            return state;
        }

        return {
            ...state,
            extra: {
                ...state.extra,
                ourPresenceState: {
                    version: action.editorState.getVersion(),
                    selection: action.editorState.getSelection(),
                },
            },
        };
    }

    if (action.type === "ReceiveSteps") {
        // While the base reducer may receive `ReceiveSteps` actions out-of-order, it
        // should call our custom reducer with `ReceiveSteps` actions in-order.
        assert(action.newVersion === state.editorState.getVersion());

        // Whenever we receive steps, we add them to our `rememberedSteps` array.
        // We discard steps when we don't need them to rebase presence states.
        let content = new Lazy(() => oldState.editorState.getDocWithoutSendableSteps());

        const newRememberedSteps = action.steps.map(({step}) => {
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

        const rememberedSteps = [...state.extra.rememberedSteps, ...newRememberedSteps];

        return {
            ...state,
            extra: {
                ...state.extra,
                rememberedSteps,
            },
        };
    }

    if (action.type === "Error") return state;

    switch (action.extra.type) {
        // If we are missing some remembered steps for fast-forwarding presence states
        // then we have an effect which fetches those steps from the server. This
        // action integrates the old steps into our state.
        case "AugmentRememberedSteps": {
            assert(
                action.extra.expectedVersion === state.editorState?.getVersion(),
                "Failed to augment remembered steps because editor version does not match expected version",
            );

            // Drop steps we're trying to remember that we already have.
            const rememberInvertedSteps = action.extra.invertedSteps.slice(
                0,
                state.editorState.getVersion() -
                    state.extra.rememberedSteps.length -
                    action.extra.startVersion,
            );
            if (rememberInvertedSteps.length === 0) return state;

            const oldEditorState = state.editorState;
            let content =
                state.extra.rememberedSteps[state.extra.rememberedSteps.length - 1]
                    ?.contentBeforeStep ??
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
                ...state,
                extra: {
                    ...state.extra,
                    rememberedSteps: [...newRememberedSteps, ...state.extra.rememberedSteps],
                },
            };
        }
        case "SetAllOtherPresenceStates": {
            return {
                ...state,
                extra: {
                    ...state.extra,
                    otherPresenceStateByConnectionId: action.extra.stateByConnectionId,
                },
            };
        }
        case "UpdateOtherPresenceState": {
            return {
                ...state,
                extra: {
                    ...state.extra,
                    otherPresenceStateByConnectionId: action.extra.state
                        ? state.extra.otherPresenceStateByConnectionId.set(
                              action.extra.connectionId,
                              action.extra.state,
                          )
                        : state.extra.otherPresenceStateByConnectionId.delete(
                              action.extra.connectionId,
                          ),
                },
            };
        }
        case "UpdateCommentThread": {
            return {
                ...state,
                editorState: state.editorState.updateReferences({
                    type: "UpdateDocumentCommentThread",
                    commentThreadId: action.extra.commentThreadId,
                    commentCount: action.extra.commentCount,
                    addCommentAuthor: action.extra.addCommentAuthor,
                }),
            };
        }
        default:
            throw exhaustive(action.extra);
    }
});

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
