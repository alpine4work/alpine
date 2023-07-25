import {CalendarDate, parseDate} from "@internationalized/date";
import {createCrdtRegister} from "~/shared/crdt/crdt_register.js";
import {Schema, SchemaType} from "~/shared/schema/schema.js";
import {TaskCollectionSet} from "~/shared/tasks/task_collection_set.js";
import {TaskFilterableTime} from "~/shared/tasks/task_filterable_time.js";
import {TaskPriorityRegister} from "~/shared/tasks/task_priority.js";
import {TaskSortableAccount} from "~/shared/tasks/task_sortable_account.js";
import {TaskTitleUpdateSchema} from "~/shared/tasks/task_title.js";

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
export type TaskAction = SchemaType<typeof TaskActionSchema>;

export type TaskCreateAction = SchemaType<typeof TaskCreateActionSchema>;

const TaskCreateActionSchema = Schema.object({
    type: Schema.value("Create"),
    creator: TaskSortableAccount.schema,
    createdTime: TaskFilterableTime.schema,
});

export type TaskDeleteAction = SchemaType<typeof TaskDeleteActionSchema>;

const TaskDeleteActionSchema = Schema.object({
    type: Schema.value("Delete"),
    deletedTime: Schema.date,
});

export type TaskUndeleteAction = SchemaType<typeof TaskDeleteActionSchema>;

const TaskUndeleteActionSchema = Schema.object({
    type: Schema.value("Undelete"),
    undeletedTime: Schema.date,
});

export type TaskUpdateTitleAction = SchemaType<typeof TaskUpdateTitleActionSchema>;

const TaskUpdateTitleActionSchema = Schema.object({
    type: Schema.value("UpdateTitle"),
    titleUpdate: TaskTitleUpdateSchema,
});

export type TaskUpdateCollectionsAction = SchemaType<typeof TaskUpdateCollectionsActionSchema>;

const TaskUpdateCollectionsActionSchema = Schema.object({
    type: Schema.value("UpdateCollections"),
    collectionsAction: TaskCollectionSet.actionSchema,
});

const CalendarDateSchema = Schema.string.transform<CalendarDate>({
    serialize: date => date.toString(),
    deserialize: date => parseDate(date),
});

export const CalendarDateRegister = createCrdtRegister(CalendarDateSchema);

export type TaskUpdateDueDateAction = SchemaType<typeof TaskUpdateDueDateActionSchema>;

const TaskUpdateDueDateActionSchema = Schema.object({
    type: Schema.value("UpdateDueDate"),
    dueDateAction: CalendarDateRegister.actionSchema,
});

export type TaskUpdatePriorityAction = SchemaType<typeof TaskUpdatePriorityActionSchema>;

const TaskUpdatePriorityActionSchema = Schema.object({
    type: Schema.value("UpdatePriority"),
    priorityAction: TaskPriorityRegister.actionSchema,
});

export const TaskActionSchema = Schema.union({
    Create: TaskCreateActionSchema,
    Delete: TaskDeleteActionSchema,
    Undelete: TaskUndeleteActionSchema,
    UpdateTitle: TaskUpdateTitleActionSchema,
    UpdateCollections: TaskUpdateCollectionsActionSchema,
    UpdateDueDate: TaskUpdateDueDateActionSchema,
    UpdatePriority: TaskUpdatePriorityActionSchema,
});
