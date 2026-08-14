import {
    CreateOrUpdateAccessPolicy,
    CreateOrUpdateAccessPolicySchema,
} from "~/shared/access/model/create_or_update_access_policy_schema.js";
import {themeColors} from "~/shared/design/core/theme_colors.js";
import {AccountId} from "~/shared/id/types/id_types.open_source.js";
import {LabelStringSchema} from "~/shared/schema/helpers/label_string_schema.js";
import {Schema, SchemaType} from "~/shared/schema/schema.js";
import {TaskActorFromSchema, TaskCreator} from "~/shared/tasks/task_creator.js";
import {TaskQueryDefaultsSchema} from "~/shared/tasks/task_query_defaults.js";

export type TaskCollectionAction = SchemaType<typeof TaskCollectionActionSchema>;

/**
 * Creates a task collection.
 *
 * Can only commit this action once for a given `TaskCollectionId`. Though this
 * action is idempotent. Two creates with the same `createdTime` are fine. Two
 * creates with different `createdTime`s are incompatible and will error.
 *
 * All other actions on a task will be kept in a queue until the task has been
 * created.
 */
export type TaskCollectionCreateAction = SchemaType<typeof TaskCollectionCreateActionSchema>;

const TaskCollectionCreateActionSchema = Schema.object({
    type: Schema.value("Create"),
    creator: Schema.object({
        // For some reason `accountId` was set to be `nullable()` when
        // `wrapOriginalPropertyInObject()` was added. That means we need to keep it as
        // nullable. We use a `transform()` below to fix the type.
        accountId: Schema.id<AccountId>().nullable().default(null),
        from: TaskActorFromSchema.nullable().default(null),
    })
        .wrapOriginalPropertyInObject("accountId", {from: null})
        .nullable()
        // NOTE(calebmer): We didn't keep track of collection creators until 2024-01-02.
        .default(null)
        .originalPropertyKey("creatorId"),
    name: LabelStringSchema,
    accessPolicy: CreateOrUpdateAccessPolicySchema,
}).transform<{
    readonly type: "Create";
    readonly creator: TaskCreator | null;
    readonly name: string;
    readonly accessPolicy: CreateOrUpdateAccessPolicy;
}>({
    serialize: action => action,
    deserialize: action => {
        return {
            ...action,
            creator:
                action.creator === null || action.creator.accountId === null
                    ? null
                    : {accountId: action.creator.accountId, from: action.creator.from},
        };
    },
});

/**
 * Deletes a task collection.
 *
 * Does nothing if the task collection is already deleted. The task collection's
 * data will be kept around in case the task collection is undeleted.
 */
export type TaskCollectionDeleteAction = SchemaType<typeof TaskCollectionDeleteActionSchema>;

const TaskCollectionDeleteActionSchema = Schema.object({
    type: Schema.value("Delete"),
});

/**
 * Undeletes a task collection.
 *
 * Does nothing if the task collection is not deleted.
 */
export type TaskCollectionUndeleteAction = SchemaType<typeof TaskCollectionDeleteActionSchema>;

const TaskCollectionUndeleteActionSchema = Schema.object({
    type: Schema.value("Undelete"),
});

/**
 * Updates the name of our task collection.
 *
 * Will be rejected by the server if you don't have the `Manage` permission level
 * on this collection.
 *
 * Task collection name update conflicts are resolved by last-write-wins. We don't
 * bother attempting to resolve conflicts with a data structure like that provided
 * by Y.js.
 */
export type TaskCollectionUpdateNameAction = SchemaType<
    typeof TaskCollectionUpdateNameActionSchema
>;

const TaskCollectionUpdateNameActionSchema = Schema.object({
    type: Schema.value("UpdateName"),
    name: LabelStringSchema,
});

/**
 * Updates the color associated with a task collection. Task collections may also
 * have no color which is the equivalent of grey.
 */
export type TaskCollectionUpdateColorAction = SchemaType<
    typeof TaskCollectionUpdateColorActionSchema
>;

const TaskCollectionUpdateColorActionSchema = Schema.object({
    type: Schema.value("UpdateColor"),
    color: Schema.enum(themeColors).nullable(),
});

/**
 * Updates the access policy of our task collection.
 *
 * Will be rejected by the server if you don't have the `Manage` permission level
 * on this collection.
 */
export type TaskCollectionUpdateAccessPolicyAction = SchemaType<
    typeof TaskCollectionUpdateAccessPolicyActionSchema
>;

const TaskCollectionUpdateAccessPolicyActionSchema = Schema.object({
    type: Schema.value("UpdateAccessPolicy"),
    accessPolicy: CreateOrUpdateAccessPolicySchema,
});

/**
 * Updates the defaults of our task collection. The default filters/sorts are
 * applied for everyone when they open the collection without explicit
 * filters/sorts of their own (e.g. filters in the URL).
 *
 * Will be rejected by the server if you don't have the `Manage` permission level
 * on this collection.
 *
 * Conflicts are resolved by last-write-wins for the entire defaults object. The
 * defaults are always saved together as one coherent view configuration so we
 * don't resolve conflicts per-customization.
 */
export type TaskCollectionUpdateDefaultsAction = SchemaType<
    typeof TaskCollectionUpdateDefaultsActionSchema
>;

const TaskCollectionUpdateDefaultsActionSchema = Schema.object({
    type: Schema.value("UpdateDefaults"),
    defaults: TaskQueryDefaultsSchema,
});

export const TaskCollectionActionSchema = Schema.union({
    Create: TaskCollectionCreateActionSchema,
    Delete: TaskCollectionDeleteActionSchema,
    Undelete: TaskCollectionUndeleteActionSchema,
    UpdateName: TaskCollectionUpdateNameActionSchema,
    UpdateColor: TaskCollectionUpdateColorActionSchema,
    UpdateAccessPolicy: TaskCollectionUpdateAccessPolicyActionSchema,
    UpdateDefaults: TaskCollectionUpdateDefaultsActionSchema,
});
