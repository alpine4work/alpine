import {Schema, SchemaType} from "~/shared/schema/schema.js";
import {TaskAccountModel, TaskDateModel} from "~/shared/tasks/task_model.js";
import {TaskTitleUpdateSchema} from "~/shared/tasks/task_title_schema.js";

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
export type TaskActionModel = SchemaType<typeof TaskActionModelSchema>;

export type TaskCreateActionModel = SchemaType<typeof TaskCreateActionModelSchema>;

const TaskCreateActionModelSchema = Schema.object({
    type: Schema.value("Create"),
    creator: TaskAccountModel.schema(),
    createdTime: TaskDateModel.schema(),
});

export type TaskUpdateTitleActionModel = SchemaType<typeof TaskUpdateTitleActionModelSchema>;

const TaskUpdateTitleActionModelSchema = Schema.object({
    type: Schema.value("UpdateTitle"),
    titleUpdate: TaskTitleUpdateSchema,
});

export const TaskActionModelSchema = Schema.union({
    Create: TaskCreateActionModelSchema,
    UpdateTitle: TaskUpdateTitleActionModelSchema,
});
