import {Selection, SelectionBookmark} from "prosemirror-state";
import {
    CollaborativeContentEditorAction,
    CollaborativeContentEditorState,
    createCollaborativeContentEditorStateReducer,
    getCollaborativeContentEditorStatePersistedContent,
    getInitialCollaborativeContentEditorState,
} from "~/client/web/content/collaborative_content_editor_state.js";
import {reduceContentReferences} from "~/client/web/content/state/content_editor_state.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.js";
import {Lazy} from "~/shared/helpers/control/lazy.js";
import {SpaceId, TaskId} from "~/shared/id/types/id_types.js";
import {
    TaskNotesContent,
    TaskNotesContentWithReferences,
    isTaskNotesContent,
} from "~/shared/tasks/task_notes_content_schema.js";

export type TaskNotesContentEditorState = CollaborativeContentEditorState<
    TaskNotesContentWithReferences,
    TaskNotesContentEditorExtraState
>;

type TaskNotesContentEditorExtraState = {
    readonly taskId: TaskId;

    /**
     * Lazily-reconstructable snapshots of the content before each step we received
     * between our `persistedVersion` and the editor's confirmed version. We keep these
     * so we can implement `ResetToPersistedVersion`: if the collaboration service
     * tells us we backfilled a future version (a previous durable object confirmed
     * steps to us but crashed before persisting them) we roll back to the persisted
     * content.
     *
     * The version of the content in the first remembered step's `contentBeforeStep` is
     * `editorState.getVersion() - rememberedSteps.length`.
     *
     * Unlike documents we don't remember steps to rebase presence selections (task
     * notes has no presence) so we only keep steps back to `persistedVersion`.
     */
    readonly rememberedSteps: ReadonlyArray<{
        readonly contentBeforeStep: Lazy<TaskNotesContent>;
    }>;
};

export type TaskNotesContentEditorAction = CollaborativeContentEditorAction<
    TaskNotesContentWithReferences,
    TaskNotesContentEditorExtraAction
>;

type TaskNotesContentEditorExtraAction = {
    readonly type: "ResetToPersistedVersion";
};

const baseReduceTaskNotesContentEditorState = createCollaborativeContentEditorStateReducer<
    TaskNotesContentWithReferences,
    TaskNotesContentEditorExtraState,
    TaskNotesContentEditorExtraAction
>((state, action, oldState) => {
    if (action.type === "ReceiveSteps") {
        // While the base reducer may receive `ReceiveSteps` actions out-of-order, it calls
        // our custom reducer with `ReceiveSteps` actions in-order.
        assert(action.newVersion === state.editorState.getVersion());

        // Whenever we receive steps, remember the content before each step so we can
        // implement `ResetToPersistedVersion`. We discard steps we no longer need below.
        let content = new Lazy(() => oldState.editorState.getDocWithoutSendableSteps());

        const newRememberedSteps = action.steps.map(({step}) => {
            const previousContent = content;

            content = new Lazy(() => {
                const stepResult = step.apply(previousContent.get());
                assert(stepResult.doc);
                assert(isTaskNotesContent(stepResult.doc));
                return stepResult.doc;
            });

            return {contentBeforeStep: previousContent};
        });

        return {
            ...state,
            extra: {
                ...state.extra,
                rememberedSteps: [...state.extra.rememberedSteps, ...newRememberedSteps],
            },
        };
    }

    if (action.type === "Extra") {
        switch (action.extra.type) {
            case "ResetToPersistedVersion": {
                return getInitialTaskNotesContentEditorState({
                    spaceId: state.spaceId,
                    taskId: state.extra.taskId,
                    initialNotesVersion: state.persistedVersion,
                    initialNotesContent: {
                        doc: getCollaborativeContentEditorStatePersistedContent(state),
                        references: state.editorState.getContent().references,
                    },
                    // Try to maintain the user's selection while resetting state.
                    initialSelection: state.editorState.getSelection().getBookmark(),
                });
            }
            default:
                throw exhaustive(action.extra.type);
        }
    }

    return state;
});

export function reduceTaskNotesContentEditorState(
    state: TaskNotesContentEditorState,
    actions: ReadonlyArray<TaskNotesContentEditorAction>,
): TaskNotesContentEditorState {
    const oldState = state;

    state = baseReduceTaskNotesContentEditorState(state, actions);

    // If `persistedVersion` or `rememberedSteps` changed, discard any remembered steps
    // older than `persistedVersion` since we only need them to roll back to the
    // persisted version.
    if (
        state.persistedVersion !== oldState.persistedVersion ||
        state.extra.rememberedSteps !== oldState.extra.rememberedSteps
    ) {
        const discardRememberedStepsBeforeVersion = Math.min(
            state.editorState.getVersion(),
            state.persistedVersion,
        );

        const discardRememberedStepsBeforeIndex =
            state.extra.rememberedSteps.length -
            (state.editorState.getVersion() - discardRememberedStepsBeforeVersion);

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

    return state;
}

export function getInitialTaskNotesContentEditorState({
    spaceId,
    taskId,
    initialNotesVersion,
    initialNotesContent,
    initialSelection,
}: {
    spaceId: SpaceId;
    taskId: TaskId;
    initialNotesVersion: number;
    initialNotesContent: TaskNotesContentWithReferences;
    initialSelection?: Selection | SelectionBookmark;
}): TaskNotesContentEditorState {
    return getInitialCollaborativeContentEditorState({
        spaceId,
        initialVersion: initialNotesVersion,
        initialContent: initialNotesContent,
        initialSelection,
        reduceReferences: reduceContentReferences,
        extra: {taskId, rememberedSteps: []},
    });
}
