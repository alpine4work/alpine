import {exhaustive} from "~/shared/helpers/control/exhaustive.js";
import {AccountId, TaskCollectionId, TaskId} from "~/shared/id/types/id_types.js";
import {Schema, SchemaType} from "~/shared/schema/schema.js";
import {TaskActionSchema} from "~/shared/tasks/actions/task_action.js";
import {TaskCollectionActionSchema} from "~/shared/tasks/actions/task_collection_action.js";
import {TaskNotepadPageActionSchema} from "~/shared/tasks/actions/task_notepad_page_action.js";
import {TaskNotepadPageIdSchema} from "~/shared/tasks/task_notepad_page_id.js";

/**
 * All updates to the task database in a space are done through task actions.
 * The canonical representation of a task database are the list of all actions
 * ever applied to it. Any other view of the task database is a reduction (in
 * the [functional programming sense][1]) of the actions list.
 *
 * Actions are commutative and idempotent. That means actions can be applied in
 * any order, multiple times, and clients will converge to the same state. This
 * unlocks:
 *
 * - Optimistic updates: As a user is typing we apply their updates directly to
 *   our local state even before attempting to commit the update to the
 *   database.
 *
 * - Distributed system: We don't need a centralized service for determining
 *   event order. Actions have at-least-once semantics and no ordering
 *   guarantees.
 *
 * These are similar properties to what [CRDTs][2] provide and indeed we use
 * CRDTs throughout the task system (e.g. task titles are a CRDT). However, the
 * task database is not, conceptually, one big CRDT and neither are individual
 * tasks. The task database is only partially visible to clients. There are
 * private tasks you are not allowed to read or update. So an action that may
 * have been valid at time T may not be valid at time T + 2 if at time T + 1
 * the task's permissions changed. When our backend receives an action it
 * chooses whether to accept or reject the action based on authorization rules.
 * If the backend chooses to accept an action then it must be applied by
 * clients in any order, even before/after actions that would have changed the
 * authorization decision.
 *
 * [1]: https://en.wikipedia.org/wiki/Fold_(higher-order_function)
 * [2]: https://en.wikipedia.org/wiki/Conflict-free_replicated_data_type
 */
export type TaskSpaceAction = SchemaType<typeof TaskSpaceActionSchema>;

/**
 * An action that updates a single task.
 */
export type TaskSpaceUpdateTaskAction = SchemaType<typeof TaskSpaceUpdateTaskActionSchema>;

const TaskSpaceUpdateTaskActionSchema = Schema.object({
    type: Schema.value("UpdateTask"),
    taskId: Schema.id<TaskId>(),
    taskAction: TaskActionSchema,
});

/**
 * An action that updates a single task collection.
 */
export type TaskSpaceUpdateTaskCollectionAction = SchemaType<
    typeof TaskSpaceUpdateTaskCollectionActionSchema
>;

const TaskSpaceUpdateTaskCollectionActionSchema = Schema.object({
    type: Schema.value("UpdateTaskCollection"),
    collectionId: Schema.id<TaskCollectionId>(),
    collectionAction: TaskCollectionActionSchema,
});

/**
 * An action that updates a single task notepad page of some user.
 */
export type TaskSpaceUpdateNotepadPageAction = SchemaType<
    typeof TaskSpaceUpdateNotepadPageActionSchema
>;

const TaskSpaceUpdateNotepadPageActionSchema = Schema.object({
    type: Schema.value("UpdateTaskNotepadPage"),
    accountId: Schema.id<AccountId>(),
    notepadPageId: TaskNotepadPageIdSchema,
    notepadPageAction: TaskNotepadPageActionSchema,
});

export const TaskSpaceActionSchema = Schema.union({
    UpdateTask: TaskSpaceUpdateTaskActionSchema,
    UpdateTaskCollection: TaskSpaceUpdateTaskCollectionActionSchema,
    UpdateTaskNotepadPage: TaskSpaceUpdateNotepadPageActionSchema,
});

/**
 * Get a low-cardinality label for the `TaskSpaceAction` we can use in
 * instrumentation.
 */
export function getTaskSpaceActionLabel(action: TaskSpaceAction) {
    switch (action.type) {
        case "UpdateTask":
            return `${action.type}_${action.taskAction.type}`;
        case "UpdateTaskCollection":
            return `${action.type}_${action.collectionAction.type}`;
        case "UpdateTaskNotepadPage":
            return `${action.type}_${action.notepadPageAction.type}`;
        default:
            throw exhaustive(action);
    }
}
