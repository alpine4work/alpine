import {ErrorSchema} from "~/shared/error/error_schema.js";
import {FileEntityModel} from "~/shared/files/file_entity_model.js";
import {emptyArray} from "~/shared/helpers/array/empty_array.js";
import {Schema, SchemaType} from "~/shared/schema/schema.js";
import {SitePreviewModel} from "~/shared/sites/site_model.js";
import {AccountModel} from "~/shared/spaces/account_model.js";
import {TaskCollectionModel} from "~/shared/tasks/model/task_collection_model.js";
import {TaskModel} from "~/shared/tasks/model/task_model.js";

export type FileTaskEntityModel = SchemaType<typeof FileTaskEntityModelSchema>;

export const FileTaskEntityModelSchema = FileEntityModel.implement({
    type: Schema.value("Task"),
    task: TaskModel.schema,
    assignee: AccountModel.schema.nullable(),
    parent: Schema.object({
        rootTask: Schema.union({
            Authorized: Schema.object({
                type: Schema.value("Authorized"),
                task: TaskModel.schema,
            }),
            Unauthorized: Schema.object({
                type: Schema.value("Unauthorized"),
            }),
        }),
        depth: Schema.integer,
    }).nullable(),
    collections: Schema.array(TaskCollectionModel.schema),
    referencedSites: Schema.array(
        Schema.result(
            Schema.object({ok: Schema.value(true), value: SitePreviewModel.schema}),
            Schema.object({ok: Schema.value(false), error: ErrorSchema}),
        ),
    ).default(emptyArray),
});
