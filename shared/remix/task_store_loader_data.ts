import {TaskCollectionId, TaskId} from "~/shared/id/types/id_types.open_source.js";
import {Schema, SchemaType} from "~/shared/schema/schema.open_source.js";
import {TaskQueryNormalizedFiltersSchema} from "~/shared/tasks/task_query_normalized_filters.js";
import {TaskQueryNormalizedSortSchema} from "~/shared/tasks/task_query_normalized_sort.js";
import {
    TaskRealtimeQueryLoadedStateSchema,
    TaskRealtimeUpdateEventSchema,
} from "~/shared/tasks/task_realtime_protocol.js";

export type TaskStoreLoaderData = SchemaType<typeof TaskStoreLoaderDataSchema>;

export const TaskStoreLoaderDataSchema = Schema.object({
    queries: Schema.array(
        Schema.object({
            limit: Schema.integer,
            filters: TaskQueryNormalizedFiltersSchema,
            sorts: Schema.array(TaskQueryNormalizedSortSchema),
            loadedState: TaskRealtimeQueryLoadedStateSchema,
        }),
    ),
    taskIds: Schema.array(Schema.id<TaskId>()),
    collectionIds: Schema.array(Schema.id<TaskCollectionId>()),
    updateEvent: TaskRealtimeUpdateEventSchema,
});
