import {Selection, SelectionBookmark} from "prosemirror-state";
import {Step, StepMap} from "prosemirror-transform";
import {
    CollaborativeContentEditorAction,
    CollaborativeContentEditorState,
    createCollaborativeContentEditorStateReducer,
    getInitialCollaborativeContentEditorState,
} from "~/client/web/content/collaborative_content_editor_state.js";
import {
    ContentEditorReferencesAction,
    createContentCommentThreadMetaKey,
    intentionallyUpdateContentAccessPolicyMetaKey,
    reduceContentReferencesShared,
} from "~/client/web/content/state/content_editor_state.js";
import {AccessLevel, LocalAccessPolicy, hasAccessLevel} from "~/shared/access/access_policy.js";
import {AccessPolicyModel} from "~/shared/access/model/access_policy_model.js";
import {ShareNotification} from "~/shared/access/share_notification.js";
import {
    MessageContent,
    MessageContentWithReferences,
} from "~/shared/content/message_content_schema.js";
import {DocumentCollaborationPresenceState} from "~/shared/documents/document_collaboration_protocol.js";
import {
    DocumentContentReferences,
    DocumentContentWithReferences,
    emptyDocumentContentReferences,
    mergeDocumentContentReferences,
} from "~/shared/documents/document_content_references.js";
import {
    DocumentContent,
    createEmptyDocumentContent,
    isDocumentContent,
} from "~/shared/documents/document_content_schema.js";
import {FileEntityId} from "~/shared/files/file_entity_id.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.js";
import {Lazy} from "~/shared/helpers/control/lazy.js";
import {ImmutableMap} from "~/shared/helpers/immutable/immutable_map.js";
import {TimeZone} from "~/shared/helpers/intl/time_zone.js";
import {filterIterable} from "~/shared/helpers/iterable/filter_iterable.js";
import {filterMapIterable} from "~/shared/helpers/iterable/filter_map_iterable.js";
import {
    AccountId,
    DocumentCommentThreadId,
    FileId,
    SpaceId,
    WebSocketConnectionId,
} from "~/shared/id/types/id_types.js";
import {AccountModel} from "~/shared/spaces/account_model.js";

export type DocumentContentEditorState = CollaborativeContentEditorState<
    DocumentContentWithReferences,
    DocumentContentEditorExtraState
>;

type DocumentContentEditorExtraState = {
    /**
     * The `AccountId` of the `currentAccount` in `SpaceContext`. Used for evaluating
     * access. Null if there's no user logged in.
     */
    readonly currentAccountId: AccountId | null;

    /**
     * The current account's effective access level on this document. Snapshot at the
     * time the editor state was constructed (or rebuilt) — this reducer must stay
     * side-effect free, so we don't read `siteRegistry` from inside it. Whenever the
     * actor's access changes the parent (`use_document_content_editor_web_socket.tsx`)
     * spins up a new `DocumentContentEditorWebSocketClient` with a fresh
     * `initialState`, which is the moment to refresh this value.
     */
    readonly accessLevel: AccessLevel;

    /**
     * Comment threads we have sent to the server that we're waiting on acknowledgement
     * for.
     *
     * Should be non-null when `pendingSendableSteps` is non-null.
     */
    readonly pendingCreateCommentThreads: ReadonlyArray<{
        readonly commentThreadId: DocumentCommentThreadId;
        readonly initialCommentContent: MessageContent;
        readonly initialCommentFileIds: ReadonlyArray<FileId | FileEntityId>;
        readonly createdTimeZone: TimeZone;
    }> | null;

    /**
     * When we update an access policy we need to send an
     * `intentionallyUpdateAccessPolicy` property to the server so the server knows the
     * access policy change isn't ProseMirror accidentally changing a document
     * attribute.
     */
    readonly pendingIntentionallyUpdateAccessPolicy: {
        readonly accessPolicy: LocalAccessPolicy;
        readonly notification: ShareNotification | null;
    } | null;

    /**
     * Remember some number of steps in our state to map phantom selections from
     * presence when they have an old version.
     *
     * The version of the document in the first remembered step's `contentBeforeStep`
     * is `editorState.getVersion() - rememberedSteps.length`.
     */
    readonly rememberedSteps: ReadonlyArray<{
        readonly stepMap: StepMap;
        readonly contentBeforeStep: Lazy<DocumentContent>;
        readonly contentAfterStep: Lazy<DocumentContent>;
    }>;

    /**
     * The current text selection to broadcast over presence and the version at which
     * the selection was recorded.
     *
     * We only broadcast a selection update when the user makes a change to keep the
     * number of updates low. Other clients will rebase the selection forward to
     * display it on their editor.
     */
    readonly ourPresenceState: {
        readonly version: number;
        readonly selection: Selection;
    } | null;

    /**
     * The presence state of other selected clients.
     *
     * An `ImmutableMap` since we update pretty frequently so we want fast immutable
     * map update performance.
     */
    readonly otherPresenceStateByConnectionId: ImmutableMap<
        WebSocketConnectionId,
        DocumentCollaborationPresenceState
    >;

    /**
     * If we are notified a comment thread was resolved/unresolved by
     * `UpdateContentWithoutPersistence` then we want to optimistically update our UI
     * so it matches the document which will have marks removed/added. But then once
     * content has finished persisting we'll receive a `PersistedContent` event with
     * new comment thread objects which are the source of truth.
     *
     * This map will override whatever is in comment thread objects while we have
     * unpersisted resolution state changes.
     */
    readonly unpersistedResolutionStateByCommentThreadId: ReadonlyMap<
        DocumentCommentThreadId,
        {readonly isResolved: boolean; readonly version: number}
    >;
};

export function getInitialDocumentContentEditorState(
    options: {
        spaceId: SpaceId;
        accessLevel: AccessLevel;
    } & (
        | {
              currentAccountId: AccountId | null;
              initialVersion: number;
              initialContent: DocumentContentWithReferences;
              initialSelection?: Selection | SelectionBookmark;
          }
        | {
              currentAccountId: AccountId;
              initialVersion?: undefined;
              initialContent?: undefined;
              initialSelection?: undefined;
          }
    ),
): DocumentContentEditorState {
    return getInitialCollaborativeContentEditorState({
        spaceId: options.spaceId,
        initialVersion: options.initialVersion ?? 0,
        initialContent: options.initialContent ?? {
            doc: createEmptyDocumentContent(options.currentAccountId),
            references: emptyDocumentContentReferences,
        },
        initialSelection: options.initialSelection,
        reduceReferences: reduceDocumentContentReferences,
        extra: {
            currentAccountId: options.currentAccountId,
            accessLevel: options.accessLevel,
            pendingCreateCommentThreads: null,
            pendingIntentionallyUpdateAccessPolicy: null,
            rememberedSteps: [],
            ourPresenceState: null,
            otherPresenceStateByConnectionId: ImmutableMap.empty(),
            unpersistedResolutionStateByCommentThreadId: new Map(),
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
    | DocumentContentEditorClearOurPresenceStateAction
    | DocumentContentEditorUnclearOurPresenceStateAction
    | DocumentContentEditorUpdateCommentThreadReferenceAction
    | DocumentContentEditorUpdateCommentThreadResolutionStatesAction
    | DocumentContentEditorResetToPersistedVersionAction;

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

type DocumentContentEditorClearOurPresenceStateAction = {
    readonly type: "ClearOurPresenceState";
};

type DocumentContentEditorUnclearOurPresenceStateAction = {
    readonly type: "UnclearOurPresenceState";
};

type DocumentContentEditorUpdateCommentThreadReferenceAction = {
    readonly type: "UpdateCommentThreadReference";
    readonly commentThreadId: DocumentCommentThreadId;
    readonly commentCount: number;
    readonly addCommentAuthor: AccountModel | null;
};

type DocumentContentEditorUpdateCommentThreadResolutionStatesAction = {
    readonly type: "UpdateCommentThreadResolutionStates";
    readonly newVersion: number;
    readonly resolveCommentThreadIds: ReadonlyArray<DocumentCommentThreadId>;
    readonly unresolveCommentThreadIds: ReadonlyArray<DocumentCommentThreadId>;
};

type DocumentContentEditorResetToPersistedVersionAction = {
    readonly type: "ResetToPersistedVersion";
};

export function reduceDocumentContentEditorState(
    state: DocumentContentEditorState,
    actions: ReadonlyArray<DocumentContentEditorAction>,
): DocumentContentEditorState {
    const oldState = state;

    state = baseReduceDocumentContentEditorState(state, actions);

    // If `pendingSendableSteps` changed then there's some extra state we need to
    // update...
    if (oldState.pendingSendableSteps !== state.pendingSendableSteps) {
        if (!state.pendingSendableSteps) {
            state = {
                ...state,
                extra: {
                    ...state.extra,
                    pendingCreateCommentThreads: null,
                    pendingIntentionallyUpdateAccessPolicy: null,
                },
            };
        } else {
            let isLastTransactionIntentionallyUpdatingAccessPolicy = false;
            let lastIntentionallyUpdateAccessPolicy: {
                accessPolicy: AccessPolicyModel;
                notification: ShareNotification | null;
            } | null = null;

            // We can have multiple steps from the same origin transaction. So uniquify our new
            // comment thread objects.
            const transactions = new Set(state.pendingSendableSteps.origins);

            const createCommentThreads = Array.from(
                filterMapIterable(transactions, transaction => {
                    const createCommentThread: {
                        commentThreadId: DocumentCommentThreadId;
                        initialCommentContent: MessageContentWithReferences;
                        initialCommentFileIds: ReadonlyArray<FileId | FileEntityId>;
                        createdTimeZone: TimeZone;
                    } | null = transaction.getMeta(createContentCommentThreadMetaKey) ?? null;

                    const intentionallyUpdateAccessPolicy: {
                        accessPolicy: AccessPolicyModel;
                        notification: ShareNotification | null;
                    } | null =
                        transaction.getMeta(intentionallyUpdateContentAccessPolicyMetaKey) ?? null;

                    if (intentionallyUpdateAccessPolicy !== null) {
                        isLastTransactionIntentionallyUpdatingAccessPolicy = true;
                        lastIntentionallyUpdateAccessPolicy = intentionallyUpdateAccessPolicy;
                    } else {
                        isLastTransactionIntentionallyUpdatingAccessPolicy = false;
                    }

                    if (!createCommentThread) return;

                    return {
                        commentThreadId: createCommentThread.commentThreadId,
                        initialCommentContent: createCommentThread.initialCommentContent.doc,
                        initialCommentFileIds: createCommentThread.initialCommentFileIds,
                        createdTimeZone: createCommentThread.createdTimeZone,
                    };
                }),
            );

            state = {
                ...state,
                extra: {
                    ...state.extra,
                    pendingCreateCommentThreads: createCommentThreads,
                    pendingIntentionallyUpdateAccessPolicy: lastIntentionallyUpdateAccessPolicy,
                    // Make sure our presence state is up-to-date as well since we will send it to the
                    // server along with our sendable steps.
                    //
                    // If we're updating the access policy in this action and the old presence state is
                    // null then don't set a new presence state which'll flash our cursor at the start
                    // of the document.
                    ourPresenceState:
                        isLastTransactionIntentionallyUpdatingAccessPolicy &&
                        oldState.extra.ourPresenceState === null
                            ? null
                            : {
                                  version: state.editorState.getVersion(),
                                  selection: state.editorState.getSelection(),
                              },
                },
            };
        }
    }

    // If `persistedVersion`, `rememberedSteps`, or `otherPresenceStateByConnectionId`
    // changed, then discard any `rememberedSteps` we don't need anymore for rebasing
    // presence state selections.
    if (
        state.persistedVersion !== oldState.persistedVersion ||
        state.extra.rememberedSteps !== oldState.extra.rememberedSteps ||
        state.extra.otherPresenceStateByConnectionId !==
            oldState.extra.otherPresenceStateByConnectionId
    ) {
        let discardRememberedStepsBeforeVersion = state.editorState.getVersion();

        // We remember steps between the persisted version and the `editorState`'s
        // confirmed version so we can implement the `ResetToPersistedVersion` action
        // properly. If we see that action then we look up the old document from
        // `rememberedSteps`.
        if (state.persistedVersion < discardRememberedStepsBeforeVersion)
            discardRememberedStepsBeforeVersion = state.persistedVersion;

        // We remember steps between the current version and the version for any of our
        // presence states so that we can map the presence state position from the version
        // where it was created to the latest document version.
        for (const presenceState of state.extra.otherPresenceStateByConnectionId.values()) {
            if (presenceState.version < discardRememberedStepsBeforeVersion)
                discardRememberedStepsBeforeVersion = presenceState.version;
        }

        const discardRememberedStepsBeforeIndex =
            state.extra.rememberedSteps.length -
            (state.editorState.getVersion() - discardRememberedStepsBeforeVersion);

        // Noop if 0 or negative. If negative that means
        // `discardRememberedStepsBeforeVersion` was less than the last remembered version
        // (`state.editorState.getVersion() - state.extra.rememberedSteps.length`). In that
        // case we shouldn't discard any steps.
        if (discardRememberedStepsBeforeIndex > 0) {
            state = {
                ...state,
                extra: {
                    ...state.extra,
                    rememberedSteps: state.extra.rememberedSteps.slice(
                        discardRememberedStepsBeforeIndex,
                    ),
                },
            };
        }
    }

    // We don't allow `state.extra.ourPresenceState.selection` to be empty if the user
    // doesn't have edit access. This is tied to how `<ContentEditor>` is rendered in
    // read-only mode. In read-only mode the browser selection renders when you've
    // selected a range of text but doesn't render the cursor in positions. Even though
    // ProseMirror computes single position selections when the user clicks in a
    // read-only `<ContentEditor>`.
    if (
        oldState.extra.ourPresenceState !== state.extra.ourPresenceState ||
        oldState.editorState !== state.editorState ||
        oldState.extra.accessLevel !== state.extra.accessLevel
    ) {
        if (
            state.extra.ourPresenceState?.selection.empty &&
            !hasAccessLevel(state.extra.accessLevel, "Edit")
        ) {
            state = {...state, extra: {...state.extra, ourPresenceState: null}};
        }
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
        // server. Other clients would not know how to interpret our state until they see
        // our steps.
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

        // Whenever we receive steps, we add them to our `rememberedSteps` array. We
        // discard steps when we don't need them to rebase presence states.
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

    if (action.type === "Persisted") {
        // Clean out unpersisted resolution states when we get a persisted content action.
        const unpersistedResolutionStateByCommentThreadId = new Map(
            filterIterable(
                state.extra.unpersistedResolutionStateByCommentThreadId,
                ([, resolutionState]) => resolutionState.version > action.newVersion,
            ),
        );

        return {
            ...state,
            extra: {...state.extra, unpersistedResolutionStateByCommentThreadId},
        };
    }

    if (action.type === "Error") return state;

    switch (action.extra.type) {
        // If we are missing some remembered steps for fast-forwarding presence states then
        // we have an effect which fetches those steps from the server. This action
        // integrates the old steps into our state.
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
        case "ClearOurPresenceState": {
            if (state.extra.ourPresenceState === null) return state;

            return {
                ...state,
                extra: {
                    ...state.extra,
                    ourPresenceState: null,
                },
            };
        }
        case "UnclearOurPresenceState": {
            if (state.extra.ourPresenceState !== null) return state;

            return {
                ...state,
                extra: {
                    ...state.extra,
                    ourPresenceState: {
                        version: state.editorState.getVersion(),
                        selection: state.editorState.getSelection(),
                    },
                },
            };
        }
        case "UpdateCommentThreadReference": {
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
        case "UpdateCommentThreadResolutionStates": {
            // Ignore action if our persisted version is past this action's version.
            if (action.extra.newVersion <= oldState.persistedVersion) {
                return state;
            }

            if (
                action.extra.resolveCommentThreadIds.length === 0 &&
                action.extra.unresolveCommentThreadIds.length === 0
            ) {
                return state;
            }

            const unpersistedResolutionStateByCommentThreadId = new Map(
                state.extra.unpersistedResolutionStateByCommentThreadId,
            );

            for (const commentThreadId of action.extra.resolveCommentThreadIds) {
                const oldResolutionState =
                    unpersistedResolutionStateByCommentThreadId.get(commentThreadId);

                if (!oldResolutionState || action.extra.newVersion >= oldResolutionState.version) {
                    unpersistedResolutionStateByCommentThreadId.set(commentThreadId, {
                        isResolved: true,
                        version: action.extra.newVersion,
                    });
                }
            }

            for (const commentThreadId of action.extra.unresolveCommentThreadIds) {
                const oldResolutionState =
                    unpersistedResolutionStateByCommentThreadId.get(commentThreadId);

                if (!oldResolutionState || action.extra.newVersion >= oldResolutionState.version) {
                    unpersistedResolutionStateByCommentThreadId.set(commentThreadId, {
                        isResolved: false,
                        version: action.extra.newVersion,
                    });
                }
            }

            return {
                ...state,
                extra: {
                    ...state.extra,
                    unpersistedResolutionStateByCommentThreadId,
                },
            };
        }
        case "ResetToPersistedVersion": {
            return getInitialDocumentContentEditorState({
                spaceId: state.spaceId,
                currentAccountId: state.extra.currentAccountId,
                accessLevel: state.extra.accessLevel,
                initialVersion: state.persistedVersion,
                initialContent: {
                    doc: getDocumentContentEditorStatePersistedContent(state),
                    references: state.editorState.getContent().references,
                },
                // Try to maintain the user's selection while resetting state.
                initialSelection: state.editorState.getSelection().getBookmark(),
            });
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
        // This action should be idempotent and runnable out-of-order. We don't have strong
        // comment thread correctness guarantees but it should converge to a correct value
        // as you use the product.
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
            return reduceContentReferencesShared(references, action);
    }
}

/**
 * Get the persisted `DocumentContent` based on our editor state. The persisted
 * content lags behind the content in our editor state since the editor state may
 * include local changes and may include optimistic changes that have been accepted
 * by the durable object but not our database.
 */
export function getDocumentContentEditorStatePersistedContent(
    state: DocumentContentEditorState,
): DocumentContent {
    const version = state.editorState.getVersion();

    // If we're at the persisted version then return the doc as-is. If `version` is
    // less than `state.persistedVersion` then we've probably received some realtime
    // events out-of-order. We may still be waiting on the steps from persisted content
    // from realtime. Don't throw while we're in this state.
    if (version <= state.persistedVersion) {
        return state.editorState.getDocWithoutSendableSteps();
    }

    const oldContent =
        state.extra.rememberedSteps[
            state.extra.rememberedSteps.length - (version - state.persistedVersion)
        ]!.contentBeforeStep.get();

    return oldContent;
}
