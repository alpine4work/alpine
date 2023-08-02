import {AccountId, TaskId} from "~/shared/id/types/id_types.js";
import {Schema, SchemaType} from "~/shared/schema/schema.js";
import {LabelStringRegister} from "~/shared/tasks/label_string_register.js";
import {TaskCollectionAccessPolicyRegister} from "~/shared/tasks/task_collection_access_policy.js";
import {TaskPositionSchema} from "~/shared/tasks/task_position.js";

export type TaskCollectionAction = SchemaType<typeof TaskCollectionActionSchema>;

/**
 * Creates a task collection.
 *
 * Can only commit this action once for a given `TaskCollectionId`. Though this
 * action is idempotent. Two creates with the same `creatorId` and
 * `createdTime` are fine. Two creates with different `creatorId`s and
 * `createdTime`s are incompatible and will error.
 *
 * All other actions on a task will be kept in a queue until the task has been
 * created.
 */
export type TaskCollectionCreateAction = SchemaType<typeof TaskCollectionCreateActionSchema>;

const TaskCollectionCreateActionSchema = Schema.object({
    type: Schema.value("Create"),
    creatorId: Schema.id<AccountId>(),
    createdTime: Schema.date,
    accessPolicy: TaskCollectionAccessPolicyRegister.schema,
});

/**
 * Deletes a task collection.
 *
 * Does nothing if the task collection is already deleted. The task
 * collection's data will be kept around in case the task collection is
 * undeleted.
 */
export type TaskCollectionDeleteAction = SchemaType<typeof TaskCollectionDeleteActionSchema>;

const TaskCollectionDeleteActionSchema = Schema.object({
    type: Schema.value("Delete"),
    deletedTime: Schema.date,
});

/**
 * Undeletes a task collection.
 *
 * Does nothing if the task collection is not deleted.
 */
export type TaskCollectionUndeleteAction = SchemaType<typeof TaskCollectionDeleteActionSchema>;

const TaskCollectionUndeleteActionSchema = Schema.object({
    type: Schema.value("Undelete"),
    undeletedTime: Schema.date,
});

/**
 * Updates the name of our task collection.
 *
 * Will be rejected by the server if you don't have the `Manage` permission
 * level on this collection.
 *
 * Task collection name update conflicts are resolved by last-write-wins. We
 * don't bother attempting to resolve conflicts with a data structure like that
 * provided by Y.js.
 */
export type TaskCollectionUpdateNameAction = SchemaType<typeof TaskCollectionUpdateNameSchema>;

const TaskCollectionUpdateNameSchema = Schema.object({
    type: Schema.value("UpdateName"),
    nameAction: LabelStringRegister.actionSchema,
});

/**
 * Updates the access policy of our task collection.
 *
 * Will be rejected by the server if you don't have the `Manage` permission
 * level on this collection.
 */
export type TaskCollectionUpdateAccessPolicyAction = SchemaType<
    typeof TaskCollectionUpdateAccessPolicyActionSchema
>;

const TaskCollectionUpdateAccessPolicyActionSchema = Schema.object({
    type: Schema.value("UpdateAccessPolicy"),
    accessPolicyAction: TaskCollectionAccessPolicyRegister.actionSchema,
});

/**
 * Sets a task's position in this collection.
 *
 * If the task is not a part of this collection then this update is rejected by
 * the server. Canonically, a task is a part of the collections in its
 * `TaskCollectionSet`. We have separate storage for task positions in the
 * collection. This way updates to a task's position in a collection do not
 * trigger a `TaskCollectionSet` update which has an expensive related
 * permissions update.
 *
 * If a task is part of a collection and this action has never been commit, the
 * task's position is considered to be
 * `{orderTime: collectionSetEntry.updatedTime, orderKey: initialOrderKey}`. In
 * other words we reuse the `updatedTime` from the task's `TaskCollectionSet`
 * for this entry. Once this action has been commit, we never revert to the
 * `updatedTime` in `TaskCollectionSet`.
 *
 * If a task is removed from this collection we keep around its position in
 * case the task is added back to the collection.
 */
export type TaskCollectionUpdateTaskPositionAction = SchemaType<
    typeof TaskCollectionUpdateTaskPositionActionSchema
>;

const TaskCollectionUpdateTaskPositionActionSchema = Schema.object({
    type: Schema.value("UpdateTaskPosition"),
    taskId: Schema.id<TaskId>(),
    position: TaskPositionSchema,
    updatedTime: Schema.date,
});

export const TaskCollectionActionSchema = Schema.union({
    Create: TaskCollectionCreateActionSchema,
    Delete: TaskCollectionDeleteActionSchema,
    Undelete: TaskCollectionUndeleteActionSchema,
    UpdateName: TaskCollectionUpdateNameSchema,
    UpdateAccessPolicy: TaskCollectionUpdateAccessPolicyActionSchema,
    UpdateTaskPosition: TaskCollectionUpdateTaskPositionActionSchema,
});
