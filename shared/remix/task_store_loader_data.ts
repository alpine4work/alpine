import {TaskClientQueryId} from "~/shared/id/types/id_types.js";
import {Schema, SchemaType} from "~/shared/schema/schema.js";
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
            id: Schema.id<TaskClientQueryId>(),
            filters: TaskQueryNormalizedFiltersSchema,
            sorts: Schema.array(TaskQueryNormalizedSortSchema),
            loadedState: TaskRealtimeQueryLoadedStateSchema,
        }),
    ),
    updateEvent: TaskRealtimeUpdateEventSchema,
});
