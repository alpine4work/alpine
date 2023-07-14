import {Schema, SchemaType} from "~/shared/schema/schema.js";
import {TaskCollectionSetActionSchema} from "~/shared/tasks/task_collection_set.js";
import {TaskFilterableTime} from "~/shared/tasks/task_filterable_time.js";
import {TaskAccountModel} from "~/shared/tasks/task_model.js";
import {TaskTitleUpdateSchema} from "~/shared/tasks/task_title.js";

// NOCOMMIT: New documentation for this. What's the relationship with
// `TaskAction`?
export type TaskActionModel = SchemaType<typeof TaskActionModelSchema>;

export type TaskCreateActionModel = SchemaType<typeof TaskCreateActionModelSchema>;

const TaskCreateActionModelSchema = Schema.object({
    type: Schema.value("Create"),
    creator: TaskAccountModel.schema(),
    createdTime: TaskFilterableTime.schema,
});

export type TaskUpdateTitleActionModel = SchemaType<typeof TaskUpdateTitleActionModelSchema>;

const TaskUpdateTitleActionModelSchema = Schema.object({
    type: Schema.value("UpdateTitle"),
    titleUpdate: TaskTitleUpdateSchema,
});

export type TaskUpdateCollectionsActionModel = SchemaType<
    typeof TaskUpdateCollectionsActionModelSchema
>;

const TaskUpdateCollectionsActionModelSchema = Schema.object({
    type: Schema.value("UpdateCollections"),
    action: TaskCollectionSetActionSchema,
});

export const TaskActionModelSchema = Schema.union({
    Create: TaskCreateActionModelSchema,
    UpdateTitle: TaskUpdateTitleActionModelSchema,
    UpdateCollections: TaskUpdateCollectionsActionModelSchema,
});
