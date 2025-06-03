import {FileEntityModel} from "~/shared/files/file_entity_model.js";
import {Schema, SchemaType} from "~/shared/schema/schema.js";
import {TaskCollectionModel} from "~/shared/tasks/model/task_collection_model.js";
import {TaskModel} from "~/shared/tasks/model/task_model.js";

export type FileTaskCollectionEntityModel = SchemaType<typeof FileTaskCollectionEntityModelSchema>;

export const FileTaskCollectionEntityModelSchema = FileEntityModel.implement({
    type: Schema.value("TaskCollection"),
    collection: TaskCollectionModel.schema,
    previewTasks: Schema.array(TaskModel.schema),
});
