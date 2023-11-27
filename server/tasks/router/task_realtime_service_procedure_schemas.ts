import {
    BrowserId,
    TaskCollectionId,
    TaskId,
    TaskRealtimeClientId,
} from "~/shared/id/types/id_types.js";
import {Schema} from "~/shared/schema/schema.js";
import {TaskActionSchema} from "~/shared/tasks/actions/task_action.js";
import {TaskCollectionModel} from "~/shared/tasks/model/task_collection_model.js";
import {TaskModel} from "~/shared/tasks/model/task_model.js";
import {TaskGridViewExpansionStateSchema} from "~/shared/tasks/task_grid_view_expansion_state.js";
import {TaskQueryNormalizedFiltersSchema} from "~/shared/tasks/task_query_normalized_filters.js";
import {TaskQueryNormalizedSortSchema} from "~/shared/tasks/task_query_normalized_sort.js";
import {
    TaskRealtimeQueryLoadedStateSchema,
    TaskRealtimeUpdateEventSchema,
} from "~/shared/tasks/task_realtime_protocol.js";

export const TaskRealtimeApplyActionTransactionInputSchema = Schema.object({
    committedTime: Schema.date,
    actions: Schema.array(TaskActionSchema),
    clientId: Schema.id<TaskRealtimeClientId>().nullable(),
});

export const TaskRealtimeLoadQueriesInputSchema = Schema.object({
    queries: Schema.array(
        Schema.object({
            filters: TaskQueryNormalizedFiltersSchema,
            sorts: Schema.array(TaskQueryNormalizedSortSchema),
            limit: Schema.integer,
            shouldLoadGridViewExpandedChildTasksForBrowserId: Schema.id<BrowserId>().optional(),
        }),
    ),
    taskIds: Schema.array(Schema.id<TaskId>()),
    collectionIds: Schema.array(Schema.id<TaskCollectionId>()),
});

export const TaskRealtimeLoadQueriesOutputSchema = Schema.object({
    ok: Schema.value(true),
    queries: Schema.array(
        Schema.object({
            loadedState: TaskRealtimeQueryLoadedStateSchema,
            gridViewExpansionState: TaskGridViewExpansionStateSchema,
        }),
    ),
    extraQueries: Schema.array(
        Schema.object({
            filters: TaskQueryNormalizedFiltersSchema,
            sorts: Schema.array(TaskQueryNormalizedSortSchema),
            limit: Schema.integer,
            loadedState: TaskRealtimeQueryLoadedStateSchema,
        }),
    ),
    updateEvent: TaskRealtimeUpdateEventSchema,
});

export const TaskRealtimeGetTaskSchema = Schema.object({
    ok: Schema.value(true),
    task: TaskModel.schema,
    referencedTasks: Schema.array(TaskModel.schema),
    referencedCollections: Schema.array(TaskCollectionModel.schema),
});

export const TaskRealtimeGetCollectionSchema = Schema.object({
    ok: Schema.value(true),
    collection: TaskCollectionModel.schema,
});
