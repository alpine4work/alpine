import {CalendarDate, parseDate} from "@internationalized/date";
import {createCrdtRegister} from "~/shared/crdt/crdt_register.js";
import {TaskCollectionId, TaskId} from "~/shared/id/types/id_types.js";
import {OrderKeySchema} from "~/shared/schema/helpers/order_key_schema.js";
import {TimeZoneSchema} from "~/shared/schema/helpers/time_zone_schema.js";
import {Schema, SchemaType} from "~/shared/schema/schema.js";
import {TaskAssigneeSchema} from "~/shared/tasks/task_assignee.js";
import {TaskAssigneeStatusSchema} from "~/shared/tasks/task_assignee_status.js";
import {TaskPositionSchema} from "~/shared/tasks/task_position.js";
import {TaskPrioritySchema} from "~/shared/tasks/task_priority.js";
import {TaskSortableAccount} from "~/shared/tasks/task_sortable_account.js";
import {TaskStatusSchema} from "~/shared/tasks/task_status.js";
import {TaskTitleUpdateSchema} from "~/shared/tasks/task_title.js";

export type TaskAction = SchemaType<typeof TaskActionSchema>;

/**
 * Creates a task.
 *
 * Can only commit this action once for a given `TaskId`. Though this action is
 * idempotent. Two creates with the same `creator` and `createdTime` are fine.
 * Two creates with different `creator` and `createdTime`s are incompatible and
 * will error.
 *
 * All other actions on a task will be kept in a queue until the task has been
 * created.
 */
export type TaskCreateAction = SchemaType<typeof TaskCreateActionSchema>;

const TaskCreateActionSchema = Schema.object({
    type: Schema.value("Create"),
    creator: TaskSortableAccount.schema,
    creatorTimeZone: TimeZoneSchema,
});

/**
 * Deletes a task.
 *
 * Does nothing if the task is already deleted. The task's data will be kept
 * around in case the task is undeleted.
 */
export type TaskDeleteAction = SchemaType<typeof TaskDeleteActionSchema>;

const TaskDeleteActionSchema = Schema.object({
    type: Schema.value("Delete"),
});

/**
 * Undeletes a task.
 *
 * Does nothing if the task is not deleted.
 *
 * If this would create a circular dependency then the server will reject the
 * action. The client may not have all parent tasks loaded so can't always know
 * whether this will create a circular dependency.
 */
export type TaskUndeleteAction = SchemaType<typeof TaskDeleteActionSchema>;

const TaskUndeleteActionSchema = Schema.object({
    type: Schema.value("Undelete"),
});

export const TaskParentTaskIdRegister = createCrdtRegister(Schema.id<TaskId>().nullable());

/**
 * Updates the parent task for this task.
 *
 * Side effects:
 *
 * - Resets the `parentPosition` register with the action:
 *   `{updatedTime: parentTaskIdAction.updatedTime, value: {orderTime: parentTaskIdAction.updatedTime, orderKey: initialOrderKey}}`.
 *   This makes sure the task is placed at the end of our new parent's
 *   subtasks.
 *
 * The task parent property can be thought of as a `TaskId` and a `TaskPosition`.
 * These are updated in separate registers to avoid conflicts. Updating `TaskId`
 * is also expensive since we need to run circular dependency detection. The
 * `TaskPosition` is meaningless if there is no `TaskId`. Client models should
 * present these two registers as one `parent` object.
 *
 * If this would create a circular dependency then the server will reject the
 * action. The client may not have all parent tasks loaded so can't always know
 * whether this will create a circular dependency.
 */
export type TaskUpdateParentTaskIdAction = SchemaType<typeof TaskUpdateParentTaskIdActionSchema>;

const TaskUpdateParentTaskIdActionSchema = Schema.object({
    type: Schema.value("UpdateParentTaskId"),
    parentTaskId: Schema.id<TaskId>().nullable(),
});

/**
 * Updates the position of a task in its parent task.
 *
 * Will be rejected by the server if you don't have edit access to the parent
 * task.
 */
export type TaskUpdateParentPositionAction = SchemaType<
    typeof TaskUpdateParentPositionActionSchema
>;

const TaskUpdateParentPositionActionSchema = Schema.object({
    type: Schema.value("UpdateParentPosition"),
    parentPosition: TaskPositionSchema,
});

/**
 * Add a collection to this task. Or move the collection to a new position by
 * changing the `orderKey`.
 *
 * Will be rejected by the server if you don't have edit access to the relevant
 * collection being modified.
 */
export type TaskAddCollectionAction = SchemaType<typeof TaskAddCollectionActionSchema>;

const TaskAddCollectionActionSchema = Schema.object({
    type: Schema.value("AddCollection"),
    collectionId: Schema.id<TaskCollectionId>(),
    orderKey: OrderKeySchema,
});

/**
 * Remove a collection from this task.
 *
 * Will be rejected by the server if you don't have edit access to the relevant
 * collection being modified.
 */
export type TaskRemoveCollectionAction = SchemaType<typeof TaskRemoveCollectionActionSchema>;

const TaskRemoveCollectionActionSchema = Schema.object({
    type: Schema.value("RemoveCollection"),
    collectionId: Schema.id<TaskCollectionId>(),
});

/**
 * Updates the status of a task. Could put a task in an open or
 * closed status.
 *
 * Side effects:
 *
 * - Resets the `assigneeStatus` register with the action:
 *   `{updatedTime: statusAction.updatedTime, value: {type: "Inactive"}}`.
 *   `assigneeStatus` is reset whether the new status is open or closed and is
 *   reset whether or not the last status was open or closed.
 *
 *   `assigneeStatus` is always inactive while a task is closed. However we
 *   don't enforce this at the data type layer so the `TaskStatus` and
 *   `TaskAssigneeStatus` registers can update independently. At the model
 *   layer we should present a value that's always inactive if the task is
 *   closed.
 *
 *   Instead at the data layer we reset `assigneeStatus` on state change. The
 *   register itself may be active while the task is closed if we receive events
 *   out-of-order.
 */
export type TaskUpdateStatusAction = SchemaType<typeof TaskUpdateStatusActionSchema>;

const TaskUpdateStatusActionSchema = Schema.object({
    type: Schema.value("UpdateStatus"),
    status: TaskStatusSchema,
});

/**
 * Updates the account assigned to a task.
 *
 * Side effects:
 *
 * - Resets the `assigneeStatus` register with the action:
 *   `{updatedTime: assigneeAction.updatedTime, value: {type: "Inactive"}}`.
 *   `assigneeStatus` is reset whether or not the task assignee changed. Since
 *   actions can be applied out of order we don't know if two consecutive
 *   updates actually have an action in between.
 *
 *   `assigneeStatus` is personal to the assigned account. So when the assignee
 *   changes it should be on the new assignee to designate whether the task is
 *   active or not.
 *
 *   `assigneeStatus` should also be inactive whenever the assignee is null.
 *   However, we don't enforce this at the data layer so the `TaskAssignee` and
 *   `TaskAssigneeStatus` registers can update independently. At the model
 *   layer we should present a value that's always inactive if there is no
 *   assignee.
 *
 *   Instead at the data layer we reset `assigneeStatus` on state change. The
 *   register itself may be active while assignee is null if we receive events
 *   out-of-order.
 */
export type TaskUpdateAssigneeAction = SchemaType<typeof TaskUpdateAssigneeActionSchema>;

const TaskUpdateAssigneeActionSchema = Schema.object({
    type: Schema.value("UpdateAssignee"),
    assignee: TaskAssigneeSchema.nullable(),
});

/**
 * Updates the assignee status for a task. The assignee status is how the
 * assignee communicates whether they are actively working on a task or not.
 *
 * Other actions may update the assignee status register as a side effect. See
 * `TaskUpdateStatusAction` and `TaskUpdateAssigneeAction`.
 */
export type TaskUpdateAssigneeStatusAction = SchemaType<
    typeof TaskUpdateAssigneeStatusActionSchema
>;

const TaskUpdateAssigneeStatusActionSchema = Schema.object({
    type: Schema.value("UpdateAssigneeStatus"),
    assigneeStatus: TaskAssigneeStatusSchema,
});

/**
 * Update the title of the task.
 *
 * Task titles are represented by Y.js which provides collaborative text
 * editing through CRDTs. Which means these actions are commutative and
 * idempotent.
 */
export type TaskUpdateTitleAction = SchemaType<typeof TaskUpdateTitleActionSchema>;

const TaskUpdateTitleActionSchema = Schema.object({
    type: Schema.value("UpdateTitle"),
    titleUpdate: TaskTitleUpdateSchema,
});

const CalendarDateSchema = Schema.string.transform<CalendarDate>({
    serialize: date => date.toString(),
    deserialize: date => parseDate(date),
});

export const TaskDueDateRegister = createCrdtRegister(CalendarDateSchema.nullable());

/**
 * Updates the due date of the task.
 */
export type TaskUpdateDueDateAction = SchemaType<typeof TaskUpdateDueDateActionSchema>;

const TaskUpdateDueDateActionSchema = Schema.object({
    type: Schema.value("UpdateDueDate"),
    dueDate: CalendarDateSchema.nullable(),
});

/**
 * Updates the priority of the task.
 */
export type TaskUpdatePriorityAction = SchemaType<typeof TaskUpdatePriorityActionSchema>;

const TaskUpdatePriorityActionSchema = Schema.object({
    type: Schema.value("UpdatePriority"),
    priority: TaskPrioritySchema.nullable(),
});

export const TaskActionSchema = Schema.union({
    Create: TaskCreateActionSchema,
    Delete: TaskDeleteActionSchema,
    Undelete: TaskUndeleteActionSchema,
    UpdateParentTaskId: TaskUpdateParentTaskIdActionSchema,
    UpdateParentPosition: TaskUpdateParentPositionActionSchema,
    AddCollection: TaskAddCollectionActionSchema,
    RemoveCollection: TaskRemoveCollectionActionSchema,
    UpdateStatus: TaskUpdateStatusActionSchema,
    UpdateAssignee: TaskUpdateAssigneeActionSchema,
    UpdateAssigneeStatus: TaskUpdateAssigneeStatusActionSchema,
    UpdateTitle: TaskUpdateTitleActionSchema,
    UpdateDueDate: TaskUpdateDueDateActionSchema,
    UpdatePriority: TaskUpdatePriorityActionSchema,
});
