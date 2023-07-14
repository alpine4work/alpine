import {AccountId} from "~/shared/id/types/id_types.js";
import {Schema, SchemaType} from "~/shared/schema/schema.js";
import {LabelStringRegister} from "~/shared/tasks/internal/label_string_register.js";
import {TaskCollectionAccessPolicyRegister} from "~/shared/tasks/task_collection_access_policy.js";

export type TaskCollectionAction = SchemaType<typeof TaskCollectionActionSchema>;

export type TaskCollectionCreateAction = SchemaType<typeof TaskCollectionCreateActionSchema>;

const TaskCollectionCreateActionSchema = Schema.object({
    type: Schema.value("Create"),
    creatorId: Schema.id<AccountId>(),
    createdTime: Schema.date,
    accessPolicy: TaskCollectionAccessPolicyRegister.schema,
});

export type TaskCollectionDeleteAction = SchemaType<typeof TaskCollectionDeleteActionSchema>;

const TaskCollectionDeleteActionSchema = Schema.object({
    type: Schema.value("Delete"),
    deletedTime: Schema.date,
});

export type TaskCollectionUndeleteAction = SchemaType<typeof TaskCollectionDeleteActionSchema>;

const TaskCollectionUndeleteActionSchema = Schema.object({
    type: Schema.value("Undelete"),
    undeletedTime: Schema.date,
});

export type TaskCollectionUpdateNameAction = SchemaType<typeof TaskCollectionUpdateNameSchema>;

const TaskCollectionUpdateNameSchema = Schema.object({
    type: Schema.value("UpdateName"),
    nameAction: LabelStringRegister.actionSchema,
});

export type TaskCollectionUpdateAccessPolicyAction = SchemaType<
    typeof TaskCollectionUpdateAccessPolicyActionSchema
>;

const TaskCollectionUpdateAccessPolicyActionSchema = Schema.object({
    type: Schema.value("UpdateAccessPolicy"),
    accessPolicyAction: TaskCollectionAccessPolicyRegister.actionSchema,
});

export const TaskCollectionActionSchema = Schema.union({
    Create: TaskCollectionCreateActionSchema,
    Delete: TaskCollectionDeleteActionSchema,
    Undelete: TaskCollectionUndeleteActionSchema,
    UpdateName: TaskCollectionUpdateNameSchema,
    UpdateAccessPolicy: TaskCollectionUpdateAccessPolicyActionSchema,
});
