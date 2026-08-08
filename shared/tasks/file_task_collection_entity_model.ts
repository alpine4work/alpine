import {FileEntityModel} from "~/shared/files/file_entity_model.js";
import {Schema, SchemaType} from "~/shared/schema/schema.open_source.js";
import {SitePreviewModel} from "~/shared/sites/site_model.js";
import {TaskCollectionModel} from "~/shared/tasks/model/task_collection_model.js";
import {TaskModel} from "~/shared/tasks/model/task_model.js";

export type FileTaskCollectionEntityModel = SchemaType<typeof FileTaskCollectionEntityModelSchema>;

export const FileTaskCollectionEntityModelSchema = FileEntityModel.implement({
    type: Schema.value("TaskCollection"),
    collection: TaskCollectionModel.schema,
    previewTasks: Schema.array(TaskModel.schema),
    /**
     * The site this collection belongs to, if any. Populated when the collection's
     * access policy resolves to a `Site` policy.
     */
    site: SitePreviewModel.schema.nullable().default(null),
});
