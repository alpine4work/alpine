import {SpaceId, TaskCollectionId} from "~/shared/id/types/id_types.js";
import {HybridLogicalTimeSchema} from "~/shared/schema/helpers/hybrid_logical_time_schema.js";
import {Schema, SchemaType} from "~/shared/schema/schema.js";
import {LabelStringRegister} from "~/shared/tasks/helpers/label_string_register.js";
import {TaskCollectionAccessPolicyRegister} from "~/shared/tasks/task_collection_access_policy.js";

export type TaskCollectionModelData = SchemaType<typeof TaskCollectionModelDataSchema>;

const TaskCollectionModelDataSchema = Schema.object({
    id: Schema.id<TaskCollectionId>(),
    spaceId: Schema.id<SpaceId>(),

    createdTime: HybridLogicalTimeSchema,
    deletedTime: HybridLogicalTimeSchema.nullable(),
    undeletedTime: HybridLogicalTimeSchema.nullable(),

    name: LabelStringRegister.schema,
    accessPolicy: TaskCollectionAccessPolicyRegister.schema,
});

// Doesn't use the `Model` class since `rawData` contains "raw" properties
// we want to provide clean accessors for. Like `isDeleted()` comparing
// `deletedTime` and `undeletedTime`.
export class TaskCollectionModel {
    public static readonly schema = TaskCollectionModelDataSchema.transform<TaskCollectionModel>({
        serialize: task => task.rawData,
        deserialize: rawData => new TaskCollectionModel(rawData),
    });

    public readonly id: TaskCollectionId;
    public readonly rawData: TaskCollectionModelData;

    constructor(rawData: TaskCollectionModelData) {
        this.id = rawData.id;
        this.rawData = rawData;
    }
}
