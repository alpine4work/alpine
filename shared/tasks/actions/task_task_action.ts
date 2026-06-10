import {CalendarDate} from "@internationalized/date";
import {CreateOrUpdateAccessPolicySchema} from "~/shared/access/model/create_or_update_access_policy_schema.js";
import {CrdtRegister, createCrdtRegister} from "~/shared/crdt/crdt_register.js";
import {AccountId, TaskCollectionId, TaskId} from "~/shared/id/types/id_types.js";
import {OrderKeySchema} from "~/shared/schema/helpers/order_key_schema.js";
import {TimeZoneSchema} from "~/shared/schema/helpers/time_zone_schema.js";
import {Schema, SchemaType} from "~/shared/schema/schema.js";
import {CalendarDateSchema} from "~/shared/tasks/calendar_date_schema.js";
import {TaskAssigneeSchema} from "~/shared/tasks/task_assignee.js";
import {TaskAssigneeStatusSchema} from "~/shared/tasks/task_assignee_status.js";
import {TaskCreatorSchema} from "~/shared/tasks/task_creator.js";
import {TaskLayoutSchema} from "~/shared/tasks/task_layout.js";
import {TaskPositionSchema} from "~/shared/tasks/task_position.js";
import {TaskPrioritySchema} from "~/shared/tasks/task_priority.js";
import {TaskStatusSchema} from "~/shared/tasks/task_status.js";
import {TaskTitleUpdateSchema} from "~/shared/tasks/title/task_title.js";

// We're in a tricky position with our naming convention. The namespace for all
// task related code is "task". However, with these actions we want to
// differentiate actions that operate on tasks vs collections vs the parent action
// type. The parent action type should get the convenient name `TaskAction`.
// Following our style guide naming convention collection actions are then
// `TaskCollectionAction`. Continuing to follow our naming convention that means
// actions on a single task should be `TaskTaskAction`? Guess so.
//
// We cheat the naming convention a little bit for specializations of the task
// action. For example, the task create action is named `TaskCreateAction` instead
// of inheriting the full namespace (as recommended by the naming convention) and
// becoming `TaskTaskCreateAction`. `TaskTask` is a little silly so we cheat a bit
// to have reasonable looking names for the specialized actions given they won't
// conflict.
export type TaskTaskAction = SchemaType<typeof TaskTaskActionSchema>;

/**
 * Creates a task.
 *
 * Can only commit this action once for a given `TaskId`. Though this action is
 * idempotent. Two creates with the same `creator` and `createdTime` are fine. Two
 * creates with different `creator` and `createdTime`s are incompatible and will
 * error.
 *
 * All other actions on a task will be kept in a queue until the task has been
 * created.
 */
export type TaskCreateAction = SchemaType<typeof TaskCreateActionSchema>;

const TaskCreateActionSchema = Schema.object({
    type: Schema.value("Create"),
    creator: TaskCreatorSchema.wrapOriginalPropertyInObject("accountId", {
        from: null,
    }).originalPropertyKey("creatorId"),
    creatorTimeZone: TimeZoneSchema,
    accessPolicy: CreateOrUpdateAccessPolicySchema.optional(),
});

/**
 * Deletes a task.
 *
 * Does nothing if the task is already deleted. The task's data will be kept around
 * in case the task is undeleted.
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
export type TaskUndeleteAction = SchemaType<typeof TaskUndeleteActionSchema>;

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
 *   `{version: action.time, value: {orderTime: action.time, orderKey: initialOrderKey}}`.
 *   This makes sure the task is placed at the end of our new parent's subtasks.
 *
 * The task parent property can be thought of as a `TaskId` and a `TaskPosition`.
 * These are updated in separate registers to avoid conflicts. Updating `TaskId` is
 * also expensive since we need to run circular dependency detection. The
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
    // May also update the parent position in the same action.
    parentPosition: TaskPositionSchema.optional(),
});

/**
 * Updates the position of a task in its parent task.
 *
 * Will be rejected by the server if you don't have edit access to the parent task.
 */
export type TaskUpdateParentPositionAction = SchemaType<
    typeof TaskUpdateParentPositionActionSchema
>;

const TaskUpdateParentPositionActionSchema = Schema.object({
    type: Schema.value("UpdateParentPosition"),
    parentPosition: TaskPositionSchema,
});

/**
 * Action that updates the number of children our task has.
 *
 * This is a special action that can't be committed by clients. Instead when you
 * commit an `UpdateParentTaskId` action, the server generates this action and adds
 * it to your action transaction. (Clients are also recommended to locally generate
 * this action if the parent task is loaded. Otherwise they can wait to receive the
 * action over their realtime connection.)
 *
 * If a client tries to commit this action the server will reject it.
 *
 * That's because only the server knows the correct child task count. Clients may
 * not have loaded the parent task or may have an out-of-date parent task.
 *
 * The two counters we care about are `childTaskCount` and `closedChildTaskCount`.
 * (`openChildTaskCount` can be derived from
 * `childTaskCount - closedChildTaskCount`.) But since task actions have CRDT
 * properties (commutative and idempotent) it's not as easy as setting two counter
 * values.
 *
 * Instead we use simplified [grow-counter CRDTs][1] which have commutative and
 * idempotent properties. Namely the CRDT merge function for each counter is:
 * `(a, b) => max(a, b)`. We don't care about preserving increments from individual
 * replicas since the counters will be set by the server which has an authoritative
 * view of the counters.
 *
 * A number that can be incremented and decremented is modeled as two grow-counter
 * CRDTs. One for additions and one for subtractions. To get the final value you
 * subtract the subtractions grow-counter CRDT from the additions grow-counter
 * CRDT.
 *
 * So `childTaskCount` is implemented as `addedChildTaskCount` and
 * `removedChildTaskCount`, you get the final value with
 * `childTaskCount = addedChildTaskCount - removedChildTaskCount`. Likewise for
 * `closedChildTaskCount`.
 *
 * By committing both a `UpdateParentTaskId` action and `UpdateChildrenCounts` we
 * can correctly update tasks no matter what slice of data is loaded. If only the
 * parent is loaded then `UpdateChildrenCounts` will update its child counts. If
 * only the child is loaded then `UpdateParentTaskId` will let us know if there is
 * a parent or not.
 *
 * ## Commentary
 *
 * This is a weird action that only works because we have a centralized authority
 * for determining whether an action can be commit which isn't the case with a
 * classic peer-to-peer CRDT application.
 *
 * I (@calebmer) couldn't think of a better "classic" CRDT implementation. Though
 * our task system as a whole can't be implemented in a classic CRDT implementation
 * given our requirements around partial data loading and permissions.
 *
 * [1]: https://www.bartoszsypytkowski.com/the-state-of-a-state-based-crdts/
 */
export type TaskUpdateChildrenCountsAction = SchemaType<
    typeof TaskUpdateChildrenCountsActionSchema
>;

const TaskUpdateChildrenCountsActionSchema = Schema.object({
    type: Schema.value("UpdateChildrenCounts"),
    addedChildTaskCount: Schema.integer,
    removedChildTaskCount: Schema.integer,
    addedClosedChildTaskCount: Schema.integer,
    removedClosedChildTaskCount: Schema.integer,
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
 * Sets a task's position in a collection.
 *
 * If the task is not a part of this collection then this update is rejected by the
 * server. Canonically, a task is a part of the collections in its
 * `TaskCollectionSet`. We have separate storage for task positions in the
 * collection. This way updates to a task's position in a collection do not trigger
 * a `TaskCollectionSet` update which has an expensive related permissions update.
 *
 * If a task is part of a collection and this action has never been commit, the
 * task's position is considered to be
 * `{orderTime: collectionSetEntry.version, orderKey: initialOrderKey}`. In other
 * words we reuse the `version` from the task's `TaskCollectionSet` for this entry.
 * Once this action has been commit, we never revert to the `version` in
 * `TaskCollectionSet`.
 *
 * If a task is removed from this collection we keep around its position in case
 * the task is added back to the collection.
 */
export type TaskUpdateCollectionPositionAction = SchemaType<
    typeof TaskUpdateCollectionPositionActionSchema
>;

const TaskUpdateCollectionPositionActionSchema = Schema.object({
    type: Schema.value("UpdateCollectionPosition"),
    collectionId: Schema.id<TaskCollectionId>(),
    position: TaskPositionSchema,
});

/**
 * Updates the status of a task. Could put a task in an open or closed status.
 *
 * Side effects:
 *
 * - Resets the `assigneeStatus` register with the action:
 *   `{version: action.time, value: {type: "Inactive"}}`. `assigneeStatus` is reset
 *   whether the new status is open or closed and is reset whether or not the last
 *   status was open or closed.
 *
 *     `assigneeStatus` is always inactive while a task is closed. However we don't
 *     enforce this at the data type layer so the `TaskStatus` and
 *     `TaskAssigneeStatus` registers can update independently. At the model layer
 *     we should present a value that's always inactive if the task is closed.
 *
 *     Instead at the data layer we reset `assigneeStatus` on state change. The
 *     register itself may be active while the task is closed if we receive events
 *     out-of-order.
 */
export type TaskUpdateStatusAction = SchemaType<typeof TaskUpdateStatusActionSchema>;

const TaskUpdateStatusActionSchema = Schema.object({
    type: Schema.value("UpdateStatus"),
    status: TaskStatusSchema,
    // May also update the assignee status in the same action.
    assigneeStatus: TaskAssigneeStatusSchema.optional(),
});

/**
 * Updates the account assigned to a task.
 *
 * Side effects:
 *
 * - Resets the `assigneeStatus` register with the action:
 *   `{version: action.time, value: {type: "Inactive"}}`. `assigneeStatus` is reset
 *   whether or not the task assignee changed. Since actions can be applied out of
 *   order we don't know if two consecutive updates actually have an action in
 *   between.
 *
 *     `assigneeStatus` is personal to the assigned account. So when the assignee
 *     changes it should be on the new assignee to designate whether the task is
 *     active or not.
 *
 *     `assigneeStatus` should also be inactive whenever the assignee is null.
 *     However, we don't enforce this at the data layer so the `TaskAssignee` and
 *     `TaskAssigneeStatus` registers can update independently. At the model layer
 *     we should present a value that's always inactive if there is no assignee.
 *
 *     Instead at the data layer we reset `assigneeStatus` on state change. The
 *     register itself may be active while assignee is null if we receive events
 *     out-of-order.
 *
 * - Resets the effective `assigneePosition` of the task. While we don't actually
 *   change the value of the `assigneePosition` register when assignee is updated
 *   (so if a user changes the assignee back the old position is not lost) the
 *   effective assignee position is still reset. This is implemented in
 *   `TaskModel.getAssigneePosition()` and `getTaskIndexDocAssigneePosition()`.
 */
export type TaskUpdateAssigneeAction = SchemaType<typeof TaskUpdateAssigneeActionSchema>;

const TaskUpdateAssigneeActionSchema = Schema.object({
    type: Schema.value("UpdateAssignee"),
    assignee: TaskAssigneeSchema.nullable(),
    // May also update the assignee status in the same action.
    assigneeStatus: TaskAssigneeStatusSchema.optional(),
});

/**
 * Updates the assignee status for a task. The assignee status is how the assignee
 * communicates whether they are actively working on a task or not.
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
 * Updates the position of a task in the assignee's task list.
 *
 * The assignee position of a task is in a separate register from the assignee
 * register so we have better control over permissions for the position. Notably,
 * all clients are allowed to know the task's assignee but only the task assignee's
 * client should know the assignee position.
 */
export type TaskUpdateAssigneePosition = SchemaType<typeof TaskUpdateAssigneePositionSchema>;

const TaskUpdateAssigneePositionSchema = Schema.object({
    type: Schema.value("UpdateAssigneePosition"),
    accountId: Schema.id<AccountId>(),
    position: TaskPositionSchema,
});

/**
 * Update the title of the task.
 *
 * Task titles are represented by Y.js which provides collaborative text editing
 * through CRDTs. Which means these actions are commutative and idempotent.
 */
export type TaskUpdateTitleAction = SchemaType<typeof TaskUpdateTitleActionSchema>;

const TaskUpdateTitleActionSchema = Schema.object({
    type: Schema.value("UpdateTitle"),
    titleUpdate: TaskTitleUpdateSchema,
});

export const TaskDueDateRegister = createCrdtRegister(CalendarDateSchema.nullable());
export type TaskDueDateRegister = CrdtRegister<CalendarDate | null>;

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

/**
 * Updates the layout of the task.
 */
export type TaskUpdateLayoutAction = SchemaType<typeof TaskUpdateLayoutActionSchema>;

const TaskUpdateLayoutActionSchema = Schema.object({
    type: Schema.value("UpdateLayout"),
    layout: TaskLayoutSchema.nullable(),
});

/**
 * Updates the access policy of the task.
 *
 * Will be rejected by the server if you don't have the `Manage` permission level
 * on this task.
 */
export type TaskUpdateAccessPolicyAction = SchemaType<typeof TaskUpdateAccessPolicyActionSchema>;

const TaskUpdateAccessPolicyActionSchema = Schema.object({
    type: Schema.value("UpdateAccessPolicy"),
    accessPolicy: CreateOrUpdateAccessPolicySchema,
});

function emptyObjectSchema<const Type extends string>(type: Type) {
    return Schema.object({type: Schema.value(type)});
}

export const TaskTaskActionUnion = {
    Create: TaskCreateActionSchema,
    Delete: TaskDeleteActionSchema,
    Undelete: TaskUndeleteActionSchema,
    UpdateParentTaskId: TaskUpdateParentTaskIdActionSchema,
    UpdateParentPosition: TaskUpdateParentPositionActionSchema,
    UpdateChildrenCounts: TaskUpdateChildrenCountsActionSchema,
    AddCollection: TaskAddCollectionActionSchema,
    RemoveCollection: TaskRemoveCollectionActionSchema,
    UpdateCollectionPosition: TaskUpdateCollectionPositionActionSchema,
    UpdateStatus: TaskUpdateStatusActionSchema,
    UpdateAssignee: TaskUpdateAssigneeActionSchema,
    UpdateAssigneeStatus: TaskUpdateAssigneeStatusActionSchema,
    UpdateAssigneePosition: TaskUpdateAssigneePositionSchema,
    UpdateTitle: TaskUpdateTitleActionSchema,
    UpdateDueDate: TaskUpdateDueDateActionSchema,
    UpdatePriority: TaskUpdatePriorityActionSchema,
    UpdateLayout: TaskUpdateLayoutActionSchema,
    UpdateAccessPolicy: TaskUpdateAccessPolicyActionSchema,
    // NOTE(calebmer, 2025-03-18): Remnants of the task notepad feature. We ignore
    // these actions at this point but we need minimal handling for backwards
    // compatibility to avoid crashes since we have actions of these types saved in the
    // database.
    UpdateNotepadPagePosition: emptyObjectSchema("UpdateNotepadPagePosition"),
    UpdateAssigneeActivePosition: emptyObjectSchema("UpdateAssigneeActivePosition"),
};

export const TaskTaskActionSchema = Schema.union(TaskTaskActionUnion);
