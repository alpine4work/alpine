import {Transaction} from "prosemirror-state";
import {Step} from "prosemirror-transform";
import {
    ContentEditorReferencesAction,
    ContentEditorState,
} from "~/client/content/content_editor_state.js";
import {ContentWithReferences} from "~/shared/content/content_references.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.js";
import {ContentEditorClientId} from "~/shared/id/types/id_types.js";

// NOTE(calebmer, 2023-09-21): This file used to be only for document content.
// But when we introduced task notes collaborative content it was refactored to
// support both document content and task notes content. `ExtraState` and
// `ExtraAction`s came about to maintain state unique to documents.
export type CollaborativeContentEditorState<Content extends ContentWithReferences, ExtraState> = {
    /**
     * We may get `ReceiveSteps` actions out of order (e.g. the server sends an
     * `UpdateContent` message before a backfill response). If we
     * see an action for a future version we put it in this array and re-apply the
     * action when older steps are applied.
     */
    readonly pendingActions: ReadonlyArray<CollaborativeContentEditorReceiveStepsAction<Content>>;

    /**
     * The current state of the editor.
     */
    readonly editorState: ContentEditorState<Content>;

    /**
     * Steps we have sent to the server which we are waiting on
     * acknowledgement for.
     */
    readonly pendingSendableSteps: {
        readonly steps: ReadonlyArray<Step>;
        readonly version: number;
        readonly clientId: ContentEditorClientId;
        readonly origins: ReadonlyArray<Transaction>;
    } | null;

    /**
     * Is there an error from our WebSocket?
     */
    readonly errorState:
        | {readonly hasError: false}
        | {readonly hasError: true; readonly error: unknown};

    /**
     * Extra state a collaborative editor implementation can add.
     */
    readonly extra: ExtraState;
};

export type CollaborativeContentEditorAction<Content extends ContentWithReferences, ExtraAction> =
    | CollaborativeContentEditorEditAction<Content>
    | CollaborativeContentEditorReceiveStepsAction<Content>
    | CollaborativeContentEditorErrorAction
    | CollaborativeContentEditorExtraAction<ExtraAction>;

export type CollaborativeContentEditorEditAction<Content extends ContentWithReferences> = {
    readonly type: "Edit";
    readonly editorState: ContentEditorState<Content>;
};

export type CollaborativeContentEditorReceiveStepsAction<Content extends ContentWithReferences> = {
    readonly type: "ReceiveSteps";
    readonly newVersion: number;
    readonly steps: ReadonlyArray<{readonly step: Step; readonly clientId: ContentEditorClientId}>;
    readonly stepsContentReferences: Content["references"];
};

export type CollaborativeContentEditorErrorAction = {
    readonly type: "Error";
    readonly error: unknown;
};

export type CollaborativeContentEditorExtraAction<ExtraAction> = {
    readonly type: "Extra";
    readonly extra: ExtraAction;
};

export function getInitialCollaborativeContentEditorState<
    Content extends ContentWithReferences,
    ExtraState,
>({
    initialVersion,
    initialContent,
    reduceReferences,
    extra,
}: {
    initialVersion: number;
    initialContent: Content;
    reduceReferences: (
        references: Content["references"],
        action: ContentEditorReferencesAction<Content["references"]>,
    ) => Content["references"];
    extra: ExtraState;
}): CollaborativeContentEditorState<Content, ExtraState> {
    const editorState = ContentEditorState.createCollaborative({
        version: initialVersion,
        content: initialContent,
        reduceReferences,
    });

    return {
        pendingActions: [],
        editorState,
        pendingSendableSteps: null,
        errorState: {hasError: false},
        extra,
    };
}

/**
 * Creates a function for reducing actions against our collaborative content
 * editor state.
 *
 * You must provide a custom action reducer function that's run in addition to
 * our base reducer logic. The custom reducer is required so that we can
 * process `ExtraAction`. The custom reducer sees `ReceiveSteps` actions in the
 * correct order and only sees each step once. Our base reducer will re-order
 * `ReceiveSteps` actions if it receives them out-of-order.
 */
export function createCollaborativeContentEditorStateReducer<
    Content extends ContentWithReferences,
    ExtraState,
    ExtraAction,
>(
    reduce: (
        state: CollaborativeContentEditorState<Content, ExtraState>,
        action: CollaborativeContentEditorAction<Content, ExtraAction>,
    ) => CollaborativeContentEditorState<Content, ExtraState>,
) {
    return (
        state: CollaborativeContentEditorState<Content, ExtraState>,
        actions: ReadonlyArray<CollaborativeContentEditorAction<Content, ExtraAction>>,
    ): CollaborativeContentEditorState<Content, ExtraState> => {
        const oldVersion = state.editorState.getVersion();
        state = actions.reduce(
            (state, action) => actuallyReduceCollaborativeContentEditorState(reduce, state, action),
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
                    pendingSendableSteps: {
                        steps: sendableSteps.steps,
                        version: sendableSteps.version,
                        clientId: sendableSteps.clientId,
                        origins: sendableSteps.origins,
                    },
                };
            }
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

        return pendingActions.reduce(
            (state, action) => actuallyReduceCollaborativeContentEditorState(reduce, state, action),
            state,
        );
    };
}

function actuallyReduceCollaborativeContentEditorState<
    Content extends ContentWithReferences,
    ExtraState,
    ExtraAction,
>(
    reduce: (
        state: CollaborativeContentEditorState<Content, ExtraState>,
        action: CollaborativeContentEditorAction<Content, ExtraAction>,
    ) => CollaborativeContentEditorState<Content, ExtraState>,
    oldState: CollaborativeContentEditorState<Content, ExtraState>,
    action: CollaborativeContentEditorAction<Content, ExtraAction>,
): CollaborativeContentEditorState<Content, ExtraState> {
    switch (action.type) {
        case "Edit": {
            // If an edit was made on top of a version of `editorState` that's different
            // from what's in state that means we may have some data loss!
            //
            // We've observed this happen when React cancels a low priority render in
            // response to a user keyboard event. So we need to wrap `dispatch()` so that
            // it always runs at a high priority.
            assert(
                action.editorState.getVersion() === oldState.editorState.getVersion(),
                "Edit was made on top of an editor state with a different base version than what is actually in our state",
            );

            return reduce(
                {
                    ...oldState,
                    editorState: action.editorState,
                },
                action,
            );
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

            return reduce(
                {
                    ...oldState,
                    editorState,
                    pendingSendableSteps:
                        oldState.pendingSendableSteps &&
                        action.steps.some(({clientId}) => clientId === editorState.getClientId()) &&
                        action.newVersion >= oldState.pendingSendableSteps.version
                            ? null
                            : oldState.pendingSendableSteps,
                },
                // Our custom reducer sees `ReceiveSteps` actions in-order and deduplicated.
                // Unlike our base collaborative reducer implementation which handles
                // out-of-order `ReceiveSteps` actions.
                {
                    type: "ReceiveSteps",
                    newVersion: action.newVersion,
                    steps,
                    stepsContentReferences: action.stepsContentReferences,
                },
            );
        }
        case "Error": {
            return reduce(
                {
                    ...oldState,
                    errorState: {hasError: true, error: action.error},
                },
                action,
            );
        }
        case "Extra": {
            return reduce(oldState, action);
        }
        default:
            throw exhaustive(action);
    }
}
