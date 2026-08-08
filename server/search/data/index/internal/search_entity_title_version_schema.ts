import {HybridLogicalTimeSchema} from "~/shared/schema/helpers/hybrid_logical_time_schema.js";
import {Schema, SchemaType} from "~/shared/schema/schema.open_source.js";
import {TaskTitleSnapshotSchema} from "~/shared/tasks/title/task_title.js";

export type SearchEntityTitleVersion = SchemaType<typeof SearchEntityTitleVersionSchema>;

export const SearchEntityTitleVersionSchema = Schema.union({
    Integer: Schema.object({
        type: Schema.value("Integer"),
        version: Schema.integer,
    }),
    Integers: Schema.object({
        type: Schema.value("Integers"),
        versions: Schema.array(Schema.integer).minLength(1),
    }),
    HybridLogicalTime: Schema.object({
        type: Schema.value("HybridLogicalTime"),
        time: HybridLogicalTimeSchema,
    }),
    TaskTitle: Schema.object({
        type: Schema.value("TaskTitle"),
        snapshot: TaskTitleSnapshotSchema,
        deletedTime: HybridLogicalTimeSchema.optional(),
    }),
});
