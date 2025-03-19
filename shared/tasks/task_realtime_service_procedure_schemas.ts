import {
    BrowserId,
    TaskCollectionId,
    TaskId,
    TaskRealtimeClientId,
} from "~/shared/id/types/id_types.js";
import {Schema, SchemaType} from "~/shared/schema/schema.js";
import {TaskActionSchema} from "~/shared/tasks/actions/task_action.js";
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

export type TaskRealtimeLoadQueriesInput = SchemaType<typeof TaskRealtimeLoadQueriesInputSchema>;

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

export type TaskRealtimeLoadQueriesOutput = SchemaType<typeof TaskRealtimeLoadQueriesOutputSchema>;

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

export const TaskRealtimeGetTaskWithoutDependenciesOutputSchema = Schema.object({
    ok: Schema.value(true),
    task: TaskModel.schema,
});
