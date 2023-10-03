import {HybridLogicalTimeSchema} from "~/shared/schema/helpers/hybrid_logical_time_schema.js";
import {Schema, SchemaType} from "~/shared/schema/schema.js";
import {TaskCollectionModel} from "~/shared/tasks/model/task_collection_model.js";

export type TaskCollectionModelSearchResult = SchemaType<
    typeof TaskCollectionModelSearchResultSchema
>;

export const TaskCollectionModelSearchResultSchema = Schema.object({
    openTaskCount: Schema.integer,
    lastTaskAddedTime: HybridLogicalTimeSchema.nullable(),
    collection: TaskCollectionModel.schema,
});
